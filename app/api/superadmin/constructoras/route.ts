import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

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
    { data: authData },
    { data: numeros },
  ] = await Promise.all([
    adminClient.from('constructoras').select('id, nombre, owner_id, created_at').order('created_at', { ascending: false }),
    adminClient.from('perfiles').select('id, nombre, rol, constructora_id').not('constructora_id', 'is', null),
    adminClient.auth.admin.listUsers(),
    adminClient.from('whatsapp_numeros').select('constructora_id, kapso_phone_id, numero').eq('activo', true),
  ])

  const result = (constructoras ?? []).map(c => {
    const perfilesDeEsta = (perfiles ?? []).filter(p => p.constructora_id === c.id)
    const usuarios = perfilesDeEsta.map(p => {
      const authUser = authData?.users.find(u => u.id === p.id)
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
    }
  })

  return NextResponse.json(result)
}

export async function POST(request: Request) {
  const caller = await verifySuperAdmin()
  if (!caller) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const { nombre, adminEmail, adminPassword, adminNombre } = await request.json()
  if (!nombre?.trim() || !adminEmail?.trim() || !adminPassword?.trim()) {
    return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const { data: newUser, error: authError } = await adminClient.auth.admin.createUser({
    email: adminEmail.trim().toLowerCase(),
    password: adminPassword,
    email_confirm: true,
  })

  if (authError || !newUser.user) {
    return NextResponse.json({ error: authError?.message ?? 'Error al crear el usuario' }, { status: 500 })
  }

  const userId = newUser.user.id

  const { data: constructora, error: cError } = await adminClient
    .from('constructoras')
    .insert({ nombre: nombre.trim(), owner_id: userId })
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

  const { constructoraId, nombre, kapsoPhoneId, numeroWhatsapp } = await request.json()
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

  for (const p of perfilesDeEsta ?? []) {
    await adminClient.auth.admin.deleteUser(p.id)
  }

  return NextResponse.json({ ok: true })
}
