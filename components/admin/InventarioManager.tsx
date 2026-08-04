'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, formatDate } from '@/lib/utils'
import ConfirmModal from './ConfirmModal'
import type { Equipo, EstadoEquipo } from '@/types/database'

type ConfirmState = { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> }
type ObraSimple = { id: string; nombre: string }

interface Props {
  equipos: Equipo[]
  obras: ObraSimple[]
  constructoraId: string
}

const ESTADO_INFO: Record<EstadoEquipo, { label: string; color: string }> = {
  disponible:    { label: 'Disponible',    color: 'bg-emerald-100 text-emerald-700' },
  asignado:      { label: 'Asignado',      color: 'bg-indigo-100 text-indigo-700' },
  mantenimiento: { label: 'Mantenimiento', color: 'bg-amber-100 text-amber-700' },
  baja:          { label: 'Baja',          color: 'bg-slate-100 text-slate-500' },
}

const EMPTY_EQUIPO = { nombre: '', tipo: '', marca: '', modelo: '', nro_serie: '', notas: '' }

function obraNombre(obras: ObraSimple[], obraId: string | undefined) {
  return obras.find(o => o.id === obraId)?.nombre ?? 'Proyecto'
}

export default function InventarioManager({ equipos, obras, constructoraId }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [confirmModal, setConfirmModal] = useState<ConfirmState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoEquipo>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_EQUIPO)

  const [asignarTarget, setAsignarTarget] = useState<Equipo | null>(null)
  const [asignarObraId, setAsignarObraId] = useState('')

  function refresh() { startTransition(() => router.refresh()) }

  const q = busqueda.trim().toLowerCase()
  const filtrados = equipos
    .filter(e => filtroEstado === 'todos' || e.estado === filtroEstado)
    .filter(e => !q ||
      e.nombre.toLowerCase().includes(q) ||
      (e.tipo ?? '').toLowerCase().includes(q) ||
      (e.marca ?? '').toLowerCase().includes(q) ||
      (e.modelo ?? '').toLowerCase().includes(q) ||
      (e.nro_serie ?? '').toLowerCase().includes(q)
    )

  function asignacionVigente(equipo: Equipo) {
    return (equipo.equipo_asignaciones ?? []).find(a => a.fecha_hasta === null) ?? null
  }

  // ── Crear equipo ────────────────────────────────────────────────

  function abrirNuevo() {
    setShowForm(true)
    setForm(EMPTY_EQUIPO)
    setError(null)
  }

  async function handleCrearSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nombre.trim()) return
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.from('equipos').insert({
      constructora_id: constructoraId,
      nombre: form.nombre.trim(),
      tipo: form.tipo.trim() || null,
      marca: form.marca.trim() || null,
      modelo: form.modelo.trim() || null,
      nro_serie: form.nro_serie.trim() || null,
      notas: form.notas.trim() || null,
      estado: 'disponible',
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setForm(EMPTY_EQUIPO)
    setShowForm(false)
    refresh()
  }

  function handleDeleteEquipo(equipo: Equipo) {
    setConfirmModal({
      title: 'Eliminar equipo',
      message: `¿Eliminar "${equipo.nombre}"? Se pierde también su historial de asignaciones.`,
      confirmLabel: 'Eliminar',
      danger: true,
      onConfirm: async () => {
        const supabase = createClient()
        const { error: err } = await supabase.from('equipos').delete().eq('id', equipo.id)
        if (err) throw new Error(err.message)
        setConfirmModal(null)
        refresh()
      },
    })
  }

  // ── Asignar / reasignar ──────────────────────────────────────────

  function abrirAsignar(equipo: Equipo) {
    setAsignarTarget(equipo)
    const vigente = asignacionVigente(equipo)
    setAsignarObraId(obras.find(o => o.id !== vigente?.obra_id)?.id ?? '')
    setError(null)
  }

  async function handleAsignarSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!asignarTarget || !asignarObraId) return
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.rpc('asignar_equipo', {
      p_equipo_id: asignarTarget.id,
      p_obra_id: asignarObraId,
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setAsignarTarget(null)
    refresh()
  }

  // ── Devolver / mantenimiento / baja / reactivar ──────────────────

  async function liberar(equipo: Equipo, nuevoEstado: 'disponible' | 'mantenimiento' | 'baja') {
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.rpc('liberar_equipo', {
      p_equipo_id: equipo.id,
      p_nuevo_estado: nuevoEstado,
    })
    if (err) { setError(err.message); return }
    refresh()
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row gap-3 justify-between">
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, tipo, marca o N° de serie..."
          className="w-full md:w-64 px-3 py-2 border border-slate-300 rounded-lg text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="flex rounded-lg border border-slate-300 overflow-x-auto max-w-full text-sm bg-white w-fit no-scrollbar">
          {(['todos', 'disponible', 'asignado', 'mantenimiento', 'baja'] as const).map(e => (
            <button key={e}
              onClick={() => setFiltroEstado(e)}
              className={cn(
                'px-3 py-2 transition-colors capitalize',
                filtroEstado === e ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              )}>
              {e === 'todos' ? 'Todos' : ESTADO_INFO[e].label}
            </button>
          ))}
        </div>
        <button onClick={abrirNuevo}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors w-fit">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuevo equipo
        </button>
      </div>

      {filtrados.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-white border border-slate-200 rounded-2xl">
          <p className="text-sm">No hay equipos{filtroEstado !== 'todos' ? ` en estado ${ESTADO_INFO[filtroEstado].label.toLowerCase()}` : ''}.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
          {filtrados.map(equipo => {
            const vigente = asignacionVigente(equipo)
            const historial = [...(equipo.equipo_asignaciones ?? [])].sort((a, b) => b.fecha_desde.localeCompare(a.fecha_desde))
            const isExpanded = expanded === equipo.id

            return (
              <div key={equipo.id}>
                <div
                  className={cn('px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors', isExpanded && 'bg-slate-50')}
                  onClick={() => setExpanded(isExpanded ? null : equipo.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-900">{equipo.nombre}</p>
                      <span className={cn('text-xs px-2 py-0.5 rounded font-medium', ESTADO_INFO[equipo.estado].color)}>{ESTADO_INFO[equipo.estado].label}</span>
                      {vigente && (
                        <span className="text-xs px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-600">→ {obraNombre(obras, vigente.obra_id)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                      {[equipo.tipo, equipo.marca, equipo.modelo].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                    {(equipo.estado === 'disponible' || equipo.estado === 'asignado') && obras.length > 0 && (
                      <button onClick={() => abrirAsignar(equipo)}
                        className="text-xs px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors">
                        {equipo.estado === 'asignado' ? 'Reasignar' : 'Asignar'}
                      </button>
                    )}
                    {equipo.estado === 'asignado' && (
                      <button onClick={() => liberar(equipo, 'disponible')}
                        className="text-xs px-2.5 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">
                        Devolver
                      </button>
                    )}
                    {(equipo.estado === 'disponible' || equipo.estado === 'asignado') && (
                      <button onClick={() => liberar(equipo, 'mantenimiento')}
                        className="text-xs px-2.5 py-1.5 border border-amber-200 text-amber-700 hover:bg-amber-50 rounded-lg transition-colors">
                        Mantenimiento
                      </button>
                    )}
                    {(equipo.estado === 'mantenimiento' || equipo.estado === 'baja') && (
                      <button onClick={() => liberar(equipo, 'disponible')}
                        className="text-xs px-2.5 py-1.5 border border-emerald-200 text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                        Reactivar
                      </button>
                    )}
                    {equipo.estado !== 'baja' && (
                      <button onClick={() => liberar(equipo, 'baja')}
                        className="text-xs px-2.5 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        Dar de baja
                      </button>
                    )}
                    <button onClick={() => handleDeleteEquipo(equipo)}
                      className="text-xs text-red-400 hover:text-red-600 px-1 transition-colors">✕</button>
                    <svg className={cn('w-4 h-4 text-slate-400 transition-transform', isExpanded && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {isExpanded && (
                  <div className="bg-slate-50 border-t border-slate-100 px-5 py-4 space-y-3">
                    {equipo.nro_serie && <p className="text-xs text-slate-500">N° de serie: {equipo.nro_serie}</p>}
                    {equipo.notas && <p className="text-xs text-slate-500 italic">{equipo.notas}</p>}

                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Trazabilidad — historial de asignaciones</p>
                    {historial.length === 0 ? (
                      <p className="text-xs text-slate-400">Este equipo todavía no fue asignado a ningún proyecto.</p>
                    ) : (
                      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                        {historial.map(a => (
                          <div key={a.id} className="px-4 py-2.5 grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
                            <div className="min-w-0">
                              <p className="text-slate-800 truncate">{obraNombre(obras, a.obra_id)}</p>
                              <p className="text-xs text-slate-400">
                                {formatDate(a.fecha_desde)} — {a.fecha_hasta ? formatDate(a.fecha_hasta) : 'vigente'}
                              </p>
                            </div>
                            {a.fecha_hasta === null && (
                              <span className="text-xs px-2 py-0.5 rounded font-medium bg-indigo-50 text-indigo-600 shrink-0">Vigente</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal: nuevo equipo */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Nuevo equipo</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleCrearSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre *</label>
                <input required value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej: Martillo demoledor Bosch"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
                  <input value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
                    placeholder="Herramienta, vehículo..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">N° de serie</label>
                  <input value={form.nro_serie} onChange={e => setForm(f => ({ ...f, nro_serie: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Marca</label>
                  <input value={form.marca} onChange={e => setForm(f => ({ ...f, marca: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Modelo</label>
                  <input value={form.modelo} onChange={e => setForm(f => ({ ...f, modelo: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notas</label>
                <textarea rows={2} value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Guardando...' : 'Crear equipo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: asignar / reasignar */}
      {asignarTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setAsignarTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">
                {asignarTarget.estado === 'asignado' ? 'Reasignar' : 'Asignar'} {asignarTarget.nombre}
              </h2>
              <button onClick={() => setAsignarTarget(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleAsignarSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Proyecto *</label>
                <select required value={asignarObraId} onChange={e => setAsignarObraId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">— Elegir —</option>
                  {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setAsignarTarget(null)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button type="submit" disabled={loading || !asignarObraId}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Guardando...' : 'Confirmar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          danger={confirmModal.danger}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  )
}
