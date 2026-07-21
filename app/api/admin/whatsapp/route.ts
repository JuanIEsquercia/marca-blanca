import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getConstructoraContext } from '@/lib/tenant'

const CODIGO_TTL_MINUTOS = 10

async function verificarAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const ctx = await getConstructoraContext()
  if (!ctx || ctx.perfilRol !== 'admin') return null

  return { userId: user.id, ctx }
}

// El número de Kapso (phone_number_id) NO lo configura el admin de la
// constructora acá — este es un sistema white-label donde el superadmin de
// la plataforma es quien contrata/asigna el número por tenant (ver
// app/api/superadmin/constructoras PATCH). Este endpoint solo lee ese
// estado; si todavía no está configurado, el admin no puede generar un
// código de vinculación hasta que el superadmin lo cargue.
export async function GET() {
  const adminUser = await verificarAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const adminClient = createAdminClient()
  // perfiles.telefono es único por constructora (un solo teléfono vinculado
  // a la vez) — puede ser el propio admin u OTRO admin de la misma
  // constructora que vinculó su celular. Se busca por constructora, no por
  // el propio userId, para poder mostrar/desvincular el de un compañero.
  const [{ data: vinculado }, { data: numero }] = await Promise.all([
    adminClient.from('perfiles').select('id, nombre, telefono').eq('constructora_id', adminUser.ctx.constructoraId).eq('rol', 'admin').not('telefono', 'is', null).maybeSingle(),
    adminClient.from('whatsapp_numeros').select('kapso_phone_id, numero').eq('constructora_id', adminUser.ctx.constructoraId).eq('activo', true).maybeSingle(),
  ])

  return NextResponse.json({
    telefono: vinculado?.telefono ?? null,
    vinculadoA: vinculado ? { id: vinculado.id, nombre: vinculado.nombre, esPropio: vinculado.id === adminUser.userId } : null,
    kapsoPhoneId: numero?.kapso_phone_id ?? null,
    numeroWhatsapp: numero?.numero ?? null,
  })
}

export async function POST() {
  const adminUser = await verificarAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const adminClient = createAdminClient()

  const { data: numero } = await adminClient
    .from('whatsapp_numeros')
    .select('id')
    .eq('constructora_id', adminUser.ctx.constructoraId)
    .eq('activo', true)
    .maybeSingle()

  if (!numero) {
    return NextResponse.json({ error: 'Configurá primero el número de Kapso de esta constructora' }, { status: 409 })
  }

  const codigo = crypto.randomInt(100000, 999999).toString()
  const expiraEn = new Date(Date.now() + CODIGO_TTL_MINUTOS * 60_000).toISOString()

  // Invalida cualquier código anterior sin usar de este perfil antes de
  // generar uno nuevo — evita que queden varios códigos válidos en paralelo
  // (cada uno es una ventana de 10 min para el ataque de fuerza bruta que
  // mitiga el rate limiter del webhook).
  await adminClient
    .from('whatsapp_vinculos_pendientes')
    .update({ usado_en: new Date().toISOString() })
    .eq('perfil_id', adminUser.userId)
    .is('usado_en', null)

  const { error } = await adminClient.from('whatsapp_vinculos_pendientes').insert({
    constructora_id: adminUser.ctx.constructoraId,
    perfil_id: adminUser.userId,
    codigo,
    expira_en: expiraEn,
  })

  if (error) {
    return NextResponse.json({ error: 'No se pudo generar el código' }, { status: 500 })
  }

  return NextResponse.json({ codigo, expiraEn })
}

export async function DELETE() {
  const adminUser = await verificarAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const adminClient = createAdminClient()
  // Se desvincula por constructora, no por el propio userId: perfiles.telefono
  // es único por constructora (a lo sumo un admin lo tiene vinculado a la
  // vez), y cualquier admin de esa constructora tiene que poder revocarlo —
  // antes solo el admin que lo vinculó podía, dejando el teléfono huérfano
  // sin forma de recuperarlo desde el panel si esa persona dejaba la empresa.
  const { error } = await adminClient
    .from('perfiles')
    .update({ telefono: null })
    .eq('constructora_id', adminUser.ctx.constructoraId)
    .eq('rol', 'admin')
    .not('telefono', 'is', null)

  if (error) {
    return NextResponse.json({ error: 'No se pudo desvincular' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
