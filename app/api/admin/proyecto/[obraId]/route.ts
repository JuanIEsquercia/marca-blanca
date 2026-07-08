import { createClient } from '@/lib/supabase/server'
import { getProyectoContext } from '@/lib/tenant'
import { NextResponse } from 'next/server'

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
