import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import { puedeAcceder } from '@/lib/permisos'
import GastosManager from '@/components/admin/GastosManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Gastos' }
export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ historial?: string }>
}

export default async function GastosPage({ searchParams }: Props) {
  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')

  const supabase = await createClient()

  // Default: gastos Pagados de los últimos 12 meses + TODOS los Pendientes
  // (una deuda vieja sigue siendo relevante aunque esté fuera de la
  // ventana). Sin este filtro, se traía todo el historial de la
  // constructora en cada carga — sujeto al límite default de PostgREST
  // (~1000 filas) y cada vez más lento con el tiempo. ?historial=todo lo
  // desactiva a pedido (link "Ver historial completo" en GastosManager).
  const verHistorialCompleto = (await searchParams).historial === 'todo'
  const hace12Meses = new Date()
  hace12Meses.setMonth(hace12Meses.getMonth() - 12)
  const ventanaInicio = hace12Meses.toISOString().slice(0, 10)

  const GASTOS_SELECT = '*, proveedores(*), cuentas_proveedor(*), categorias_costo(*), cuentas_propias(*)'

  let gastosPagadosQuery = supabase
    .from('gastos')
    .select(GASTOS_SELECT)
    .eq('constructora_id', ctx.constructoraId)
    .eq('estado', 'Pagado')
    .order('fecha_vencimiento', { ascending: true })
  if (!verHistorialCompleto) gastosPagadosQuery = gastosPagadosQuery.gte('fecha_pago', ventanaInicio)

  const [{ data: gastosPagados }, { data: gastosPendientes }, { data: proveedores }, { data: categorias }, { data: cuentasPropias }] =
    await Promise.all([
      gastosPagadosQuery,
      supabase
        .from('gastos')
        .select(GASTOS_SELECT)
        .eq('constructora_id', ctx.constructoraId)
        .eq('estado', 'Pendiente')
        .order('fecha_vencimiento', { ascending: true }),
      supabase
        .from('proveedores')
        .select('*, cuentas_proveedor(*)')
        .eq('constructora_id', ctx.constructoraId)
        .order('razon_social'),
      supabase
        .from('categorias_costo')
        .select('*')
        .eq('constructora_id', ctx.constructoraId)
        .order('nombre'),
      supabase.from('cuentas_propias').select('*').eq('constructora_id', ctx.constructoraId).eq('activa', true).order('nombre'),
    ])

  const gastos = [...(gastosPendientes ?? []), ...(gastosPagados ?? [])]
    .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Gastos</h1>
        <p className="text-slate-500 text-sm mt-1">Registro de egresos de la constructora — todos los proyectos</p>
      </div>
      <GastosManager
        gastos={gastos}
        proveedores={proveedores ?? []}
        categorias={categorias ?? []}
        cuentasPropias={cuentasPropias ?? []}
        constructoraId={ctx.constructoraId}
        readOnly={!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'gastos', null)}
        historialAcotado={!verHistorialCompleto}
      />
    </div>
  )
}
