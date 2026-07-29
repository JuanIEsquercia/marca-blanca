import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import ComprasManager from '@/components/admin/ComprasManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Compras' }
export const dynamic = 'force-dynamic'

export default async function ComprasPage() {
  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')

  const supabase = await createClient()

  const [
    { data: ordenes },
    { data: productos },
    { data: proveedores },
    { data: obras },
    { data: categorias },
    { data: stockResumen },
  ] = await Promise.all([
    supabase
      .from('ordenes_compra')
      .select('*, obras(nombre), orden_compra_items(*, productos(id, nombre, unidad_medida), orden_compra_recepcion_items(cantidad_recibida)), orden_compra_recepciones(*, proveedores(razon_social), orden_compra_recepcion_items(*, orden_compra_items(producto_id, productos(nombre, unidad_medida))))')
      .eq('constructora_id', ctx.constructoraId)
      .order('numero', { ascending: false }),
    supabase
      .from('productos')
      .select('*, categorias_costo(nombre, color)')
      .eq('constructora_id', ctx.constructoraId)
      .eq('activo', true)
      .order('nombre'),
    supabase
      .from('proveedores')
      .select('id, razon_social')
      .eq('constructora_id', ctx.constructoraId)
      .eq('activo', true)
      .order('razon_social'),
    supabase
      .from('obras')
      .select('id, nombre, tipo')
      .eq('constructora_id', ctx.constructoraId)
      .order('nombre'),
    supabase
      .from('categorias_costo')
      .select('id, nombre, color')
      .eq('constructora_id', ctx.constructoraId)
      .order('nombre'),
    // Agregado en Postgres (resumen_stock, migration_052) en vez de traer
    // todo el ledger de stock_movimientos al cliente para sumarlo acá —
    // mismo criterio que resumen_unidades_por_obra en app/admin/page.tsx.
    supabase.rpc('resumen_stock', { p_constructora_id: ctx.constructoraId }),
  ])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Compras</h1>
        <p className="text-slate-500 text-sm mt-1">Órdenes de compra, recepciones de proveedores y stock repartido entre obras</p>
      </div>
      <ComprasManager
        ordenes={(ordenes ?? []) as any}
        productos={productos ?? []}
        proveedores={proveedores ?? []}
        obras={obras ?? []}
        categorias={categorias ?? []}
        stockResumen={stockResumen ?? []}
        constructoraId={ctx.constructoraId}
        constructoraNombre={ctx.constructoraNombre}
      />
    </div>
  )
}
