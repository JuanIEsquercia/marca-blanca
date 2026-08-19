import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import { puedeAcceder } from '@/lib/permisos'
import ComprasManager from '@/components/admin/ComprasManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Compras' }
export const dynamic = 'force-dynamic'

const TABS_VALIDOS = ['ordenes', 'stock', 'acopios'] as const
type TabCompras = (typeof TABS_VALIDOS)[number]

interface Props {
  searchParams: Promise<{ tab?: string }>
}

export default async function ComprasPage({ searchParams }: Props) {
  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')

  // ?tab=acopios permite abrir directo en una pestaña — hoy lo usa
  // navegar_a del chat (lib/chat/catalogo-secciones.ts) para poder llevar
  // al usuario directo a "Acopios" en vez de solo a Compras en general.
  const tabParam = (await searchParams).tab
  const tabInicial: TabCompras = TABS_VALIDOS.includes(tabParam as TabCompras) ? (tabParam as TabCompras) : 'ordenes'

  const supabase = await createClient()

  const [
    { data: ordenes },
    { data: productos },
    { data: proveedores },
    { data: obras },
    { data: categorias },
    { data: stockResumen },
    { data: acopios },
    { data: acopiosResumen },
  ] = await Promise.all([
    supabase
      .from('ordenes_compra')
      .select('*, obras(nombre), orden_compra_items(*, productos(id, nombre, unidad_medida), orden_compra_recepcion_items(cantidad_recibida)), orden_compra_recepciones(*, proveedores(razon_social), orden_compra_recepcion_items(*, orden_compra_items(producto_id, productos(nombre, unidad_medida))))')
      .eq('constructora_id', ctx.constructoraId)
      .order('numero', { ascending: false }),
    // Sin filtrar por activo=true: un producto desactivado con stock
    // remanente necesita seguir siendo visible (nombre, reparto) en el tab
    // Stock y reactivable desde "Administrar productos" — ComprasManager
    // filtra a solo-activos donde corresponde (selectores de ítem nuevo).
    supabase
      .from('productos')
      .select('*, categorias_costo(nombre, color)')
      .eq('constructora_id', ctx.constructoraId)
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
    supabase
      .from('acopios')
      .select('*, proveedores(razon_social), productos(nombre, unidad_medida), obras(nombre), acopio_retiros(*, productos(nombre, unidad_medida), obras(nombre))')
      .eq('constructora_id', ctx.constructoraId)
      .order('numero', { ascending: false }),
    // Mismo criterio que resumen_stock: el saldo de cada acopio se agrega
    // en Postgres (migration_062), no se traen todos los retiros para sumar acá.
    supabase.rpc('resumen_acopios', { p_constructora_id: ctx.constructoraId }),
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
        acopios={(acopios ?? []) as any}
        acopiosResumen={acopiosResumen ?? []}
        constructoraId={ctx.constructoraId}
        constructoraNombre={ctx.constructoraNombre}
        puedeCrearProveedor={puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'proveedores', null)}
        tabInicial={tabInicial}
      />
    </div>
  )
}
