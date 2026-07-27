import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import { puedeAcceder } from '@/lib/permisos'
import ProveedoresManager from '@/components/admin/ProveedoresManager'
import type { Metadata } from 'next'
import type { GastoCuentaCorriente } from '@/types/database'

export const metadata: Metadata = { title: 'Proveedores' }
export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ historial?: string }>
}

export default async function ProveedoresPage({ searchParams }: Props) {
  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')

  const supabase = await createClient()

  // La cuenta corriente lee de gastos, así que respeta el mismo permiso
  // ('gastos') y el mismo recorte de historial que /admin/gastos — un
  // operador con Proveedores pero sin Gastos ve la página igual, pero sin
  // montos (RLS de gastos no le devuelve filas).
  const puedeVerGastos = puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'gastos', null)
  const verHistorialCompleto = (await searchParams).historial === 'todo'
  const hace12Meses = new Date()
  hace12Meses.setMonth(hace12Meses.getMonth() - 12)
  const ventanaInicio = hace12Meses.toISOString().slice(0, 10)

  const GASTO_CC_SELECT = 'id, proveedor_id, descripcion, monto, moneda, estado, fecha_vencimiento, fecha_pago, obras(nombre)'

  let gastosPagadosQuery = supabase
    .from('gastos')
    .select(GASTO_CC_SELECT)
    .eq('constructora_id', ctx.constructoraId)
    .eq('estado', 'Pagado')
    .not('proveedor_id', 'is', null)
    .order('fecha_pago', { ascending: false })
  if (!verHistorialCompleto) gastosPagadosQuery = gastosPagadosQuery.gte('fecha_pago', ventanaInicio)

  const [{ data: proveedores }, { data: gastosPendientes }, { data: gastosPagados }] = await Promise.all([
    supabase
      .from('proveedores')
      .select('*, cuentas_proveedor(*)')
      .eq('constructora_id', ctx.constructoraId)
      .order('razon_social'),
    supabase
      .from('gastos')
      .select(GASTO_CC_SELECT)
      .eq('constructora_id', ctx.constructoraId)
      .eq('estado', 'Pendiente')
      .not('proveedor_id', 'is', null)
      .order('fecha_vencimiento', { ascending: true }),
    gastosPagadosQuery,
  ])

  const gastos = [...(gastosPendientes ?? []), ...(gastosPagados ?? [])] as unknown as GastoCuentaCorriente[]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Proveedores</h1>
        <p className="text-slate-500 text-sm mt-1">Gestión de proveedores, sus cuentas de cobro y lo que se les debe</p>
      </div>
      <ProveedoresManager
        proveedores={proveedores ?? []}
        gastos={gastos}
        constructoraId={ctx.constructoraId}
        puedeVerGastos={puedeVerGastos}
        historialAcotado={!verHistorialCompleto}
      />
    </div>
  )
}
