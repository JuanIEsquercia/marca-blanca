import { createAdminClient, listarTodosLosUsuarios, traducirErrorAuth } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { calcularConsumoMesActualPorConstructora } from '@/lib/chat/limite'
import { NextResponse } from 'next/server'
import type { CondicionIva } from '@/types/database'

const CONDICIONES_IVA: CondicionIva[] = ['responsable_inscripto', 'monotributo', 'exento', 'consumidor_final']

// Campos de facturación: todos opcionales, se guardan tal cual (trim, o
// null si vienen vacíos) — sin validación de formato de CUIT por ahora,
// es un dato que carga el superadmin a mano, no un form público.
interface DatosFacturacion {
  razon_social: string | null
  cuit: string | null
  condicion_iva: CondicionIva | null
  email_facturacion: string | null
  telefono_contacto: string | null
  direccion: string | null
}

function parseDatosFacturacion(body: Record<string, unknown>): DatosFacturacion | { error: NextResponse } {
  const strOrNull = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null
  const condicionIva = strOrNull(body.condicionIva)
  if (condicionIva && !CONDICIONES_IVA.includes(condicionIva as CondicionIva)) {
    return { error: NextResponse.json({ error: 'condicionIva inválida' }, { status: 400 }) }
  }
  return {
    razon_social: strOrNull(body.razonSocial),
    cuit: strOrNull(body.cuit),
    condicion_iva: condicionIva as CondicionIva | null,
    email_facturacion: strOrNull(body.emailFacturacion),
    telefono_contacto: strOrNull(body.telefonoContacto),
    direccion: strOrNull(body.direccion),
  }
}

async function verifySuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const SA = process.env.SUPERADMIN_EMAIL
  if (!SA || user.email !== SA) return null
  return user
}

export async function GET() {
  const caller = await verifySuperAdmin()
  if (!caller) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const adminClient = createAdminClient()

  const [
    { data: constructoras },
    { data: perfiles },
    authUsers,
    { data: numeros },
    consumoPorConstructora,
  ] = await Promise.all([
    adminClient.from('constructoras')
      .select('id, nombre, owner_id, created_at, razon_social, cuit, condicion_iva, email_facturacion, telefono_contacto, direccion, chat_limite_mensual_usd')
      .order('created_at', { ascending: false }),
    adminClient.from('perfiles').select('id, nombre, rol, constructora_id').not('constructora_id', 'is', null),
    listarTodosLosUsuarios(adminClient),
    adminClient.from('whatsapp_numeros').select('constructora_id, kapso_phone_id, numero').eq('activo', true),
    calcularConsumoMesActualPorConstructora(adminClient),
  ])

  const result = (constructoras ?? []).map(c => {
    const perfilesDeEsta = (perfiles ?? []).filter(p => p.constructora_id === c.id)
    const usuarios = perfilesDeEsta.map(p => {
      const authUser = authUsers.find(u => u.id === p.id)
      return { id: p.id, nombre: p.nombre, email: authUser?.email ?? null, rol: p.rol }
    })
    const numero = (numeros ?? []).find(n => n.constructora_id === c.id)
    return {
      id: c.id,
      nombre: c.nombre,
      createdAt: c.created_at,
      usuarios,
      kapsoPhoneId: numero?.kapso_phone_id ?? null,
      numeroWhatsapp: numero?.numero ?? null,
      razonSocial: c.razon_social,
      cuit: c.cuit,
      condicionIva: c.condicion_iva,
      emailFacturacion: c.email_facturacion,
      telefonoContacto: c.telefono_contacto,
      direccion: c.direccion,
      chatLimiteMensualUsd: c.chat_limite_mensual_usd,
      chatConsumoMesActualUsd: consumoPorConstructora[c.id] ?? 0,
    }
  })

  return NextResponse.json(result)
}

