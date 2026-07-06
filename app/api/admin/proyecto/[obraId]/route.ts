import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ obraId: string }> }
) {
  const { obraId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const admin = createAdminClient()

  // Resolver constructora del usuario
  const { data: perfil } = await admin
    .from('perfiles')
    .select('constructora_id')
    .eq('id', user.id)
    .maybeSingle()

  let constructoraId: string | null = (perfil as any)?.constructora_id ?? null

  if (!constructoraId) {
    const { data: miembro } = await admin
      .from('miembros')
      .select('constructora_id')
      .eq('user_id', user.id)
      .maybeSingle()
    constructoraId = miembro?.constructora_id ?? null
  }

  if (!constructoraId) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const { data: obra } = await admin
    .from('obras')
    .select('id, nombre, tipo, modo_cuentas')
    .eq('id', obraId)
    .eq('constructora_id', constructoraId)
    .maybeSingle()

  if (!obra) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })

  return NextResponse.json(obra)
}
