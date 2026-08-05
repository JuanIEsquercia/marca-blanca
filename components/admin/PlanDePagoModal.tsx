'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency, formatDate, redondear2, sumarMontos } from '@/lib/utils'
import CuentaPropiaSelect from './CuentaPropiaSelect'
import type { CuentaPropia, GastoPago, CobroPago, MedioPago } from '@/types/database'

type Entidad = 'gasto' | 'cobro'
type Cuota = GastoPago | CobroPago

interface Props {
  entidad: Entidad
  id: string
  montoTotal: number
  moneda: string
  // Cuotas ya existentes (si se está editando un plan armado antes).
  cuotasExistentes: Cuota[]
  // Solo se usa (y se muestra el selector) para gastos: de qué cuenta
  // propia va a salir cada cheque, ya sabido al planificar en vez de
  // recién al marcarlo pagado. En cobros no aplica — la cuenta ahí es
  // adonde se DEPOSITA el cheque de un tercero, no algo que se planifique.
  cuentasPropias?: CuentaPropia[]
  constructoraId: string
  obraId: string | null
  puedeCrearCuenta: boolean
  onClose: () => void
  onSaved: () => void
}

type CuotaDraft = {
  monto: string
  fecha_pago: string
  medio: MedioPago
  numero_cheque: string
  banco: string
  cuenta_propia_id: string
  notas: string
  // Solo para mostrar un aviso — no se manda a la base (la cuota se
  // recrea como Pendiente al guardar, ver guardar()).
  eraRechazada: boolean
}

const MEDIOS: { value: MedioPago; label: string }[] = [
  { value: 'cheque', label: 'Cheque' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'otro', label: 'Otro' },
]

function hoy(): string {
  return new Date().toISOString().split('T')[0]
}

function sumarDias(fechaIso: string, dias: number): string {
  const d = new Date(`${fechaIso}T00:00:00`)
  d.setDate(d.getDate() + dias)
  return d.toISOString().split('T')[0]
}

function nuevaCuota(fecha: string, monto = ''): CuotaDraft {
  return { monto, fecha_pago: fecha, medio: 'cheque', numero_cheque: '', banco: '', cuenta_propia_id: '', notas: '', eraRechazada: false }
}