export async function POST(request: Request) {
  const caller = await verifySuperAdmin()
  if (!caller) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const body = await request.json()
  const { nombre, adminEmail, adminPassword, adminNombre } = body
  if (!nombre?.trim() || !adminEmail?.trim() || !adminPassword?.trim()) {
    return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
  }

  const datosFacturacion = parseDatosFacturacion(body)
  if ('error' in datosFacturacion) return datosFacturacion.error

  const adminClient = createAdminClient()

  const { data: newUser, error: authError } = await adminClient.auth.admin.createUser({
    email: adminEmail.trim().toLowerCase(),
    password: adminPassword,
    email_confirm: true,
  })

  if (authError || !newUser.user) {
    return NextResponse.json({ error: authError ? traducirErrorAuth(authError.message) : 'Error al crear el usuario' }, { status: 500 })
  }

  const userId = newUser.user.id

  const { data: constructora, error: cError } = await adminClient
    .from('constructoras')
    .insert({ nombre: nombre.trim(), owner_id: userId, ...datosFacturacion })
    .select('id').single()

  if (cError || !constructora) {
    await adminClient.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: 'Error al crear la constructora' }, { status: 500 })
  }

  const nombreAdmin = adminNombre?.trim() || adminEmail.split('@')[0]

  const { error: perfilError } = await adminClient
    .from('perfiles')
    .upsert({ id: userId, nombre: nombreAdmin, rol: 'admin', constructora_id: constructora.id }, { onConflict: 'id' })

  if (perfilError) {
    await adminClient
      .from('perfiles')
      .upsert({ id: userId, nombre: nombreAdmin, rol: 'admin' }, { onConflict: 'id' })
  }

  await adminClient.from('miembros').upsert(
    { constructora_id: constructora.id, user_id: userId, rol: 'admin' },
    { onConflict: 'constructora_id,user_id' }
  )

  await adminClient.from('categorias_costo').insert([
    { constructora_id: constructora.id, nombre: 'Materiales',               color: '#f59e0b' },
    { constructora_id: constructora.id, nombre: 'Mano de obra',              color: '#ef4444' },
    { constructora_id: constructora.id, nombre: 'Honorarios profesionales',  color: '#8b5cf6' },
    { constructora_id: constructora.id, nombre: 'Marketing y ventas',        color: '#06b6d4' },
    { constructora_id: constructora.id, nombre: 'Gastos administrativos',    color: '#64748b' },
    { constructora_id: constructora.id, nombre: 'Terreno',                   color: '#10b981' },
    { constructora_id: constructora.id, nombre: 'Impuestos y tasas',         color: '#f97316' },
  ])

  return NextResponse.json({ ok: true, constructoraId: constructora.id, userId })
}

