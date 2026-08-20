'use client'

import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cn, formatCurrency, sumarMontos } from '@/lib/utils'
import type { CuentaPropia } from '@/types/database'

interface CuentaConSaldo extends CuentaPropia {
  ingresos_ventas: number
  egresos_gastos: number
  saldo_actual: number
  obra_nombre: string | null
}

export interface MovimientoFlujo {
  tipo: 'ingreso' | 'egreso' | 'comprometido' | 'ingreso_comprometido'
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
  ingreso_comprometido_usd: number
  ingreso_comprometido_ars: number
}

type VistaPeriodo = 'mes' | 'trimestre' | 'año'

// Agrupa la serie mensual (siempre calculada mes a mes) en trimestres o
// años sumando los meses correspondientes — no hace falta volver a la base
// para cambiar el nivel de agregación, ni una función de cálculo aparte.
function agruparPeriodos(mesesFlujo: MesFlujo[], mesesRaw: Mes[], vista: VistaPeriodo): MesFlujo[] {
  if (vista === 'mes') return mesesFlujo

  const grupos = new Map<string, { label: string; items: MesFlujo[] }>()
  mesesFlujo.forEach((m, i) => {
    const { year, month } = mesesRaw[i]
    const clave = vista === 'trimestre' ? `${year}-T${Math.ceil(month / 3)}` : `${year}`
    const label = vista === 'trimestre' ? `T${Math.ceil(month / 3)} ${year}` : `${year}`
    const grupo = grupos.get(clave) ?? { label, items: [] }
    grupo.items.push(m)
    grupos.set(clave, grupo)
  })

  return [...grupos.values()].map(({ label, items }) => ({
    label,
    ingresos_usd: sumarMontos(items.map(i => i.ingresos_usd)),
    ingresos_ars: sumarMontos(items.map(i => i.ingresos_ars)),
    egresos_usd: sumarMontos(items.map(i => i.egresos_usd)),
    egresos_ars: sumarMontos(items.map(i => i.egresos_ars)),
    comprometido_usd: sumarMontos(items.map(i => i.comprometido_usd)),
    comprometido_ars: sumarMontos(items.map(i => i.comprometido_ars)),
    ingreso_comprometido_usd: sumarMontos(items.map(i => i.ingreso_comprometido_usd)),
    ingreso_comprometido_ars: sumarMontos(items.map(i => i.ingreso_comprometido_ars)),
  }))
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

interface IngresoPendiente {
  id: string
  descripcion: string
  monto: number
  moneda: string
  fecha_vencimiento: string | null
  obraId: string | null
}

interface Props {
  cuentas: CuentaConSaldo[]
  movimientos: MovimientoFlujo[]
  meses: Mes[]
  proyectos: Proyecto[]
  gastosPendientes: GastoPendiente[]
  ingresosPendientes: IngresoPendiente[]
}

function formatARS(n: number) {
  return formatCurrency(n, 'ARS')
}
function formatUSD(n: number) {
  return formatCurrency(n, 'USD')
}
// Para el eje del gráfico: formatCurrency da 2 decimales + separador de
// miles ("US$ 1.234.567,89"), demasiado largo para un tick — "notation:
// compact" lo deja en algo como "US$ 1,2 M".
function formatCompacto(n: number, moneda: string) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: moneda === 'ARS' ? 'ARS' : 'USD',
    notation: 'compact', maximumFractionDigits: 1,
  }).format(n)
}

const FILTRO_TODOS = 'todos'
const FILTRO_EMPRESA = 'empresa'

// Ventana de 12 meses hacia adelante para "Por cobrar" — antes la lista
// traía todo sin límite (una cuota de un plan a 36 meses podía asomar 3
// años en el futuro y hacer la tabla interminable). Página 0 = todo lo
// vencido (nunca se esconde, sigue siendo lo más urgente) + los próximos
// 12 meses desde hoy; cada página siguiente corre la ventana 12 meses más.
function inicioMes(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function sumarMeses(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth() + n, 1) }
function labelVentana(inicio: Date, fin: Date) {
  const fmt = (d: Date) => d.toLocaleDateString('es-AR', { month: 'short', year: 'numeric' })
  return `${fmt(inicio)} – ${fmt(sumarMeses(fin, -1))}`
}

