import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProyectoContext } from '@/lib/tenant'
import { calcularTotalesYSaldos, type GastoParaCaja, type MovimientoConCuenta } from '@/lib/tesoreria'
import { cn, formatCurrency as fmt } from '@/lib/utils'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Caja del proyecto' }
export const dynamic = 'force-dynamic'

type IngresoDisplay = Omit<MovimientoConCuenta, 'moneda'> & { moneda: string; fecha: string; descripcion: string; tipo: string }

export default async function CajaProyectoPage({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params
  const ctx = await getProyectoContext(obraId)
  if (!ctx) redirect('/admin')

  const supabase = await createClient()

  // Gastos imputados a este proyecto (mismas filas que usa calcularTotalesYSaldos
  // más abajo — antes se volvían a pedir adentro de calcularCajaProyecto).
  const gastosQuery = supabase
    .from('gastos')
    .select('*, categorias_costo(nombre, color), proveedores(razon_social), pagos:gasto_pagos(estado, monto, cuenta_propia_id)')
    .eq('constructora_id', ctx.constructoraId)
    .eq('obra_id', obraId)
    .order('fecha_vencimiento', { ascending: false })

  const cuentasQuery = supabase.from('cuentas_propias').select('*')
    .eq('constructora_id', ctx.constructoraId)
    .eq('activa', true)
    .order('nombre')
  const cuentasQueryScoped = ctx.obraModo === 'especificas' ? cuentasQuery.eq('obra_id', obraId) : cuentasQuery.is('obra_id', null)

  // Ventas de unidades son siempre USD (precio_lista/cuotas no tienen
  // columna moneda propia — convención del negocio, ver lib/tesoreria.ts).
  const obtenerIngresos = async (): Promise<IngresoDisplay[]> => {
    if (ctx.obraTipo === 'desarrollo') {
      const [{ data: cuotas }, { data: contratos }, { data: reservasVigentes }] = await Promise.all([
        supabase
          .from('cuotas')
          .select('monto_base, monto_cobrado, fecha_pago, cuenta_propia_id, contratos_venta!inner(estado, unidades!inner(obra_id))')
          .eq('estado_pago', 'Pagado')
          .eq('contratos_venta.unidades.obra_id', obraId)
          .eq('contratos_venta.estado', 'vigente'),
        supabase
          .from('contratos_venta')
          .select('entrega_efectiva, fecha_firma, cuenta_propia_id, unidades!inner(obra_id)')
          .eq('unidades.obra_id', obraId)
          .eq('estado', 'vigente')
          .not('entrega_efectiva', 'is', null),
        supabase
          .from('reservas')
          .select('monto_sena, fecha_reserva, cuenta_propia_id')
          .eq('obra_id', obraId)
          .eq('estado', 'Vigente')
          .not('monto_sena', 'is', null),
      ])

      return [
        ...(cuotas ?? []).map(c => ({
          fecha: c.fecha_pago ?? '',
          descripcion: 'Cuota cobrada',
          monto: c.monto_cobrado ?? c.monto_base ?? 0,
          moneda: 'USD',
          tipo: 'cuota',
          cuenta_propia_id: c.cuenta_propia_id ?? null,
        })),
        ...(contratos ?? []).filter(c => (c.entrega_efectiva ?? 0) > 0).map(c => ({
          fecha: c.fecha_firma ?? '',
          descripcion: 'Entrega inicial',
          monto: c.entrega_efectiva ?? 0,
          moneda: 'USD',
          tipo: 'entrega',
          cuenta_propia_id: c.cuenta_propia_id ?? null,
        })),
        ...(reservasVigentes ?? []).map(r => ({
          fecha: r.fecha_reserva ?? '',
          descripcion: 'Seña de reserva',
          monto: r.monto_sena ?? 0,
          moneda: 'USD',
          tipo: 'sena',
          cuenta_propia_id: r.cuenta_propia_id ?? null,
        })),
      ].sort((a, b) => b.fecha.localeCompare(a.fecha))
    }

    // Sin filtro de estado acá a propósito — un cobro con plan de pago
    // parcialmente cumplido sigue Pendiente pero puede tener cuotas ya
    // Cobradas (ver lib/tesoreria.ts). Acá se arma el detalle a mano (en
    // vez de reusar movimientosLiquidados) para no perder la fecha propia
    // de cada cuota en la lista de "Ingresos".
    const { data: cobros } = await supabase
      .from('cobros_proyecto')
      .select('*, cobro_pagos(estado, monto, cuenta_propia_id, fecha_pago)')
      .eq('obra_id', obraId)
      .order('fecha_pago', { ascending: false })

    type CuotaCobroRaw = { estado: string; monto: number; cuenta_propia_id: string | null; fecha_pago: string | null }

    return (cobros ?? []).flatMap(c => {
      const cuotas = (c.cobro_pagos ?? []) as CuotaCobroRaw[]
      if (cuotas.length > 0) {
        return cuotas.filter(p => p.estado === 'Cobrado').map(p => ({
          fecha: p.fecha_pago ?? '',
          descripcion: c.notas ?? 'Cobro de proyecto',
          monto: p.monto,
          moneda: c.moneda,
          tipo: 'cobro',
          cuenta_propia_id: p.cuenta_propia_id ?? null,
        }))
      }
      return c.estado === 'Cobrado' ? [{
        fecha: c.fecha_pago ?? c.fecha,
        descripcion: c.notas ?? 'Cobro de proyecto',
        monto: c.monto,
        moneda: c.moneda,
        tipo: 'cobro',
        cuenta_propia_id: c.cuenta_propia_id ?? null,
      }] : []
    })
  }

  const [{ data: gastos }, { data: cuentas }, ingresos] = await Promise.all([
    gastosQuery,
    cuentasQueryScoped,
    obtenerIngresos(),
  ])

  // Misma función pura que usa el webhook de WhatsApp (lib/tesoreria.ts) —
  // acá recibe los datos que esta página ya trajo arriba, sin volver a pedirlos.
  const { cuentasConSaldo, totalesPorMoneda } = calcularTotalesYSaldos(cuentas ?? [], (gastos ?? []) as unknown as GastoParaCaja[], ingresos)
  const monedasConMovimiento = Object.keys(totalesPorMoneda)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Caja del proyecto</h1>
        <p className="text-slate-500 text-sm mt-1">{ctx.obraNombre} — flujo de caja imputado a este proyecto</p>
      </div>

      {/* Resumen — una fila de tarjetas por moneda, nunca se mezclan ARS/USD en un mismo total */}
      {monedasConMovimiento.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-slate-400 text-sm mb-8">
          Sin movimientos registrados en este proyecto.
        </div>
      ) : (
        <div className="space-y-4 mb-8">
          {monedasConMovimiento.map(moneda => {
            const t = totalesPorMoneda[moneda]
            const saldoNeto = t.ingresos - t.egresosPagados
            return (
              <div key={moneda}>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{moneda}</p>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white border border-slate-200 rounded-2xl p-5">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Ingresos</p>
                    <p className="text-2xl font-bold text-emerald-600">{fmt(t.ingresos, moneda)}</p>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl p-5">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Egresos pagados</p>
                    <p className="text-2xl font-bold text-red-600">{fmt(t.egresosPagados, moneda)}</p>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl p-5">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Saldo neto</p>
                    <p className={cn('text-2xl font-bold', saldoNeto >= 0 ? 'text-slate-900' : 'text-red-600')}>
                      {fmt(saldoNeto, moneda)}
                    </p>
                    {t.egresosPendientes > 0 && (
                      <p className="text-xs text-amber-600 mt-1">{fmt(t.egresosPendientes, moneda)} comprometido pendiente</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

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
