'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { CuentaPropia } from '@/types/database'

interface CuentaConSaldo extends CuentaPropia {
  ingresos_ventas: number
  egresos_gastos: number
  saldo_actual: number
}

interface MesFlujo {
  label: string
  ingresos_usd: number
  egresos_usd: number
  egresos_ars: number
  comprometido_usd: number
  comprometido_ars: number
}

interface GastoPendiente {
  id: string
  descripcion: string
  monto: number
  moneda: string
  fecha_vencimiento: string
  proveedor: string | null
  categoria: string | null
  categoria_color: string | null
}

interface Props {
  cuentas: CuentaConSaldo[]
  flujoMensual: MesFlujo[]
  gastosPendientes: GastoPendiente[]
}

function formatARS(n: number) {
  return '$ ' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 })
}
function formatUSD(n: number) {
  return 'U$D ' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 })
}

export default function TesoreriaView({ cuentas, flujoMensual, gastosPendientes }: Props) {
  const [tab, setTab] = useState<'flujo' | 'pendientes'>('flujo')

  const cuentasARS = cuentas.filter(c => c.moneda === 'ARS')
  const cuentasUSD = cuentas.filter(c => c.moneda === 'USD')

  const totalPendienteARS = gastosPendientes.filter(g => g.moneda === 'ARS').reduce((s, g) => s + g.monto, 0)
  const totalPendienteUSD = gastosPendientes.filter(g => g.moneda === 'USD').reduce((s, g) => s + g.monto, 0)

  return (
    <div className="space-y-6">
      {/* Saldos por cuenta */}
      {cuentasUSD.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Cuentas USD</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cuentasUSD.map(c => (
              <CuentaCard key={c.id} cuenta={c} />
            ))}
          </div>
        </div>
      )}

      {cuentasARS.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Cuentas ARS</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cuentasARS.map(c => (
              <CuentaCard key={c.id} cuenta={c} />
            ))}
          </div>
        </div>
      )}

      {cuentas.length === 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center text-slate-400">
          <p className="text-sm">No hay cuentas propias configuradas.</p>
          <p className="text-xs mt-1">Creá tus cuentas en <strong>Configuración → Cuentas</strong> para ver los saldos.</p>
        </div>
      )}

      {/* Tabs: Flujo mensual | Comprometido pendiente */}
      <div>
        <div className="flex gap-1 mb-4 border-b border-slate-200">
          <button
            onClick={() => setTab('flujo')}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === 'flujo' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}>
            Flujo mensual
          </button>
          <button
            onClick={() => setTab('pendientes')}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2',
              tab === 'pendientes' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}>
            Comprometido pendiente
            {gastosPendientes.length > 0 && (
              <span className="bg-orange-100 text-orange-700 text-xs font-semibold px-1.5 py-0.5 rounded-full">
                {gastosPendientes.length}
              </span>
            )}
          </button>
        </div>

        {tab === 'flujo' && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Mes</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600 text-blue-700">Ingresos USD</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600 text-red-700">Egresos USD</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600 text-red-700">Egresos ARS</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Saldo USD</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600 text-orange-600">Comprometido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {flujoMensual.map(mes => {
                  const saldo = mes.ingresos_usd - mes.egresos_usd
                  return (
                    <tr key={mes.label} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-700">{mes.label}</td>
                      <td className="px-4 py-3 text-right text-blue-700">
                        {mes.ingresos_usd > 0 ? formatUSD(mes.ingresos_usd) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-red-600">
                        {mes.egresos_usd > 0 ? formatUSD(mes.egresos_usd) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-red-600">
                        {mes.egresos_ars > 0 ? formatARS(mes.egresos_ars) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className={cn(
                        'px-4 py-3 text-right font-semibold',
                        saldo > 0 ? 'text-green-600' : saldo < 0 ? 'text-red-600' : 'text-slate-400'
                      )}>
                        {saldo !== 0 ? formatUSD(saldo) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-orange-600 text-xs">
                        {mes.comprometido_usd > 0 && <span className="block">{formatUSD(mes.comprometido_usd)}</span>}
                        {mes.comprometido_ars > 0 && <span className="block">{formatARS(mes.comprometido_ars)}</span>}
                        {mes.comprometido_usd === 0 && mes.comprometido_ars === 0 && <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {flujoMensual.length === 0 && (
              <div className="text-center py-12 text-slate-400 text-sm">
                No hay movimientos registrados aún.
              </div>
            )}
          </div>
        )}

        {tab === 'pendientes' && (
          <div>
            {/* Totales */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                <p className="text-xs text-orange-600 font-medium mb-1">Total pendiente ARS</p>
                <p className="text-2xl font-bold text-orange-700">{formatARS(totalPendienteARS)}</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-xs text-blue-600 font-medium mb-1">Total pendiente USD</p>
                <p className="text-2xl font-bold text-blue-700">{formatUSD(totalPendienteUSD)}</p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Descripción</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Proveedor</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Categoría</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Monto</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Vencimiento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {gastosPendientes.map(g => (
                    <tr key={g.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{g.descripcion}</td>
                      <td className="px-4 py-3 text-slate-500">{g.proveedor ?? '—'}</td>
                      <td className="px-4 py-3">
                        {g.categoria ? (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: g.categoria_color ?? '#ccc' }} />
                            {g.categoria}
                          </span>
                        ) : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">
                        {g.moneda === 'USD' ? formatUSD(g.monto) : formatARS(g.monto)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {new Date(g.fecha_vencimiento).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {gastosPendientes.length === 0 && (
                <div className="text-center py-12 text-slate-400 text-sm">No hay gastos pendientes.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CuentaCard({ cuenta }: { cuenta: CuentaConSaldo }) {
  const esPositivo = cuenta.saldo_actual >= 0
  const fmt = (n: number) => cuenta.moneda === 'USD' ? formatUSD(n) : formatARS(n)

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-semibold text-slate-900 text-sm">{cuenta.nombre}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {cuenta.tipo === 'banco' ? 'Banco' : 'Caja'} · {cuenta.moneda}
          </p>
        </div>
        <span className={cn(
          'text-xs px-2 py-0.5 rounded-full font-medium',
          esPositivo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
        )}>
          {esPositivo ? '+' : ''}{fmt(cuenta.saldo_actual)}
        </span>
      </div>
      <div className="space-y-1.5 pt-3 border-t border-slate-100 text-xs">
        <div className="flex justify-between text-slate-500">
          <span>Saldo inicial</span>
          <span>{fmt(cuenta.saldo_inicial)}</span>
        </div>
        <div className="flex justify-between text-blue-600">
          <span>+ Ingresos cobrados</span>
          <span>{fmt(cuenta.ingresos_ventas)}</span>
        </div>
        <div className="flex justify-between text-red-500">
          <span>− Egresos pagados</span>
          <span>{fmt(cuenta.egresos_gastos)}</span>
        </div>
      </div>
    </div>
  )
}
