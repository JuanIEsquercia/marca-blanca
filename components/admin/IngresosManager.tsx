'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import type { IngresoConsolidado } from '@/lib/ingresos'

interface Props {
  ingresos: IngresoConsolidado[]
  historialAcotado: boolean
}

function sumarPorMoneda(items: IngresoConsolidado[]): Record<string, number> {
  const acc: Record<string, number> = {}
  for (const i of items) acc[i.moneda] = (acc[i.moneda] ?? 0) + i.monto
  return acc
}

function MontosPorMoneda({ montos, vacio, className }: { montos: Record<string, number>; vacio: string; className?: string }) {
  const entradas = Object.entries(montos).filter(([, v]) => v > 0)
  if (entradas.length === 0) return <span className={className}>{vacio}</span>
  return <span className={className}>{entradas.map(([moneda, v]) => formatCurrency(v, moneda)).join(' · ')}</span>
}

interface GrupoProyecto {
  obraId: string | null
  obraNombre: string
  items: IngresoConsolidado[]
}

interface BucketMes {
  clave: string
  label: string
  orden: number
  items: IngresoConsolidado[]
}

const FILTRO_TODOS = 'todos'
const FILTRO_SIN_PROYECTO = 'sin_proyecto'

// Agrupa los pendientes por mes de vencimiento real — sin rellenar meses
// vacíos hasta un horizonte fijo. Así una deuda repartida en 36 cuotas se ve
// distinta (36 filas chicas) de la misma plata concentrada en 6 meses (6
// filas grandes), que es justo el dato que importa para decidir sobre una
// inversión con esa plata.
function agruparPorMes(pendientes: IngresoConsolidado[]) {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  const vencidos: IngresoConsolidado[] = []
  const buckets = new Map<string, BucketMes>()

  for (const i of pendientes) {
    if (!i.fechaVencimiento) continue // sin vencimiento cargado: no entra en la proyección temporal
    const fecha = new Date(`${i.fechaVencimiento}T00:00:00`)
    if (fecha < hoy) {
      vencidos.push(i)
      continue
    }
    const clave = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`
    const existente = buckets.get(clave)
    if (existente) {
      existente.items.push(i)
    } else {
      buckets.set(clave, {
        clave,
        label: fecha.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
        orden: fecha.getFullYear() * 12 + fecha.getMonth(),
        items: [i],
      })
    }
  }

  const sinVencimiento = pendientes.filter(i => !i.fechaVencimiento)
  const meses = [...buckets.values()].sort((a, b) => a.orden - b.orden)
  return { vencidos, meses, sinVencimiento }
}

export default function IngresosManager({ ingresos, historialAcotado }: Props) {
  const [soloConDeuda, setSoloConDeuda] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [verPagadosDe, setVerPagadosDe] = useState<string | null>(null)
  const [proyectoFiltro, setProyectoFiltro] = useState<string>(FILTRO_TODOS)
  const [mesAbierto, setMesAbierto] = useState<string | null>(null)

  const proyectoOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const i of ingresos) {
      if (i.obraId) map.set(i.obraId, i.obraNombre ?? '—')
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [ingresos])

  const ingresosEnAmbito = useMemo(() => {
    if (proyectoFiltro === FILTRO_TODOS) return ingresos
    if (proyectoFiltro === FILTRO_SIN_PROYECTO) return ingresos.filter(i => i.obraId === null)
    return ingresos.filter(i => i.obraId === proyectoFiltro)
  }, [ingresos, proyectoFiltro])

  const grupos = useMemo(() => {
    const map = new Map<string, GrupoProyecto>()
    for (const i of ingresosEnAmbito) {
      const clave = i.obraId ?? '__sin_proyecto__'
      const grupo = map.get(clave) ?? { obraId: i.obraId, obraNombre: i.obraNombre ?? 'Sin proyecto', items: [] }
      grupo.items.push(i)
      map.set(clave, grupo)
    }
    return [...map.values()].sort((a, b) => a.obraNombre.localeCompare(b.obraNombre))
  }, [ingresosEnAmbito])

  const gruposFiltrados = soloConDeuda
    ? grupos.filter(g => g.items.some(i => !i.pagado))
    : grupos

  const pendientesEnAmbito = ingresosEnAmbito.filter(i => !i.pagado)
  const totalPendienteGeneral = sumarPorMoneda(pendientesEnAmbito)
  const { vencidos, meses, sinVencimiento } = useMemo(() => agruparPorMes(pendientesEnAmbito), [pendientesEnAmbito])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Total pendiente de cobro</p>
            <MontosPorMoneda montos={totalPendienteGeneral} vacio="$0" className="text-sm font-bold text-amber-700" />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={soloConDeuda} onChange={e => setSoloConDeuda(e.target.checked)} />
            Solo proyectos con saldo pendiente
          </label>
        </div>
        <select
          value={proyectoFiltro}
          onChange={e => setProyectoFiltro(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value={FILTRO_TODOS}>Todos los proyectos</option>
          <option value={FILTRO_SIN_PROYECTO}>Sin proyecto</option>
          {proyectoOptions.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
        </select>
      </div>

      {/* Proyección de vencimientos — mira para adelante, distinto de la
          columna "Cobrado" de abajo (que mira para atrás). */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Cuándo vence lo pendiente</p>
        {vencidos.length === 0 && meses.length === 0 && sinVencimiento.length === 0 ? (
          <p className="text-xs text-slate-400">Nada pendiente de cobro en este momento.</p>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {vencidos.length > 0 && (
              <FilaMes
                label="Vencido"
                danger
                totales={sumarPorMoneda(vencidos)}
                cantidad={vencidos.length}
                abierto={mesAbierto === '__vencido__'}
                onToggle={() => setMesAbierto(mesAbierto === '__vencido__' ? null : '__vencido__')}
                items={vencidos}
              />
            )}
            {meses.map(m => (
              <FilaMes
                key={m.clave}
                label={m.label}
                totales={sumarPorMoneda(m.items)}
                cantidad={m.items.length}
                abierto={mesAbierto === m.clave}
                onToggle={() => setMesAbierto(mesAbierto === m.clave ? null : m.clave)}
                items={m.items}
              />
            ))}
            {sinVencimiento.length > 0 && (
              <FilaMes
                label="Sin fecha de vencimiento"
                totales={sumarPorMoneda(sinVencimiento)}
                cantidad={sinVencimiento.length}
                abierto={mesAbierto === '__sin_fecha__'}
                onToggle={() => setMesAbierto(mesAbierto === '__sin_fecha__' ? null : '__sin_fecha__')}
                items={sinVencimiento}
              />
            )}
          </div>
        )}
      </div>

      {/* Por proyecto — cuenta corriente con detalle e historial de cobrados */}
      <div className="space-y-2">
        {gruposFiltrados.map(g => {
          const clave = g.obraId ?? '__sin_proyecto__'
          const pendientes = g.items.filter(i => !i.pagado).sort((a, b) => (a.fechaVencimiento ?? '').localeCompare(b.fechaVencimiento ?? ''))
          const pagados = g.items.filter(i => i.pagado).sort((a, b) => (b.fechaPago ?? '').localeCompare(a.fechaPago ?? ''))
          const totalPendiente = sumarPorMoneda(pendientes)
          const totalPagado = sumarPorMoneda(pagados)
          const tieneDeuda = Object.values(totalPendiente).some(v => v > 0)
          const isExpanded = expanded === clave

          return (
            <div key={clave} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <button onClick={() => setExpanded(isExpanded ? null : clave)} className="w-full flex items-center gap-4 px-5 py-4 text-left">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-900">{g.obraNombre}</p>
                    {tieneDeuda && (
                      <span className="text-xs font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                        Le deben <MontosPorMoneda montos={totalPendiente} vacio="" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{g.items.length} movimiento(s)</p>
                </div>
                <svg className={cn('w-4 h-4 text-slate-400 transition-transform shrink-0', isExpanded && 'rotate-180')}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isExpanded && (
                <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
                  <div className="flex flex-wrap gap-4 mb-3">
                    <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide">Pendiente</p>
                      <MontosPorMoneda montos={totalPendiente} vacio="$0" className="text-sm font-bold text-amber-700" />
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide">
                        Cobrado{historialAcotado ? ' (últimos 12 meses)' : ''}
                      </p>
                      <MontosPorMoneda montos={totalPagado} vacio="$0" className="text-sm font-bold text-slate-700" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {pendientes.length === 0 && <p className="text-xs text-slate-400">Sin pendientes.</p>}
                    {pendientes.map(i => (
                      <div key={i.id} className="flex items-center justify-between bg-white border border-amber-200 rounded-lg px-3 py-2 text-xs">
                        <div className="min-w-0">
                          <p className="text-slate-700 truncate">{i.descripcion}{i.clienteNombre ? ` — ${i.clienteNombre}` : ''}</p>
                          <p className="text-slate-400">{i.fechaVencimiento ? `Vence ${formatDate(i.fechaVencimiento)}` : 'Sin vencimiento'}</p>
                        </div>
                        <span className="font-semibold text-amber-700 shrink-0 ml-3">{formatCurrency(i.monto, i.moneda)}</span>
                      </div>
                    ))}

                    {pagados.length > 0 && (
                      verPagadosDe === clave ? (
                        <>
                          {pagados.map(i => (
                            <div key={i.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs opacity-70">
                              <div className="min-w-0">
                                <p className="text-slate-700 truncate">{i.descripcion}{i.clienteNombre ? ` — ${i.clienteNombre}` : ''}</p>
                                <p className="text-slate-400">{i.fechaPago ? `Cobrado ${formatDate(i.fechaPago)}` : '—'}</p>
                              </div>
                              <span className="font-medium text-slate-500 shrink-0 ml-3">{formatCurrency(i.monto, i.moneda)}</span>
                            </div>
                          ))}
                          {historialAcotado && (
                            <Link href="/admin/ingresos?historial=todo" className="text-xs text-indigo-500 hover:underline block pt-1">
                              Ver historial de cobros completo
                            </Link>
                          )}
                        </>
                      ) : (
                        <button onClick={() => setVerPagadosDe(clave)} className="text-xs text-indigo-500 hover:underline pt-1">
                          Ver {pagados.length} cobrado(s){historialAcotado ? ' (últimos 12 meses)' : ''}
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {grupos.length === 0 && (
        <div className="text-center py-16 text-slate-400 bg-white border border-slate-200 rounded-2xl">
          <p className="text-sm">No hay cuotas ni cobros de obra registrados todavía.</p>
        </div>
      )}
      {grupos.length > 0 && gruposFiltrados.length === 0 && (
        <div className="text-center py-16 text-slate-400 bg-white border border-slate-200 rounded-2xl">
          <p className="text-sm">Ningún proyecto tiene saldo pendiente de cobro ahora mismo.</p>
        </div>
      )}
    </div>
  )
}

function FilaMes({ label, totales, cantidad, abierto, onToggle, items, danger }: {
  label: string
  totales: Record<string, number>
  cantidad: number
  abierto: boolean
  onToggle: () => void
  items: IngresoConsolidado[]
  danger?: boolean
}) {
  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors">
        <span className={cn('text-sm font-medium capitalize w-40 shrink-0', danger ? 'text-red-600' : 'text-slate-700')}>{label}</span>
        <span className="text-xs text-slate-400 shrink-0">{cantidad} ítem(s)</span>
        <span className="flex-1" />
        <MontosPorMoneda montos={totales} vacio="—" className={cn('text-sm font-semibold', danger ? 'text-red-600' : 'text-slate-900')} />
        <svg className={cn('w-3.5 h-3.5 text-slate-400 transition-transform shrink-0', abierto && 'rotate-180')}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {abierto && (
        <div className="px-4 pb-3 space-y-1">
          {items.map(i => (
            <div key={i.id} className="flex items-center justify-between text-xs px-3 py-1.5 bg-slate-50 rounded-lg">
              <span className="text-slate-600 truncate">
                {i.obraNombre ?? 'Sin proyecto'} — {i.descripcion}{i.clienteNombre ? ` — ${i.clienteNombre}` : ''}
              </span>
              <span className="font-medium text-slate-700 shrink-0 ml-3">{formatCurrency(i.monto, i.moneda)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
