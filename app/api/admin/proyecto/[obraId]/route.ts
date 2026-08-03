import { createClient } from '@/lib/supabase/server'
import { getProyectoContext } from '@/lib/tenant'
import { NextResponse } from 'next/server'

// purgar_obra_completa() (ver DELETE más abajo) puede tardar más que el
// default de la plataforma en proyectos con mucho historial — margen extra
// además del fix real (índices faltantes, migration_039.sql).
export const maxDuration = 60

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ obraId: string }> }
) {
  const { obraId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const ctx = await getProyectoContext(obraId)
  if (!ctx) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })

  return NextResponse.json({
    id: ctx.obraId,
    nombre: ctx.obraNombre,
    tipo: ctx.obraTipo,
    modo_cuentas: ctx.obraModo,
  })
}

// Proxy server-side de las escrituras sobre `obras` (cambiar estado /
// purgar_obra_completa). Confirmado en vivo (usuario, 2026-07-23): en
// Firefox, la llamada directa del browser a supabase.co para estas dos
// operaciones puntuales se corta a mitad de camino (nunca llega respuesta,
// no es un error HTTP) mientras que Chrome/Edge y otras tablas (gastos)
// andan bien con el mismo patrón — headers de la request confirmados
// correctos (apikey/token/origin OK), así que no es un problema de
// autorización ni de la app. Sin poder reproducirlo, la hipótesis más
// probable es algo de red del lado del cliente (p.ej. Firefox intentando
// HTTP/3-QUIC sobre una red que lo bloquea). En vez de perseguir esa causa,
// se saca el fetch del browser: el server de Vercel llama a Supabase por
// su cuenta, sin depender de la red del usuario. purgar_obra_completa es
// SECURITY INVOKER a propósito (ver migration_033.sql) — las policies
// existentes ya autorizan cada DELETE con la sesión del usuario, así que
// proxyar esto server-side no cambia la autorización.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ obraId: string }> }
) {
  const { obraId } = await params
  const { estado } = await req.json()

  // Chequeo explícito de rol: las RLS de `obras` ya exigen es_admin() para
  // este UPDATE, pero purgar_obra_completa (DELETE, más abajo) dispara un
  // borrado en cascada sobre tablas cuyas RLS solo exigen permiso normal de
  // proyecto (no admin) — sin este chequeo acá, un operador con permiso en
  // un solo módulo de su proyecto podía purgarlo entero vía este endpoint.
  const ctx = await getProyectoContext(obraId)
  if (!ctx) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
  if (ctx.perfilRol !== 'admin') return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const supabase = await createClient()
  const { error } = await supabase.from('obras').update({ estado }).eq('id', obraId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ obraId: string }> }
) {
  const { obraId } = await params

  const ctx = await getProyectoContext(obraId)
  if (!ctx) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
  if (ctx.perfilRol !== 'admin') return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const supabase = await createClient()
  const { error } = await supabase.rpc('purgar_obra_completa', { p_obra_id: obraId })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}
