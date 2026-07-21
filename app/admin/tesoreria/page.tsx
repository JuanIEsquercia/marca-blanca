import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import { calcularCajaEmpresa } from '@/lib/tesoreria'
import TesoreriaView, { type MovimientoFlujo } from '@/components/admin/TesoreriaView'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Caja' }
export const dynamic = 'force-dynamic'

function getLast12Months() {
  const months = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: d.toLocaleDateString('es-AR', { month: 'short', year: 'numeric' }),
    })
  }
  return months
}

export default async function TesoreriaPage() {
  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')

  const supabase = await createClient()

  const [
    { data: obras },
    { data: cuotas },
    { data: contratos },
    { data: gastos },
    { data: cobrosProyecto },
    cuentasConSaldo,
  ] = await Promise.all([
    supabase.from('obras').select('id, nombre').eq('constructora_id', ctx.constructoraId).order('nombre'),
    supabase.from('cuotas')
      .select('monto_base, monto_cobrado, fecha_pago, estado_pago, contratos_venta(obra_id)')
      .eq('constructora_id', ctx.constructoraId).eq('estado_pago', 'Pagado'),
    supabase.from('contratos_venta').select('entrega_efectiva, fecha_firma, obra_id').eq('constructora_id', ctx.constructoraId),
    supabase.from('gastos').select('*, proveedores(razon_social), categorias_costo(nombre, color)').eq('constructora_id', ctx.constructoraId),
    supabase.from('cobros_proyecto').select('monto, moneda, fecha_pago, fecha, obra_id').eq('constructora_id', ctx.constructoraId).eq('estado', 'cobrado'),
    calcularCajaEmpresa(supabase, ctx.constructoraId),
  ])

  // Serie normalizada de movimientos con su obra_id — antes el "Flujo
  // mensual" sumaba todo junto sin distinguir de qué proyecto venía cada
  // ingreso/egreso; ahora el filtro de proyecto en TesoreriaView recalcula
  // esto mismo del lado del cliente sin ir de nuevo a la base.
  const movimientos: MovimientoFlujo[] = [
    ...(cuotas ?? []).map(c => ({
      tipo: 'ingreso' as const, moneda: 'USD', monto: c.monto_cobrado ?? c.monto_base ?? 0,
      fecha: c.fecha_pago, obraId: (c.contratos_venta as unknown as { obra_id: string } | null)?.obra_id ?? null,
    })),
    ...(contratos ?? []).filter(c => (c.entrega_efectiva ?? 0) > 0).map(c => ({
      tipo: 'ingreso' as const, moneda: 'USD', monto: c.entrega_efectiva ?? 0,
      fecha: c.fecha_firma, obraId: c.obra_id,
    })),
    ...(cobrosProyecto ?? []).map(c => ({
      tipo: 'ingreso' as const, moneda: c.moneda, monto: c.monto ?? 0,
      fecha: c.fecha_pago ?? c.fecha, obraId: c.obra_id,
    })),
    ...(gastos ?? []).map(g => ({
      tipo: (g.estado === 'Pagado' ? 'egreso' : 'comprometido') as 'egreso' | 'comprometido',
      moneda: g.moneda, monto: g.monto ?? 0,
      fecha: g.estado === 'Pagado' ? g.fecha_pago : g.fecha_vencimiento,
      obraId: g.obra_id,
    })),
  ]

  const gastosPendientes = (gastos ?? [])
    .filter(g => g.estado === 'Pendiente')
    .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))
    .map(g => ({
      id: g.id,
      descripcion: g.descripcion,
      monto: g.monto,
      moneda: g.moneda,
      fecha_vencimiento: g.fecha_vencimiento,
      proveedor: g.proveedores?.razon_social ?? null,
      categoria: g.categorias_costo?.nombre ?? null,
      categoria_color: g.categorias_costo?.color ?? null,
      obraId: g.obra_id,
    }))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Caja</h1>
        <p className="text-slate-500 text-sm mt-1">Saldos por cuenta y flujo de caja mensual — todos los proyectos</p>
      </div>
      <TesoreriaView
        cuentas={cuentasConSaldo}
        movimientos={movimientos}
        meses={getLast12Months()}
        proyectos={obras ?? []}
        gastosPendientes={gastosPendientes}
      />
    </div>
  )
}