// Compartido por gastos y cobros: arma/edita un plan de pago (cuotas con
// montos y fechas libres, no necesariamente iguales — un cheque a 15 días
// casi nunca es del mismo monto que uno a 45). Las cuotas ya
// Pagadas/Cobradas son inmutables (la base las protege, ver
// migration_064) y se muestran fijas; las Pendientes o Rechazadas se
// reemplazan enteras al guardar.
export default function PlanDePagoModal({ entidad, id, montoTotal, moneda, cuotasExistentes, cuentasPropias = [], constructoraId, obraId, puedeCrearCuenta, onClose, onSaved }: Props) {
  const [cuentasNuevas, setCuentasNuevas] = useState<CuentaPropia[]>([])
  const estadoLiquidado = entidad === 'gasto' ? 'Pagado' : 'Cobrado'
  const verbo = entidad === 'gasto' ? 'pago' : 'cobro'

  const bloqueadas = cuotasExistentes.filter(c => c.estado === estadoLiquidado)
  const montoBloqueado = sumarMontos(bloqueadas.map(c => c.monto))

  const [filas, setFilas] = useState<CuotaDraft[]>(() => {
    const editables = cuotasExistentes.filter(c => c.estado !== estadoLiquidado)
    if (editables.length === 0) return [nuevaCuota(hoy())]
    return editables.map(c => ({
      monto: String(c.monto),
      fecha_pago: c.fecha_pago,
      medio: c.medio,
      numero_cheque: c.numero_cheque ?? '',
      banco: c.banco ?? '',
      cuenta_propia_id: c.cuenta_propia_id ?? '',
      notas: c.notas ?? '',
      eraRechazada: c.estado === 'Rechazado',
    }))
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDividir, setShowDividir] = useState(false)
  const [dividirForm, setDividirForm] = useState({ cantidad: '3', intervaloDias: '30' })

  const totalFilas = sumarMontos(filas.map(f => parseFloat(f.monto) || 0))
  const totalCargado = redondear2(montoBloqueado + totalFilas)
  const diferencia = redondear2(montoTotal - totalCargado)
  const cierra = Math.abs(diferencia) <= 0.01

  function actualizarFila(i: number, patch: Partial<CuotaDraft>) {
    setFilas(fs => fs.map((f, idx) => idx === i ? { ...f, ...patch } : f))
  }

  function agregarFila() {
    const ultima = filas[filas.length - 1]
    setFilas(fs => [...fs, nuevaCuota(ultima ? sumarDias(ultima.fecha_pago, 30) : hoy())])
  }

  function quitarFila(i: number) {
    setFilas(fs => fs.filter((_, idx) => idx !== i))
  }

  function aplicarDividir() {
    const n = parseInt(dividirForm.cantidad, 10)
    const intervalo = parseInt(dividirForm.intervaloDias, 10)
    if (!n || n < 1 || !intervalo) return
    const restante = redondear2(montoTotal - montoBloqueado)
    const base = Math.floor((restante / n) * 100) / 100
    const nuevas: CuotaDraft[] = Array.from({ length: n }, (_, i) => {
      const esUltima = i === n - 1
      const montoFila = esUltima ? redondear2(restante - base * (n - 1)) : base
      return nuevaCuota(sumarDias(hoy(), intervalo * (i + 1)), String(montoFila))
    })
    setFilas(nuevas)
    setShowDividir(false)
  }

  async function guardar() {
    if (!cierra) return
    setLoading(true)
    setError(null)
    const supabase = createClient()

    // RPC atómica (migration_065): reemplaza las cuotas Pendientes/Rechazadas
    // por el set nuevo en una sola transacción — antes eran un DELETE y un
    // INSERT separados desde acá, y si el INSERT fallaba las cuotas viejas
    // ya habían sido borradas sin reponerse.
    const cuotas = filas.map(f => ({
      monto: redondear2(parseFloat(f.monto) || 0),
      fecha_pago: f.fecha_pago,
      medio: f.medio,
      numero_cheque: f.medio === 'cheque' ? (f.numero_cheque.trim() || null) : null,
      banco: f.medio === 'cheque' ? (f.banco.trim() || null) : null,
      cuenta_propia_id: f.cuenta_propia_id || null,
      notas: f.notas.trim() || null,
    }))
    const { error: err } = await supabase.rpc('guardar_plan_pago', {
      p_entidad: entidad,
      p_id: id,
      p_cuotas: cuotas,
    })

    setLoading(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Plan de {verbo}</h2>
            <p className="text-sm text-slate-500 mt-0.5">Total <strong>{formatCurrency(montoTotal, moneda)}</strong></p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {bloqueadas.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-1.5">
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
                Cuotas ya {estadoLiquidado === 'Pagado' ? 'pagadas' : 'cobradas'} (no se pueden editar)
              </p>
              {bloqueadas.map(c => (
                <div key={c.id} className="flex items-center justify-between text-xs">
                  <span className="text-emerald-700">
                    {formatDate(c.fecha_pago)} · {c.medio}{c.numero_cheque ? ` #${c.numero_cheque}` : ''}
                  </span>
                  <span className="font-medium text-emerald-800">{formatCurrency(c.monto, moneda)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Cuotas a cargar</p>
            <button type="button" onClick={() => setShowDividir(v => !v)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
              Dividir en cuotas...
            </button>
          </div>

          {showDividir && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 flex items-end gap-3 flex-wrap">
              <div>
                <label className="block text-[11px] text-indigo-700 mb-1">Cantidad</label>
                <input type="number" min="1" value={dividirForm.cantidad}
                  onChange={e => setDividirForm(f => ({ ...f, cantidad: e.target.value }))}
                  className="w-20 px-2 py-1.5 border border-indigo-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-indigo-700 mb-1">Cada (días)</label>
                <input type="number" min="1" value={dividirForm.intervaloDias}
                  onChange={e => setDividirForm(f => ({ ...f, intervaloDias: e.target.value }))}
                  className="w-20 px-2 py-1.5 border border-indigo-300 rounded-lg text-sm" />
              </div>
              <button type="button" onClick={aplicarDividir}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg">
                Generar
              </button>
              <p className="text-[11px] text-indigo-500 w-full">Punto de partida — los montos y fechas se pueden ajustar cuota por cuota después.</p>
            </div>
          )}

          <div className="space-y-3">
            {filas.map((f, i) => (
              <div key={i} className="border border-slate-200 rounded-lg p-3 space-y-2">
                {f.eraRechazada && (
                  <p className="text-[11px] text-amber-600 font-medium">⚠ Este cheque había sido rechazado — cargá el reemplazo.</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Monto *</label>
                    <input type="number" min="0" step="0.01" value={f.monto}
                      onChange={e => actualizarFila(i, { monto: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Fecha de pago *</label>
                    <input type="date" value={f.fecha_pago}
                      onChange={e => actualizarFila(i, { fecha_pago: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Medio</label>
                    <select value={f.medio} onChange={e => actualizarFila(i, { medio: e.target.value as MedioPago })}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      {MEDIOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                  {f.medio === 'cheque' && (
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">N° cheque</label>
                      <input value={f.numero_cheque} onChange={e => actualizarFila(i, { numero_cheque: e.target.value })}
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                  )}
                </div>
                {f.medio === 'cheque' && entidad === 'cobro' && (
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Banco</label>
                    <input value={f.banco} onChange={e => actualizarFila(i, { banco: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                )}
                {entidad === 'gasto' && (
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Sale de la cuenta</label>
                    <CuentaPropiaSelect
                      cuentas={[...cuentasPropias.filter(c => c.activa), ...cuentasNuevas]}
                      onCreated={c => setCuentasNuevas(prev => [...prev, c])}
                      value={f.cuenta_propia_id}
                      onChange={id => actualizarFila(i, { cuenta_propia_id: id })}
                      constructoraId={constructoraId}
                      obraId={obraId}
                      puedeCrear={puedeCrearCuenta}
                      moneda={moneda}
                      emptyLabel="Sin definir todavía"
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                )}
                <div className="flex justify-end">
                  <button type="button" onClick={() => quitarFila(i)} className="text-[11px] text-red-400 hover:text-red-600">
                    Quitar cuota
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={agregarFila}
            className="w-full py-2 border-2 border-dashed border-slate-300 rounded-lg text-xs text-slate-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors">
            + Agregar cuota
          </button>

          <div className={cn(
            'rounded-lg p-3 text-sm flex items-center justify-between gap-2 flex-wrap',
            cierra ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          )}>
            <span>Cargado: {formatCurrency(totalCargado, moneda)} de {formatCurrency(montoTotal, moneda)}</span>
            {!cierra && <span className="font-semibold">{diferencia > 0 ? 'Falta' : 'Sobra'} {formatCurrency(Math.abs(diferencia), moneda)}</span>}
          </div>

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
              Cancelar
            </button>
            <button type="button" onClick={guardar} disabled={loading || !cierra}
              className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
              {loading ? 'Guardando...' : 'Guardar plan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
