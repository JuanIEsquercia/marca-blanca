import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import { renderContratoPdf } from '@/lib/pdf/contrato-document'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ contratoId: string }> }
) {
  const { contratoId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/auth/login', req.url))

  const ctx = await getConstructoraContext()
  if (!ctx) return NextResponse.redirect(new URL('/auth/login', req.url))

  const admin = createAdminClient()

  const { data: contrato } = await admin
    .from('contratos_obra')
    .select('*, obras(nombre, constructoras(nombre)), compradores(nombre_completo, dni_cuit)')
    .eq('id', contratoId)
    .maybeSingle()

  if (!contrato || contrato.constructora_id !== ctx.constructoraId) {
    return NextResponse.redirect(new URL('/admin', req.url))
  }

  const clienteNombre = (contrato.compradores as unknown as { nombre_completo: string } | null)?.nombre_completo ?? ''
  const clienteCuit = (contrato.compradores as unknown as { dni_cuit: string | null } | null)?.dni_cuit ?? null
  const obraNombre = (contrato.obras as unknown as { nombre: string } | null)?.nombre ?? ''
  const constructoraNombre = (contrato.obras as unknown as { constructoras: { nombre: string } | null } | null)?.constructoras?.nombre ?? 'Constructora'
  const codigo = contrato.id.slice(0, 8).toUpperCase()

  const buffer = await renderContratoPdf({
    constructoraNombre,
    obraNombre,
    clienteNombre,
    clienteCuit,
    montoTotal: contrato.monto_total,
    moneda: contrato.moneda,
    fechaInicio: contrato.fecha_inicio,
    fechaFinEstimada: contrato.fecha_fin_estimada,
    descripcion: contrato.descripcion,
    codigo,
  })

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="contrato-${codigo}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