export async function PATCH(request: Request) {
  const caller = await verifySuperAdmin()
  if (!caller) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const body = await request.json()
  const { constructoraId, nombre, kapsoPhoneId, numeroWhatsapp, datosFacturacion, chatLimiteMensualUsd } = body
  if (!constructoraId) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  if (nombre?.trim()) {
    const { error } = await adminClient
      .from('constructoras')
      .update({ nombre: nombre.trim() })
      .eq('id', constructoraId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Límite mensual del chat IA (lib/chat/limite.ts) — 0 es un valor válido a
  // propósito (bloquea el chat de esa constructora de entrada, útil para
  // probar el corte sin esperar a que un uso real llegue al tope).
  if (chatLimiteMensualUsd !== undefined) {
    const valor = Number(chatLimiteMensualUsd)
    if (!Number.isFinite(valor) || valor < 0) {
      return NextResponse.json({ error: 'El límite mensual tiene que ser un número mayor o igual a 0' }, { status: 400 })
    }
    const { error } = await adminClient
      .from('constructoras')
      .update({ chat_limite_mensual_usd: valor })
      .eq('id', constructoraId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (datosFacturacion && typeof datosFacturacion === 'object') {
    const parsed = parseDatosFacturacion(datosFacturacion)
    if ('error' in parsed) return parsed.error

    const { error } = await adminClient
      .from('constructoras')
      .update(parsed)
      .eq('id', constructoraId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // kapsoPhoneId: identificador interno de la API de Kapso/Meta para el
  // número de WhatsApp Business que la plataforma contrató para esta
  // constructora — es lo que llega en cada webhook, pero NO es el número
  // que un humano puede marcar/escribir (ver docs de Kapso: phone_number_id
  // vs. display_phone_number). numeroWhatsapp es ese número real (con
  // código de país, ej "+54 9 11 xxxx-xxxx") — se guarda junto para que el
  // panel del admin le muestre al usuario a qué número escribir "VINCULAR".
  // Solo el superadmin carga esto acá — es la única forma de crear
  // whatsapp_numeros, ver app/api/whatsapp/webhook/route.ts (el webhook
  // nunca la escribe, solo la lee para validar que un código de
  // vinculación se redima en el número correcto). String vacío desvincula.
  if (typeof kapsoPhoneId === 'string') {
    const valor = kapsoPhoneId.trim()
    const valorNumero = typeof numeroWhatsapp === 'string' ? numeroWhatsapp.trim() : ''

    // Validar todo ANTES de tocar la tabla — un delete+insert no es
    // atómico, así que si el insert falla después del delete, la
    // constructora queda sin fila (perdiendo un vínculo que ya andaba).
    if (valor && !valorNumero) {
      return NextResponse.json({ error: 'Falta el número de WhatsApp (el que el usuario va a marcar)' }, { status: 400 })
    }
    if (valor) {
      const { data: enUso } = await adminClient
        .from('whatsapp_numeros')
        .select('constructora_id')
        .eq('kapso_phone_id', valor)
        .neq('constructora_id', constructoraId)
        .maybeSingle()
      if (enUso) {
        return NextResponse.json({ error: 'Ese número ya está configurado para otra constructora' }, { status: 409 })
      }
    }

    await adminClient.from('whatsapp_numeros').delete().eq('constructora_id', constructoraId)
    if (valor) {
      const { error } = await adminClient.from('whatsapp_numeros').insert({
        constructora_id: constructoraId,
        kapso_phone_id: valor,
        numero: valorNumero,
        activo: true,
      })
      if (error) {
        return NextResponse.json({ error: 'Ese número ya está configurado para otra constructora' }, { status: 409 })
      }
    }
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const caller = await verifySuperAdmin()
  if (!caller) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const { constructoraId } = await request.json()
  if (!constructoraId) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  const adminClient = createAdminClient()

  // Obtener todos los usuarios de esta constructora ANTES de borrar nada
  // (perfiles.constructora_id se pone en NULL en cascada al borrar la constructora)
  const { data: perfilesDeEsta } = await adminClient
    .from('perfiles')
    .select('id')
    .eq('constructora_id', constructoraId)

  // Purga completa (obras, unidades, contratos, gastos, cuentas, etc.) en
  // el orden correcto según las FK reales — ver migration_018.sql. Es una
  // sola transacción en el server: si falla, no queda nada a mitad de borrar.
  const { error } = await adminClient.rpc('purgar_constructora_completa', {
    p_constructora_id: constructoraId,
  })

  if (error) {
    // Panel interno de superadmin — exponer el mensaje real de Postgres
    // ayuda a diagnosticar sin ida y vuelta (ej: un trigger bloqueando la purga).
    return NextResponse.json(
      { error: `Error al eliminar la constructora y sus datos: ${error.message}` },
      { status: 500 }
    )
  }

  // miembros se borra en cascada. Perfiles no (ON DELETE SET NULL) — lo limpiamos
  // explícitamente junto con los usuarios de auth.
  await adminClient.from('perfiles').delete().in('id', (perfilesDeEsta ?? []).map(p => p.id))

  await Promise.all((perfilesDeEsta ?? []).map(p => adminClient.auth.admin.deleteUser(p.id)))

  return NextResponse.json({ ok: true })
}
