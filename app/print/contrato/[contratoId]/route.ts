import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import { puedeAcceder } from '@/lib/permisos'
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
    .select('*, obras(nombre, constructoras(nombre)), compradores(nombre_completo, dni_cuit), contrato_obra_items(rubro, unidad, cantidad, precio_unitario, monto_contratado, origen, orden)')
    .eq('id', contratoId)
    .maybeSingle()

  if (!contrato || contrato.constructora_id !== ctx.constructoraId) {
    return NextResponse.redirect(new URL('/admin', req.url))
  }

  // contratos_obra ("Acuerdo de obra") se gestiona en la pantalla de
  // Certificados (CertificadosManager, bajo /certificados) — el módulo
  // 'contratos' es Ventas de unidades en Desarrollo (contratos_venta),
  // una entidad distinta. Usar esa key acá bloquearía a cualquier operador
  // con permiso real de 'certificados', ya que 'contratos' ni siquiera es
  // asignable en un proyecto tipo Obra (soloTipo: 'desarrollo').
  if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'certificados', contrato.obra_id)) {
    return NextResponse.redirect(new URL('/admin', req.url))
  }

  const clienteNombre = (contrato.compradores as unknown as { nombre_completo: string } | null)?.nombre_completo ?? ''
  const clienteCuit = (contrato.compradores as unknown as { dni_cuit: string | null } | null)?.dni_cuit ?? null
  const obraNombre = (contrato.obras as unknown as { nombre: string } | null)?.nombre ?? ''
  const constructoraNombre = (contrato.obras as unknown as { constructoras: { nombre: string } | null } | null)?.constructoras?.nombre ?? 'Constructora'
  const codigo = contrato.id.slice(0, 8).toUpperCase()
  const items = [...((contrato.contrato_obra_items as unknown as { rubro: string; unidad: string | null; cantidad: number; precio_unitario: number; monto_contratado: number; origen: string; orden: number }[]) ?? [])]
    .sort((a, b) => a.orden - b.orden)

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
    items: items.map(i => ({
      rubro: i.rubro,
      unidad: i.unidad,
      cantidad: i.cantidad,
      precioUnitario: i.precio_unitario,
      montoContratado: i.monto_contratado,
      origen: i.origen,
    })),
    ivaPct: contrato.iva_pct,
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