export default function TesoreriaView({ cuentas, movimientos, meses, proyectos, gastosPendientes, ingresosPendientes }: Props) {
  const [tab, setTab] = useState<'flujo' | 'porCobrar' | 'porPagar'>('flujo')
  const [proyectoFiltro, setProyectoFiltro] = useState<string>(FILTRO_TODOS)
  const [paginaCobrar, setPaginaCobrar] = useState(0)
  const [vista, setVista] = useState<VistaPeriodo>('mes')

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
        ingreso_comprometido_usd: sumarMontos(delMes.filter(m => m.tipo === 'ingreso_comprometido' && m.moneda === 'USD').map(m => m.monto)),
        ingreso_comprometido_ars: sumarMontos(delMes.filter(m => m.tipo === 'ingreso_comprometido' && m.moneda === 'ARS').map(m => m.monto)),
      }
    })
  }, [movimientos, meses, proyectoFiltro])

  const periodos = useMemo(() => agruparPeriodos(flujoMensual, meses, vista), [flujoMensual, meses, vista])

  // Recharts quiere un solo array de puntos con todas las series adentro —
  // "realizado" y "proyectado" (comprometido) van como series separadas
  // para poder distinguirlas visualmente, nunca como si fueran lo mismo.
  const datosChartUsd = useMemo(() => periodos.map(p => ({
    label: p.label,
    'Ingresos': p.ingresos_usd,
    'Ingresos proyectados': p.ingreso_comprometido_usd,
    'Egresos': p.egresos_usd,
    'Egresos proyectados': p.comprometido_usd,
  })), [periodos])
  const datosChartArs = useMemo(() => periodos.map(p => ({
    label: p.label,
    'Ingresos': p.ingresos_ars,
    'Ingresos proyectados': p.ingreso_comprometido_ars,
    'Egresos': p.egresos_ars,
    'Egresos proyectados': p.comprometido_ars,
  })), [periodos])

  const gastosPendientesFiltrados = proyectoFiltro === FILTRO_TODOS
    ? gastosPendientes
    : proyectoFiltro === FILTRO_EMPRESA
      ? gastosPendientes.filter(g => g.obraId === null)
      : gastosPendientes.filter(g => g.obraId === proyectoFiltro)

  const totalPendienteARS = sumarMontos(gastosPendientesFiltrados.filter(g => g.moneda === 'ARS').map(g => g.monto))
  const totalPendienteUSD = sumarMontos(gastosPendientesFiltrados.filter(g => g.moneda === 'USD').map(g => g.monto))

  const ingresosPendientesFiltrados = proyectoFiltro === FILTRO_TODOS
    ? ingresosPendientes
    : proyectoFiltro === FILTRO_EMPRESA
      ? ingresosPendientes.filter(i => i.obraId === null)
      : ingresosPendientes.filter(i => i.obraId === proyectoFiltro)

  const totalPorCobrarARS = sumarMontos(ingresosPendientesFiltrados.filter(i => i.moneda === 'ARS').map(i => i.monto))
  const totalPorCobrarUSD = sumarMontos(ingresosPendientesFiltrados.filter(i => i.moneda === 'USD').map(i => i.monto))

  // Página 0 arranca en el mes actual; cada página siguiente corre la
  // ventana 12 meses. Los totales de arriba quedan sin recortar (la deuda
  // total por cobrar no cambia por cómo se pagina la tabla) — esto solo
  // filtra qué filas se muestran.
  const inicioVentana = sumarMeses(inicioMes(new Date()), paginaCobrar * 12)
  const finVentana = sumarMeses(inicioVentana, 12)
  const ingresosPendientesVentana = ingresosPendientesFiltrados.filter(i => {
    if (!i.fecha_vencimiento) return paginaCobrar === 0
    const f = new Date(i.fecha_vencimiento)
    if (paginaCobrar === 0 && f < inicioVentana) return true // vencidos: siempre visibles en la primera página
    return f >= inicioVentana && f < finVentana
  })
  const hayPaginaSiguiente = ingresosPendientesFiltrados.some(i => i.fecha_vencimiento && new Date(i.fecha_vencimiento) >= finVentana)

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
              onClick={() => setTab('porCobrar')}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2',
                tab === 'porCobrar' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              )}>
              Por cobrar
              {ingresosPendientesFiltrados.length > 0 && (
                <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-1.5 py-0.5 rounded-full">
                  {ingresosPendientesFiltrados.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab('porPagar')}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2',
                tab === 'porPagar' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              )}>
              Por pagar
              {gastosPendientesFiltrados.length > 0 && (
                <span className="bg-orange-100 text-orange-700 text-xs font-semibold px-1.5 py-0.5 rounded-full">
                  {gastosPendientesFiltrados.length}
                </span>
              )}
            </button>
          </div>

          <select
            value={proyectoFiltro}
            onChange={e => { setProyectoFiltro(e.target.value); setPaginaCobrar(0) }}
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
          <div className="space-y-4">
            {/* Vista: mes / trimestre / año — agrupa la misma serie, no vuelve a pedir datos */}
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
              {(['mes', 'trimestre', 'año'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setVista(v)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors',
                    vista === v ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  {v === 'año' ? 'Año' : v === 'trimestre' ? 'Trimestre' : 'Mes'}
                </button>
              ))}
              <span className="px-2 text-[11px] text-slate-400 border-l border-slate-300 ml-1">
                12 atrás + 12 adelante (proyectado) desde hoy
              </span>
            </div>

            {cuentasUSD.length > 0 && (
              <div className="space-y-3">
                <FlujoChart titulo="USD" moneda="USD" datos={datosChartUsd} formatear={formatUSD} />
                <TablaFlujoMoneda
                  periodoLabel={vista === 'año' ? 'Año' : vista === 'trimestre' ? 'Trimestre' : 'Mes'}
                  periodos={periodos} moneda="USD" formatear={formatUSD}
                  ingresos={p => p.ingresos_usd} ingresosProyectados={p => p.ingreso_comprometido_usd}
                  egresos={p => p.egresos_usd} egresosProyectados={p => p.comprometido_usd}
                />
              </div>
            )}
            {cuentasARS.length > 0 && (
              <div className="space-y-3">
                <FlujoChart titulo="ARS" moneda="ARS" datos={datosChartArs} formatear={formatARS} />
                <TablaFlujoMoneda
                  periodoLabel={vista === 'año' ? 'Año' : vista === 'trimestre' ? 'Trimestre' : 'Mes'}
                  periodos={periodos} moneda="ARS" formatear={formatARS}
                  ingresos={p => p.ingresos_ars} ingresosProyectados={p => p.ingreso_comprometido_ars}
                  egresos={p => p.egresos_ars} egresosProyectados={p => p.comprometido_ars}
                />
              </div>
            )}
          </div>
        )}

        {tab === 'porCobrar' && (
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-xs text-amber-600 font-medium mb-1">Total por cobrar ARS</p>
                <p className="text-xl sm:text-2xl font-bold text-amber-700 truncate" title={formatARS(totalPorCobrarARS)}>{formatARS(totalPorCobrarARS)}</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-xs text-blue-600 font-medium mb-1">Total por cobrar USD</p>
                <p className="text-xl sm:text-2xl font-bold text-blue-700 truncate" title={formatUSD(totalPorCobrarUSD)}>{formatUSD(totalPorCobrarUSD)}</p>
              </div>
            </div>

            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setPaginaCobrar(p => Math.max(0, p - 1))}
                disabled={paginaCobrar === 0}
                className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                ← Anterior
              </button>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {paginaCobrar === 0 ? 'Vencidos + próximos 12 meses' : labelVentana(inicioVentana, finVentana)}
              </p>
              <button
                onClick={() => setPaginaCobrar(p => p + 1)}
                disabled={!hayPaginaSiguiente}
                className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                Siguiente →
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Descripción</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Proyecto</th>
                      <th className="text-right px-4 py-3 font-semibold text-slate-600">Monto</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Vencimiento</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ingresosPendientesVentana.map(i => (
                      <tr key={i.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">{i.descripcion}</td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            'text-xs px-2 py-0.5 rounded-full font-medium',
                            i.obraId ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-500'
                          )}>{nombreProyecto(i.obraId)}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          {i.moneda === 'USD' ? formatUSD(i.monto) : formatARS(i.monto)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {i.fecha_vencimiento
                            ? new Date(i.fecha_vencimiento).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {ingresosPendientesVentana.length === 0 && (
                <div className="text-center py-12 text-slate-400 text-sm">
                  {ingresosPendientesFiltrados.length === 0 ? 'No hay cobros pendientes.' : 'Nada en esta ventana de 12 meses.'}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'porPagar' && (
          <div>
            {/* Totales */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                <p className="text-xs text-orange-600 font-medium mb-1">Total pendiente ARS</p>
                <p className="text-xl sm:text-2xl font-bold text-orange-700 truncate" title={formatARS(totalPendienteARS)}>{formatARS(totalPendienteARS)}</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-xs text-blue-600 font-medium mb-1">Total pendiente USD</p>
                <p className="text-xl sm:text-2xl font-bold text-blue-700 truncate" title={formatUSD(totalPendienteUSD)}>{formatUSD(totalPendienteUSD)}</p>
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

interface PuntoChartFlujo {
  label: string
  'Ingresos': number
  'Ingresos proyectados': number
  'Egresos': number
  'Egresos proyectados': number
}

// Dos barras por período (Ingresos | Egresos, una al lado de la otra —
// la comparación que más importa de un vistazo), cada una apilada en dos
// tramos: lo realizado (color fuerte, abajo) y lo proyectado/pendiente
// (mismo color pero más claro, arriba) — nunca un tercer/cuarto color que
// compita visualmente, lo proyectado se lee como "más de lo mismo, todavía
// no confirmado", no como una categoría aparte.
function FlujoChart({ titulo, moneda, datos, formatear }: { titulo: string; moneda: string; datos: PuntoChartFlujo[]; formatear: (n: number) => string }) {
  const muchosPuntos = datos.length > 8
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Flujo {titulo}</p>
      <div className={muchosPuntos ? 'h-80' : 'h-72'}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} margin={{ top: 8, right: 12, left: 4, bottom: muchosPuntos ? 24 : 4 }} barGap={4} barCategoryGap={muchosPuntos ? '20%' : '30%'}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#64748b' }}
              angle={muchosPuntos ? -35 : 0}
              textAnchor={muchosPuntos ? 'end' : 'middle'}
              height={muchosPuntos ? 40 : 24}
            />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={n => formatCompacto(n, moneda)} width={64} />
            <Tooltip
              formatter={(value: number | string | readonly (number | string)[] | undefined) => formatear(typeof value === 'number' ? value : 0)}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              labelStyle={{ fontWeight: 600, marginBottom: 4 }}
              cursor={{ fill: '#f8fafc' }}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />
            <Bar dataKey="Ingresos" stackId="ing" fill="#2563eb" radius={[0, 0, 0, 0]} maxBarSize={48} />
            <Bar dataKey="Ingresos proyectados" stackId="ing" fill="#bfdbfe" radius={[4, 4, 0, 0]} maxBarSize={48} />
            <Bar dataKey="Egresos" stackId="egr" fill="#dc2626" radius={[0, 0, 0, 0]} maxBarSize={48} />
            <Bar dataKey="Egresos proyectados" stackId="egr" fill="#fecaca" radius={[4, 4, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// Antes era UNA tabla con una columna por moneda por concepto (Ingresos
// USD, Ingresos ARS, Proyectados USD, Proyectados ARS...) — 10 columnas,
// scroll lateral incómodo. Separada por moneda (igual criterio que los
// gráficos de arriba, que ya no mezclan ARS/USD) queda en 4 columnas fijas
// sin scroll: Período, Ingresos, Egresos, Saldo — lo proyectado no es una
// columna aparte, es una segunda línea más chica adentro de la celda que
// ya corresponde (mismo patrón visual que las barras apiladas del gráfico).
function TablaFlujoMoneda({
  periodoLabel, periodos, moneda, formatear, ingresos, ingresosProyectados, egresos, egresosProyectados,
}: {
  periodoLabel: string
  periodos: MesFlujo[]
  moneda: string
  formatear: (n: number) => string
  ingresos: (p: MesFlujo) => number
  ingresosProyectados: (p: MesFlujo) => number
  egresos: (p: MesFlujo) => number
  egresosProyectados: (p: MesFlujo) => number
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="text-left px-4 py-3 font-semibold text-slate-600">{periodoLabel}</th>
            <th className="text-right px-4 py-3 font-semibold text-blue-700">Ingresos</th>
            <th className="text-right px-4 py-3 font-semibold text-red-700">Egresos</th>
            <th className="text-right px-4 py-3 font-semibold text-slate-600">Saldo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {periodos.map(p => {
            const ing = ingresos(p)
            const ingProy = ingresosProyectados(p)
            const egr = egresos(p)
            const egrProy = egresosProyectados(p)
            const saldo = ing - egr
            return (
              <tr key={p.label} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-700">{p.label}</td>
                <td className="px-4 py-3 text-right">
                  {ing > 0 ? <span className="text-blue-700 font-medium">{formatear(ing)}</span> : <span className="text-slate-300">—</span>}
                  {ingProy > 0 && <span className="block text-[11px] text-blue-400">+ {formatear(ingProy)} proyectado</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {egr > 0 ? <span className="text-red-600 font-medium">{formatear(egr)}</span> : <span className="text-slate-300">—</span>}
                  {egrProy > 0 && <span className="block text-[11px] text-red-400">+ {formatear(egrProy)} comprometido</span>}
                </td>
                <td className={cn(
                  'px-4 py-3 text-right font-semibold',
                  saldo > 0 ? 'text-green-600' : saldo < 0 ? 'text-red-600' : 'text-slate-400'
                )}>
                  {saldo !== 0 ? formatear(saldo) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {periodos.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">No hay movimientos en {moneda}.</div>
      )}
    </div>
  )
}

function CuentaCard({ cuenta }: { cuenta: CuentaConSaldo }) {
  const esPositivo = cuenta.saldo_actual >= 0
  const fmt = (n: number) => cuenta.moneda === 'USD' ? formatUSD(n) : formatARS(n)

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 text-sm truncate" title={cuenta.nombre}>{cuenta.nombre}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {cuenta.tipo === 'banco' ? 'Banco' : 'Caja'} · {cuenta.moneda}
          </p>
          <p className="text-xs mt-1">
            {cuenta.obra_nombre ? (
              <span className="inline-block px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-medium truncate max-w-full" title={cuenta.obra_nombre}>{cuenta.obra_nombre}</span>
            ) : (
              <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">Empresa</span>
            )}
          </p>
        </div>
        <span
          className={cn(
            'text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap truncate max-w-full',
            esPositivo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          )}
          title={`${esPositivo ? '+' : ''}${fmt(cuenta.saldo_actual)}`}
        >
          {esPositivo ? '+' : ''}{fmt(cuenta.saldo_actual)}
        </span>
      </div>
      <div className="space-y-1.5 pt-3 border-t border-slate-100 text-xs">
        <div className="flex justify-between items-baseline gap-2 flex-wrap text-slate-500">
          <span className="shrink-0">Saldo inicial</span>
          <span className="font-medium text-slate-700 text-right truncate max-w-[150px]" title={fmt(cuenta.saldo_inicial)}>{fmt(cuenta.saldo_inicial)}</span>
        </div>
        <div className="flex justify-between items-baseline gap-2 flex-wrap text-blue-600">
          <span className="shrink-0">+ Ingresos cobrados</span>
          <span className="font-medium text-right truncate max-w-[150px]" title={fmt(cuenta.ingresos_ventas)}>{fmt(cuenta.ingresos_ventas)}</span>
        </div>
        <div className="flex justify-between items-baseline gap-2 flex-wrap text-red-500">
          <span className="shrink-0">− Egresos pagados</span>
          <span className="font-medium text-right truncate max-w-[150px]" title={fmt(cuenta.egresos_gastos)}>{fmt(cuenta.egresos_gastos)}</span>
        </div>
      </div>
    </div>
  )
}
