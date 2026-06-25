'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ORIENTACIONES } from '@/types/database'
import type { Unidad, Tipologia } from '@/types/database'

interface Props {
  tipologias: Tipologia[]
  unidad?: Unidad & { tipologias: Tipologia }
  onClose: () => void
  onSuccess: () => void
}

export default function UnidadForm({ tipologias, unidad, onClose, onSuccess }: Props) {
  const isEditing = !!unidad
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    piso: unidad ? String(unidad.piso) : '',
    numero: unidad?.numero ?? '',
    orientacion: unidad?.orientacion ?? '',
    tipologia_id: unidad?.tipologia_id ?? (tipologias[0]?.id ?? ''),
    m2: unidad?.m2 ? String(unidad.m2) : '',
    precio_lista: unidad ? String(unidad.precio_lista) : '',
    entrega_minima_pct: unidad ? String(unidad.entrega_minima_pct) : '30',
    max_cuotas: unidad ? String(unidad.max_cuotas) : '36',
    estado_comercial: unidad?.estado_comercial ?? 'Disponible',
  })

  function set(field: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  // Tipología seleccionada para mostrar m2 de referencia
  const tipSelected = tipologias.find(t => t.id === form.tipologia_id)
  const m2Ref = tipSelected ? `Ref. tipología: ${tipSelected.m2_propios} m² propios + ${tipSelected.m2_comunes} m² comunes` : ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const payload = {
      piso: parseInt(form.piso),
      numero: form.numero.trim(),
      orientacion: form.orientacion || null,
      tipologia_id: form.tipologia_id,
      m2: form.m2 ? parseFloat(form.m2) : null,
      precio_lista: parseFloat(form.precio_lista),
      entrega_minima_pct: parseFloat(form.entrega_minima_pct),
      max_cuotas: parseInt(form.max_cuotas),
      estado_comercial: form.estado_comercial,
    }

    const { error: err } = isEditing
      ? await supabase.from('unidades').update(payload).eq('id', unidad!.id)
      : await supabase.from('unidades').insert(payload)

    setLoading(false)
    if (err) { setError(err.message); return }
    onSuccess()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-slate-900">
            {isEditing ? `Editar unidad P${unidad.piso} - ${unidad.numero}` : 'Nueva unidad'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Fila 1: Piso + Unidad + Orientación */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Ubicación</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Piso *</label>
                <input required type="number" min="1" value={form.piso}
                  onChange={e => set('piso', e.target.value)}
                  placeholder="3"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Unidad *</label>
                <input required value={form.numero} onChange={e => set('numero', e.target.value)}
                  placeholder="A / 01 / 3B"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Orientación</label>
                <select value={form.orientacion} onChange={e => set('orientacion', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">— Sin especificar</option>
                  {ORIENTACIONES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Tipología */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Tipología</p>
            {tipologias.length === 0 ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
                No hay tipologías creadas. Creá al menos una en{' '}
                <a href="/admin/tipologias" className="underline">Tipologías</a> antes de agregar unidades.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {tipologias.map(t => (
                  <label key={t.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors
                      ${form.tipologia_id === t.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}>
                    <input type="radio" name="tipologia" value={t.id} checked={form.tipologia_id === t.id}
                      onChange={() => set('tipologia_id', t.id)} className="sr-only" />
                    <div className="flex-1">
                      <p className="font-medium text-slate-900 text-sm">{t.nombre}</p>
                      <p className="text-xs text-slate-500">{t.m2_totales} m² totales · {t.descripcion ?? ''}</p>
                    </div>
                    {form.tipologia_id === t.id && (
                      <svg className="w-5 h-5 text-indigo-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* m2 por unidad */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Superficie</p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                m² propios de esta unidad
                <span className="ml-1 font-normal text-slate-400">(opcional — sobreescribe el de tipología)</span>
              </label>
              <input type="number" step="0.01" min="0" value={form.m2}
                onChange={e => set('m2', e.target.value)}
                placeholder="48.50"
                className="w-36 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              {m2Ref && <p className="text-xs text-slate-400 mt-1">{m2Ref}</p>}
            </div>
          </div>

          {/* Precio y condiciones */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Precio y condiciones</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="block text-xs font-medium text-slate-600 mb-1">Precio USD *</label>
                <input required type="number" step="0.01" min="0" value={form.precio_lista}
                  onChange={e => set('precio_lista', e.target.value)}
                  placeholder="120000"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">% Entrega mín.</label>
                <input type="number" step="0.1" min="0" max="100" value={form.entrega_minima_pct}
                  onChange={e => set('entrega_minima_pct', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Máx. cuotas</label>
                <input type="number" min="1" value={form.max_cuotas}
                  onChange={e => set('max_cuotas', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>

            {/* Resumen calculado */}
            {form.precio_lista && (
              <div className="mt-3 p-3 bg-slate-50 rounded-lg grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500">Anticipo mínimo</span>
                  <p className="font-semibold text-slate-800">
                    USD {(parseFloat(form.precio_lista) * parseFloat(form.entrega_minima_pct) / 100).toLocaleString('es-AR', { minimumFractionDigits: 0 })}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Precio/m²</span>
                  <p className="font-semibold text-slate-800">
                    {form.m2 || tipSelected
                      ? `USD ${Math.round(parseFloat(form.precio_lista) / (parseFloat(form.m2 || '0') || (tipSelected?.m2_totales ?? 1)))}/m²`
                      : '—'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Estado */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">Estado comercial</label>
            <div className="flex gap-2">
              {(['Disponible', 'Reservado', 'Vendido'] as const).map(e => (
                <label key={e} className={`flex-1 text-center py-2 rounded-lg border-2 cursor-pointer text-sm font-medium transition-colors
                  ${form.estado_comercial === e
                    ? e === 'Disponible' ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : e === 'Reservado' ? 'border-amber-500 bg-amber-50 text-amber-700'
                    : 'border-slate-500 bg-slate-100 text-slate-700'
                    : 'border-slate-200 text-slate-400 hover:border-slate-300'
                  }`}>
                  <input type="radio" name="estado" value={e} checked={form.estado_comercial === e}
                    onChange={() => set('estado_comercial', e)} className="sr-only" />
                  {e}
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50">
              Cancelar
            </button>
            <button type="submit" disabled={loading || tipologias.length === 0}
              className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
                         text-white rounded-lg text-sm font-semibold">
              {loading ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Crear unidad'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
