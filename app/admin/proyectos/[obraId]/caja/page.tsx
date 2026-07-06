import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProyectoContext } from '@/lib/tenant'
import { cn } from '@/lib/utils'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Caja del proyecto' }
export const dynamic = 'force-dynamic'

function fmt(n: number, moneda = 'USD') {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

export default async function CajaProyectoPage({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params
  const ctx = await getProyectoContext(obraId)
  if (!ctx) redirect('/admin')

  const supabase = await createClient()
  const admin = createAdminClient()

  // Cuentas del proyecto: propias si modo=especificas, empresa si modo=empresa
  const cuentasQuery = supabase.from('cuentas_propias').select('*')
    .eq('constructora_id', ctx.constructoraId)
    .eq('activa', true)
    .order('nombre')

  const { data: cuentas } = await (
    ctx.obraModo === 'especificas'
      ? cuentasQuery.eq('obra_id', obraId)
      : cuentasQuery.is('obra_id', null)
  )

  // Gastos imputados a este proyecto
  const { data: gastos } = await supabase
    .from('gastos')
    .select('*, categorias_costo(nombre, color), proveedores(razon_social)')
    .eq('constructora_id', ctx.constructoraId)
    .eq('obra_id', obraId)
    .order('fecha_vencimiento', { ascending: false })

  let ingresos: { fecha: string; descripcion: string; monto: number; moneda: string; tipo: string }[] = []
  let ingresosConCuenta: { monto: number; cuenta_propia_id: string | null }[] = []

  if (ctx.obraTipo === 'desarrollo') {
    const { data: cuotas } = await supabase
      .from('cuotas')
      .select('monto_base, fecha_pago, cuenta_propia_id, contratos_venta!inner(unidades!inner(obra_id))')
      .eq('estado_pago', 'Pagado')
      .eq('contratos_venta.unidades.obra_id', obraId)

    const { data: contratos } = await supabase
      .from('contratos_venta')
      .select('entrega_efectiva, fecha_firma, cuenta_propia_id, unidades!inner(obra_id)')
      .eq('unidades.obra_id', obraId)
      .not('entrega_efectiva', 'is', null)

    ingresos = [
      ...(cuotas ?? []).map(c => ({
        fecha: c.fecha_pago ?? '',
        descripcion: 'Cuota cobrada',
        monto: c.monto_base ?? 0,
        moneda: 'USD',
        tipo: 'cuota',
      })),
      ...(contratos ?? []).filter(c => (c.entrega_efectiva ?? 0) > 0).map(c => ({
        fecha: c.fecha_firma ?? '',
        descripcion: 'Entrega inicial',
        monto: c.entrega_efectiva ?? 0,
        moneda: 'USD',
        tipo: 'entrega',
      })),
    ].sort((a, b) => b.fecha.localeCompare(a.fecha))

    ingresosConCuenta = [
      ...(cuotas ?? []).map(c => ({ monto: c.monto_base ?? 0, cuenta_propia_id: c.cuenta_propia_id ?? null })),
      ...(contratos ?? []).filter(c => (c.entrega_efectiva ?? 0) > 0).map(c => ({ monto: c.entrega_efectiva ?? 0, cuenta_propia_id: c.cuenta_propia_id ?? null })),
    ]
  } else {
    const { data: cobros } = await supabase
      .from('cobros_proyecto')
      .select('*')
      .eq('obra_id', obraId)
      .eq('estado', 'cobrado')
      .order('fecha_pago', { ascending: false })

    ingresos = (cobros ?? []).map(c => ({
      fecha: c.fecha_pago ?? c.fecha,
      descripcion: c.notas ?? 'Cobro de proyecto',
      monto: c.monto,
      moneda: 'ARS',
      tipo: 'cobro',
    }))

    ingresosConCuenta = (cobros ?? []).map(c => ({ monto: c.monto, cuenta_propia_id: c.cuenta_propia_id ?? null }))
  }

  const totalIngresos = ingresos.reduce((s, i) => s + i.monto, 0)
  const totalEgresosPagados = (gastos ?? []).filter(g => g.estado === 'Pagado').reduce((s, g) => s + (g.monto ?? 0), 0)
  const totalEgresosPendientes = (gastos ?? []).filter(g => g.estado === 'Pendiente').reduce((s, g) => s + (g.monto ?? 0), 0)

  const cuentasConSaldo = (cuentas ?? []).map(cuenta => {
    const ingresosCuenta = ingresosConCuenta
      .filter(i => i.cuenta_propia_id === cuenta.id)
      .reduce((s, i) => s + i.monto, 0)
    const egresosCuenta = (gastos ?? [])
      .filter(g => g.cuenta_propia_id === cuenta.id && g.estado === 'Pagado')
      .reduce((s, g) => s + (g.monto ?? 0), 0)
    return { ...cuenta, saldo_actual: cuenta.saldo_inicial + ingresosCuenta - egresosCuenta }
  })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Caja del proyecto</h1>
        <p className="text-slate-500 text-sm mt-1">{ctx.obraNombre} — flujo de caja imputado a este proyecto</p>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Ingresos</p>
          <p className="text-2xl font-bold text-emerald-600">{fmt(totalIngresos)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Egresos pagados</p>
          <p className="text-2xl font-bold text-red-600">{fmt(totalEgresosPagados)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Saldo neto</p>
          <p className={cn('text-2xl font-bold', totalIngresos - totalEgresosPagados >= 0 ? 'text-slate-900' : 'text-red-600')}>
            {fmt(totalIngresos - totalEgresosPagados)}
          </p>
          {totalEgresosPendientes > 0 && (
            <p className="text-xs text-amber-600 mt-1">{fmt(totalEgresosPendientes)} comprometido pendiente</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Cuentas del proyecto */}
        {cuentasConSaldo.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm">Cuentas del proyecto</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {cuentasConSaldo.map(c => (
                <div key={c.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{c.nombre}</p>
                    <p className="text-xs text-slate-400">{c.tipo} · {c.moneda}</p>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{fmt(c.saldo_actual, c.moneda)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Ingresos */}
        <div className="bg-white border border-slate-200 rounded-2xl">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm">Ingresos</h2>
          </div>
          {ingresos.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">Sin ingresos registrados</div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto admin-scroll">
              {ingresos.map((ing, i) => (
                <div key={i} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{ing.descripcion}</p>
                    {ing.fecha && (
                      <p className="text-xs text-slate-400">
                        {new Date(ing.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-emerald-600">+{fmt(ing.monto, ing.moneda)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Egresos */}
        <div className="bg-white border border-slate-200 rounded-2xl xl:col-span-2">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm">Egresos del proyecto</h2>
          </div>
          {(gastos ?? []).length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">Sin gastos imputados a este proyecto</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="px-5 py-3">Descripción</th>
                    <th className="px-5 py-3">Categoría</th>
                    <th className="px-5 py-3">Proveedor</th>
                    <th className="px-5 py-3">Vencimiento</th>
                    <th className="px-5 py-3 text-right">Monto</th>
                    <th className="px-5 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(gastos ?? []).map(g => (
                    <tr key={g.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-800">{g.descripcion}</td>
                      <td className="px-5 py-3">
                        {g.categorias_costo ? (
                          <span className="flex items-center gap-1.5 text-xs">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: g.categorias_costo.color ?? '#94a3b8' }} />
                            {g.categorias_costo.nombre}
                          </span>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{g.proveedores?.razon_social ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-500">
                        {g.fecha_vencimiento
                          ? new Date(g.fecha_vencimiento).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
                          : '—'}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-800">
                        {fmt(g.monto ?? 0, g.moneda)}
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn(
                          'text-xs font-medium px-2 py-0.5 rounded',
                          g.estado === 'Pagado'
                            ? 'bg-emerald-100 text-emerald-700'
                            : g.estado === 'Pendiente'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-slate-100 text-slate-500'
                        )}>
                          {g.estado}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
