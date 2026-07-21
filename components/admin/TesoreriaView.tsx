'use client'

import { useMemo, useState } from 'react'
import { cn, formatCurrency, sumarMontos } from '@/lib/utils'
import type { CuentaPropia } from '@/types/database'

interface CuentaConSaldo extends CuentaPropia {
  ingresos_ventas: number
  egresos_gastos: number
  saldo_actual: number
  obra_nombre: string | null
}

export interface MovimientoFlujo {
  tipo: 'ingreso' | 'egreso' | 'comprometido'
  moneda: string
  monto: number
  fecha: string | null
  obraId: string | null // null = sin proyecto (gasto administrativo de empresa)
}

interface MesFlujo {
  label: string
  ingresos_usd: number
  ingresos_ars: number
  egresos_usd: number
  egresos_ars: number
  comprometido_usd: number
  comprometido_ars: number
}

interface Mes {
  year: number
  month: number
  label: string
}

interface Proyecto {
  id: string
  nombre: string
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
  obraId: string | null
}

interface Props {
  cuentas: CuentaConSaldo[]
  movimientos: MovimientoFlujo[]
  meses: Mes[]
  proyectos: Proyecto[]
  gastosPendientes: GastoPendiente[]
}

function formatARS(n: number) {
  return formatCurrency(n, 'ARS')
}
function formatUSD(n: number) {
  return formatCurrency(n, 'USD')
}

const FILTRO_TODOS = 'todos'
const FILTRO_EMPRESA = 'empresa'

