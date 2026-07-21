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
  const [{ data: perfil }, { data: numero }] = await Promise.all([
    adminClient.from('perfiles').select('telefono').eq('id', adminUser.userId).maybeSingle(),
    adminClient.from('whatsapp_numeros').select('kapso_phone_id, numero').eq('constructora_id', adminUser.ctx.constructoraId).eq('activo', true).maybeSingle(),
  ])

  return NextResponse.json({
    telefono: perfil?.telefono ?? null,
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
  const { error } = await adminClient
    .from('perfiles')
    .update({ telefono: null })
    .eq('id', adminUser.userId)

  if (error) {
    return NextResponse.json({ error: 'No se pudo desvincular' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
