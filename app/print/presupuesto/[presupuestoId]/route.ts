import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import { puedeAcceder } from '@/lib/permisos'
import { renderPresupuestoPdf } from '@/lib/pdf/presupuesto-document'

export const dynamic = 'force-dynamic'

// PDF real (@react-pdf/renderer) en vez de una página HTML con CSS de
// impresión del navegador — @page/padding duplicados venían generando
// desborde a una segunda hoja y un layout apretado que no se podía
// controlar de forma confiable entre navegadores. Un PDF generado en el
// servidor tiene el mismo resultado siempre, sin depender del motor de
// impresión de cada browser.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ presupuestoId: string }> }
) {
  const { presupuestoId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/auth/login', req.url))

  const ctx = await getConstructoraContext()
  if (!ctx) return NextResponse.redirect(new URL('/auth/login', req.url))

  const admin = createAdminClient()

  const { data: presupuesto } = await admin
    .from('presupuestos')
    .select('*, presupuesto_items(*), constructoras(nombre), obras(nombre)')
    .eq('id', presupuestoId)
    .maybeSingle()

  if (!presupuesto || presupuesto.constructora_id !== ctx.constructoraId) {
    return NextResponse.redirect(new URL('/admin/presupuestos', req.url))
  }

  // presupuestos es módulo de empresa (no cuelga de proyecto), ver MODULOS_EMPRESA
  if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'presupuestos', null)) {
    return NextResponse.redirect(new URL('/admin/presupuestos', req.url))
  }

  const constructoraNombre = (presupuesto.constructoras as unknown as { nombre: string } | null)?.nombre ?? 'Constructora'
  const obraNombre = (presupuesto.obras as unknown as { nombre: string } | null)?.nombre ?? null
  const items = [...(presupuesto.presupuesto_items ?? [])].sort((a, b) => a.orden - b.orden)
  const total = items.reduce((s, i) => s + i.subtotal, 0)
  const codigo = presupuesto.id.slice(0, 8).toUpperCase()

  const buffer = await renderPresupuestoPdf({
    constructoraNombre,
    obraNombre,
    clienteNombre: presupuesto.cliente_nombre,
    clienteCuit: presupuesto.cliente_cuit,
    clienteEmail: presupuesto.cliente_email,
    clienteTelefono: presupuesto.cliente_telefono,
    createdAt: presupuesto.created_at,
    estado: presupuesto.estado,
    fechaInicio: presupuesto.fecha_inicio,
    fechaFinEstimada: presupuesto.fecha_fin_estimada,
    descripcion: presupuesto.descripcion,
    notas: presupuesto.notas,
    moneda: presupuesto.moneda,
    items: items.map(i => ({
      rubro: i.rubro,
      cantidad: i.cantidad,
      unidad: i.unidad,
      precio_unitario: i.precio_unitario,
      subtotal: i.subtotal,
    })),
    total,
    codigo,
  })

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="presupuesto-${codigo}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