export default function TesoreriaView({ cuentas, movimientos, meses, proyectos, gastosPendientes }: Props) {
  const [tab, setTab] = useState<'flujo' | 'pendientes'>('flujo')
  const [proyectoFiltro, setProyectoFiltro] = useState<string>(FILTRO_TODOS)

  const cuentasARS = cuentas.filter(c => c.moneda === 'ARS')
  const cuentasUSD = cuentas.filter(c => c.moneda === 'USD')

  const nombreProyecto = (obraId: string | null) =>
    obraId === null ? 'Empresa' : proyectos.find(p => p.id === obraId)?.nombre ?? '—'

  // Recalcula el flujo mensual del lado del cliente al cambiar el filtro de
  // proyecto — evita ir de nuevo al servidor solo para cambiar el recorte;
  // los movimientos ya vienen todos traídos con su obraId.
  const flujoMensual: MesFlujo[] = useMemo(() => {
    const filtrados = proyectoFiltro === FILTRO_TODOS
      ? movimientos
      : proyectoFiltro === FILTRO_EMPRESA
        ? movimientos.filter(m => m.obraId === null)
        : movimientos.filter(m => m.obraId === proyectoFiltro)

    return meses.map(({ year, month, label }) => {
      const inMonth = (dateStr: string | null) => {
        if (!dateStr) return false
        const d = new Date(dateStr)
        return d.getFullYear() === year && d.getMonth() + 1 === month
      }
      const delMes = filtrados.filter(m => inMonth(m.fecha))
      return {
        label,
        ingresos_usd: sumarMontos(delMes.filter(m => m.tipo === 'ingreso' && m.moneda === 'USD').map(m => m.monto)),
        ingresos_ars: sumarMontos(delMes.filter(m => m.tipo === 'ingreso' && m.moneda === 'ARS').map(m => m.monto)),
        egresos_usd: sumarMontos(delMes.filter(m => m.tipo === 'egreso' && m.moneda === 'USD').map(m => m.monto)),
        egresos_ars: sumarMontos(delMes.filter(m => m.tipo === 'egreso' && m.moneda === 'ARS').map(m => m.monto)),
        comprometido_usd: sumarMontos(delMes.filter(m => m.tipo === 'comprometido' && m.moneda === 'USD').map(m => m.monto)),
        comprometido_ars: sumarMontos(delMes.filter(m => m.tipo === 'comprometido' && m.moneda === 'ARS').map(m => m.monto)),
      }
    })
  }, [movimientos, meses, proyectoFiltro])

  const gastosPendientesFiltrados = proyectoFiltro === FILTRO_TODOS
    ? gastosPendientes
    : proyectoFiltro === FILTRO_EMPRESA
      ? gastosPendientes.filter(g => g.obraId === null)
      : gastosPendientes.filter(g => g.obraId === proyectoFiltro)

  const totalPendienteARS = sumarMontos(gastosPendientesFiltrados.filter(g => g.moneda === 'ARS').map(g => g.monto))
  const totalPendienteUSD = sumarMontos(gastosPendientesFiltrados.filter(g => g.moneda === 'USD').map(g => g.monto))

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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="flex gap-1 border-b border-slate-200 sm:border-b-0">
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
              {gastosPendientesFiltrados.length > 0 && (
                <span className="bg-orange-100 text-orange-700 text-xs font-semibold px-1.5 py-0.5 rounded-full">
                  {gastosPendientesFiltrados.length}
                </span>
              )}
            </button>
          </div>

          <select
            value={proyectoFiltro}
            onChange={e => setProyectoFiltro(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white
                       focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full sm:w-auto"
          >
            <option value={FILTRO_TODOS}>Todos los proyectos</option>
            <option value={FILTRO_EMPRESA}>Empresa (sin proyecto)</option>
            {proyectos.map(p => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>
        </div>

        {tab === 'flujo' && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Mes</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600 text-blue-700">Ingresos USD</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600 text-blue-700">Ingresos ARS</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600 text-red-700">Egresos USD</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600 text-red-700">Egresos ARS</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Saldo USD</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Saldo ARS</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600 text-orange-600">Comprometido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {flujoMensual.map(mes => {
                    const saldoUsd = mes.ingresos_usd - mes.egresos_usd
                    const saldoArs = mes.ingresos_ars - mes.egresos_ars
                    return (
                      <tr key={mes.label} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-700">{mes.label}</td>
                        <td className="px-4 py-3 text-right text-blue-700">
                          {mes.ingresos_usd > 0 ? formatUSD(mes.ingresos_usd) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-blue-700">
                          {mes.ingresos_ars > 0 ? formatARS(mes.ingresos_ars) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-red-600">
                          {mes.egresos_usd > 0 ? formatUSD(mes.egresos_usd) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-red-600">
                          {mes.egresos_ars > 0 ? formatARS(mes.egresos_ars) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className={cn(
                          'px-4 py-3 text-right font-semibold',
                          saldoUsd > 0 ? 'text-green-600' : saldoUsd < 0 ? 'text-red-600' : 'text-slate-400'
                        )}>
                          {saldoUsd !== 0 ? formatUSD(saldoUsd) : '—'}
                        </td>
                        <td className={cn(
                          'px-4 py-3 text-right font-semibold',
                          saldoArs > 0 ? 'text-green-600' : saldoArs < 0 ? 'text-red-600' : 'text-slate-400'
                        )}>
                          {saldoArs !== 0 ? formatARS(saldoArs) : '—'}
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
            </div>
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Descripción</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Proyecto</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Proveedor</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Categoría</th>
                      <th className="text-right px-4 py-3 font-semibold text-slate-600">Monto</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Vencimiento</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {gastosPendientesFiltrados.map(g => (
                      <tr key={g.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">{g.descripcion}</td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            'text-xs px-2 py-0.5 rounded-full font-medium',
                            g.obraId ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-500'
                          )}>{nombreProyecto(g.obraId)}</span>
                        </td>
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
              </div>
              {gastosPendientesFiltrados.length === 0 && (
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
          <p className="text-xs mt-1">
            {cuenta.obra_nombre ? (
              <span className="inline-block px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-medium">{cuenta.obra_nombre}</span>
            ) : (
              <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">Empresa</span>
            )}
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
