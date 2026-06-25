import { createClient } from '@/lib/supabase/server'
import TesoreriaView from '@/components/admin/TesoreriaView'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Tesorería' }
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
  const supabase = await createClient()

  const [
    { data: cuentas },
    { data: cuotas },
    { data: contratos },
    { data: gastos },
  ] = await Promise.all([
    supabase.from('cuentas_propias').select('*').eq('activa', true).order('nombre'),
    supabase.from('cuotas').select('monto_base, fecha_pago, estado_pago, cuenta_propia_id').eq('estado_pago', 'Pagado'),
    supabase.from('contratos_venta').select('entrega_efectiva, fecha_firma, cuenta_propia_id'),
    supabase.from('gastos').select('*, proveedores(razon_social), categorias_costo(nombre, color)'),
  ])

  // ── Saldos por cuenta ─────────────────────────────────────
  const cuentasConSaldo = (cuentas ?? []).map(cuenta => {
    const ingresosCuotas = (cuotas ?? [])
      .filter(c => c.cuenta_propia_id === cuenta.id)
      .reduce((s, c) => s + (c.monto_base ?? 0), 0)

    const ingresosEntregas = (contratos ?? [])
      .filter(c => c.cuenta_propia_id === cuenta.id)
      .reduce((s, c) => s + (c.entrega_efectiva ?? 0), 0)

    const egresos = (gastos ?? [])
      .filter(g => g.cuenta_propia_id === cuenta.id && g.estado === 'Pagado')
      .reduce((s, g) => s + (g.monto ?? 0), 0)

    return {
      ...cuenta,
      ingresos_ventas: ingresosCuotas + ingresosEntregas,
      egresos_gastos: egresos,
      saldo_actual: cuenta.saldo_inicial + ingresosCuotas + ingresosEntregas - egresos,
    }
  })

  // ── Flujo mensual (últimos 12 meses) ─────────────────────
  const meses = getLast12Months()

  const flujoMensual = meses.map(({ year, month, label }) => {
    const inMonth = (dateStr: string | null) => {
      if (!dateStr) return false
      const d = new Date(dateStr)
      return d.getFullYear() === year && d.getMonth() + 1 === month
    }

    const ingresos_usd = [
      ...(cuotas ?? []).filter(c => inMonth(c.fecha_pago)).map(c => c.monto_base ?? 0),
      ...(contratos ?? []).filter(c => inMonth(c.fecha_firma)).map(c => c.entrega_efectiva ?? 0),
    ].reduce((s, v) => s + v, 0)

    const egresos_usd = (gastos ?? [])
      .filter(g => g.estado === 'Pagado' && g.moneda === 'USD' && inMonth(g.fecha_pago))
      .reduce((s, g) => s + (g.monto ?? 0), 0)

    const egresos_ars = (gastos ?? [])
      .filter(g => g.estado === 'Pagado' && g.moneda === 'ARS' && inMonth(g.fecha_pago))
      .reduce((s, g) => s + (g.monto ?? 0), 0)

    const comprometido_usd = (gastos ?? [])
      .filter(g => g.estado === 'Pendiente' && g.moneda === 'USD' && inMonth(g.fecha_vencimiento))
      .reduce((s, g) => s + (g.monto ?? 0), 0)

    const comprometido_ars = (gastos ?? [])
      .filter(g => g.estado === 'Pendiente' && g.moneda === 'ARS' && inMonth(g.fecha_vencimiento))
      .reduce((s, g) => s + (g.monto ?? 0), 0)

    return { label, ingresos_usd, egresos_usd, egresos_ars, comprometido_usd, comprometido_ars }
  })

  // ── Gastos pendientes ordenados por vencimiento ───────────
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
    }))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Tesorería</h1>
        <p className="text-slate-500 text-sm mt-1">Saldos por cuenta y flujo de caja mensual</p>
      </div>
      <TesoreriaView
        cuentas={cuentasConSaldo}
        flujoMensual={flujoMensual}
        gastosPendientes={gastosPendientes}
      />
    </div>
  )
}
