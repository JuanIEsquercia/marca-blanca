'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import CuentaPropiaSelect from './CuentaPropiaSelect'
import type { CuentaPropia, GastoPago, CobroPago } from '@/types/database'

type Entidad = 'gasto' | 'cobro'
type Cuota = GastoPago | CobroPago

interface Props {
  entidad: Entidad
  cuotas: Cuota[]
  moneda: string
  cuentasPropias: CuentaPropia[]
  constructoraId: string
  readOnly?: boolean
  onChanged: () => void
}

// Detalle de las cuotas de un plan de pago, compartido por gastos y cobros
// — mismo componente, cada uno pasa su tabla/estado vía `entidad`. Vive
// expandido debajo de la fila del gasto/cobro en el manager correspondiente.
export default function CuotasList({ entidad, cuotas, moneda, cuentasPropias, constructoraId, readOnly, onChanged }: Props) {
  const tabla = entidad === 'gasto' ? 'gasto_pagos' : 'cobro_pagos'
  const estadoLiquidado = entidad === 'gasto' ? 'Pagado' : 'Cobrado'
  const verbo = entidad === 'gasto' ? 'Pagar' : 'Cobrar'

  const [liquidando, setLiquidando] = useState<Cuota | null>(null)
  const [form, setForm] = useState({ fecha_pago: '', cuenta_propia_id: '' })
  const [cuentasNuevas, setCuentasNuevas] = useState<CuentaPropia[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function abrirLiquidar(c: Cuota) {
    setLiquidando(c)
    setForm({ fecha_pago: c.fecha_pago, cuenta_propia_id: c.cuenta_propia_id ?? '' })
    setError(null)
  }

  async function confirmarLiquidar() {
    if (!liquidando || !form.cuenta_propia_id) return
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.from(tabla).update({
      estado: estadoLiquidado,
      fecha_pago: form.fecha_pago,
      cuenta_propia_id: form.cuenta_propia_id,
    }).eq('id', liquidando.id)
    setLoading(false)
    if (err) { setError(err.message); return }
    setLiquidando(null)
    onChanged()
  }

  async function marcarRechazada(c: Cuota) {
    const supabase = createClient()
    await supabase.from(tabla).update({ estado: 'Rechazado' }).eq('id', c.id)
    onChanged()
  }

  const ordenadas = [...cuotas].sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago))

  return (
    <div className="bg-slate-50 rounded-lg divide-y divide-slate-200 border border-slate-200">
      {ordenadas.map(c => (
        <div key={c.id} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn(
              'w-2 h-2 rounded-full shrink-0',
              c.estado === estadoLiquidado ? 'bg-emerald-500' : c.estado === 'Rechazado' ? 'bg-red-500' : 'bg-amber-400'
            )} />
            <span className="text-slate-600 truncate">
              {formatDate(c.fecha_pago)} · {c.medio}{c.numero_cheque ? ` #${c.numero_cheque}` : ''}{c.banco ? ` (${c.banco})` : ''}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-semibold text-slate-800">{formatCurrency(c.monto, moneda)}</span>
            {c.estado === estadoLiquidado ? (
              <span className="text-emerald-600">{c.estado}{c.cuentas_propias ? ` → ${c.cuentas_propias.nombre}` : ''}</span>
            ) : c.estado === 'Rechazado' ? (
              <span className="text-red-500 font-medium">Rechazado</span>
            ) : readOnly ? (
              <span className="text-amber-600">Pendiente</span>
            ) : (
              <>
                <button onClick={() => abrirLiquidar(c)} className="text-indigo-600 hover:text-indigo-800 font-medium">{verbo}</button>
                <button onClick={() => marcarRechazada(c)} className="text-red-400 hover:text-red-600">Rechazar</button>
              </>
            )}
          </div>
        </div>
      ))}

      {liquidando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setLiquidando(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200">
              <h2 className="font-bold text-slate-900">{entidad === 'gasto' ? 'Registrar pago de cuota' : 'Registrar cobro de cuota'}</h2>
              <p className="text-sm text-slate-500 mt-0.5">{formatCurrency(liquidando.monto, moneda)}</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Cuenta *</label>
                <CuentaPropiaSelect
                  cuentas={[...cuentasPropias.filter(c => c.activa), ...cuentasNuevas]}
                  onCreated={c => setCuentasNuevas(prev => [...prev, c])}
                  value={form.cuenta_propia_id}
                  onChange={id => setForm(f => ({ ...f, cuenta_propia_id: id }))}
                  constructoraId={constructoraId}
                  moneda={moneda}
                  emptyLabel="Seleccionar cuenta..." />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha *</label>
                <input type="date" value={form.fecha_pago} onChange={e => setForm(f => ({ ...f, fecha_pago: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setLiquidando(null)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                  Cancelar
                </button>
                <button onClick={confirmarLiquidar} disabled={loading || !form.cuenta_propia_id}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Guardando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
