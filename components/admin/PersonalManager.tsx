'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, formatDate, formatCurrency } from '@/lib/utils'
import ConfirmModal from './ConfirmModal'
import type { Personal, Cuadrilla, EstadoPersonal, TipoContratacion } from '@/types/database'

type ConfirmState = { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> }
type ObraSimple = { id: string; nombre: string }

interface Props {
  personal: Personal[]
  cuadrillas: Cuadrilla[]
  obras: ObraSimple[]
  constructoraId: string
}

const ESTADO_INFO: Record<EstadoPersonal, { label: string; color: string }> = {
  disponible: { label: 'Disponible', color: 'bg-emerald-100 text-emerald-700' },
  asignado:   { label: 'Asignado',   color: 'bg-indigo-100 text-indigo-700' },
  licencia:   { label: 'Licencia',   color: 'bg-amber-100 text-amber-700' },
  baja:       { label: 'Baja',       color: 'bg-slate-100 text-slate-500' },
}

const TIPO_CONTRATACION_LABEL: Record<TipoContratacion, string> = {
  relacion_dependencia: 'Relación de dependencia',
  contratado: 'Contratado',
  subcontratista: 'Subcontratista',
}

const EMPTY_PERSONAL = {
  nombre: '', dni: '', cuil: '', telefono: '',
  tipo_contratacion: 'relacion_dependencia' as TipoContratacion,
  categoria: '', jornal: '', art_aseguradora: '', art_vencimiento: '', fecha_ingreso: '', notas: '',
  cuadrilla_id: '',
}
const EMPTY_CUADRILLA = { nombre: '', capataz_id: '' }

function obraNombre(obras: ObraSimple[], obraId: string | undefined) {
  return obras.find(o => o.id === obraId)?.nombre ?? 'Proyecto'
}

export default function PersonalManager({ personal, cuadrillas, obras, constructoraId }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [confirmModal, setConfirmModal] = useState<ConfirmState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoPersonal>('todos')
  const [expanded, setExpanded] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_PERSONAL)

  const [showCuadrillaForm, setShowCuadrillaForm] = useState(false)
  const [cuadrillaForm, setCuadrillaForm] = useState(EMPTY_CUADRILLA)

  const [asignarTarget, setAsignarTarget] = useState<Personal | null>(null)
  const [asignarObraId, setAsignarObraId] = useState('')

  const [asignarCuadrillaTarget, setAsignarCuadrillaTarget] = useState<Cuadrilla | null>(null)
  const [asignarCuadrillaObraId, setAsignarCuadrillaObraId] = useState('')

  function refresh() { startTransition(() => router.refresh()) }

  const filtrados = personal.filter(p => filtroEstado === 'todos' || p.estado === filtroEstado)

  function asignacionVigente(p: Personal) {
    return (p.personal_asignaciones ?? []).find(a => a.fecha_hasta === null) ?? null
  }

  // ── Personal: alta ──────────────────────────────────────────────

  function abrirNuevoPersonal() {
    setShowForm(true)
    setForm(EMPTY_PERSONAL)
    setError(null)
  }

  async function handleCrearPersonal(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nombre.trim()) return
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.from('personal').insert({
      constructora_id: constructoraId,
      nombre: form.nombre.trim(),
      dni: form.dni.trim() || null,
      cuil: form.cuil.trim() || null,
      telefono: form.telefono.trim() || null,
      tipo_contratacion: form.tipo_contratacion,
      categoria: form.categoria.trim() || null,
      jornal: form.jornal ? parseFloat(form.jornal) : null,
      art_aseguradora: form.art_aseguradora.trim() || null,
      art_vencimiento: form.art_vencimiento || null,
      fecha_ingreso: form.fecha_ingreso || null,
      notas: form.notas.trim() || null,
      cuadrilla_id: form.cuadrilla_id || null,
      estado: 'disponible',
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setForm(EMPTY_PERSONAL)
    setShowForm(false)
    refresh()
  }

  function handleDeletePersonal(p: Personal) {
    setConfirmModal({
      title: 'Eliminar persona',
      message: `¿Eliminar a "${p.nombre}"? Se pierde también su historial de asignaciones.`,
      confirmLabel: 'Eliminar',
      danger: true,
      onConfirm: async () => {
        const supabase = createClient()
        const { error: err } = await supabase.from('personal').delete().eq('id', p.id)
        if (err) throw new Error(err.message)
        setConfirmModal(null)
        refresh()
      },
    })
  }

  async function cambiarCuadrilla(p: Personal, cuadrillaId: string | null) {
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.from('personal').update({ cuadrilla_id: cuadrillaId }).eq('id', p.id)
    if (err) { setError(err.message); return }
    refresh()
  }

  // ── Personal: asignar / reasignar / liberar ──────────────────────

  function abrirAsignar(p: Personal) {
    setAsignarTarget(p)
    const vigente = asignacionVigente(p)
    setAsignarObraId(obras.find(o => o.id !== vigente?.obra_id)?.id ?? '')
    setError(null)
  }

  async function handleAsignarSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!asignarTarget || !asignarObraId) return
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.rpc('asignar_personal', {
      p_personal_id: asignarTarget.id,
      p_obra_id: asignarObraId,
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setAsignarTarget(null)
    refresh()
  }

  async function liberar(p: Personal, nuevoEstado: 'disponible' | 'licencia' | 'baja') {
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.rpc('liberar_personal', {
      p_personal_id: p.id,
      p_nuevo_estado: nuevoEstado,
    })
    if (err) { setError(err.message); return }
    refresh()
  }

  // ── Cuadrillas ────────────────────────────────────────────────

  function abrirNuevaCuadrilla() {
    setShowCuadrillaForm(true)
    setCuadrillaForm(EMPTY_CUADRILLA)
    setError(null)
  }

  async function handleCrearCuadrilla(e: React.FormEvent) {
    e.preventDefault()
    if (!cuadrillaForm.nombre.trim()) return
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.from('cuadrillas').insert({
      constructora_id: constructoraId,
      nombre: cuadrillaForm.nombre.trim(),
      capataz_id: cuadrillaForm.capataz_id || null,
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setCuadrillaForm(EMPTY_CUADRILLA)
    setShowCuadrillaForm(false)
    refresh()
  }

  function handleDeleteCuadrilla(c: Cuadrilla) {
    setConfirmModal({
      title: 'Eliminar cuadrilla',
      message: `¿Eliminar "${c.nombre}"? El personal asignado queda sin cuadrilla, no se elimina a nadie.`,
      confirmLabel: 'Eliminar',
      danger: true,
      onConfirm: async () => {
        const supabase = createClient()
        const { error: err } = await supabase.from('cuadrillas').delete().eq('id', c.id)
        if (err) throw new Error(err.message)
        setConfirmModal(null)
        refresh()
      },
    })
  }

  function abrirAsignarCuadrilla(c: Cuadrilla) {
    setAsignarCuadrillaTarget(c)
    setAsignarCuadrillaObraId(obras[0]?.id ?? '')
    setError(null)
  }

  async function handleAsignarCuadrillaSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!asignarCuadrillaTarget || !asignarCuadrillaObraId) return
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.rpc('asignar_cuadrilla', {
      p_cuadrilla_id: asignarCuadrillaTarget.id,
      p_obra_id: asignarCuadrillaObraId,
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setAsignarCuadrillaTarget(null)
    refresh()
  }

  const miembrosDeCuadrilla = (cuadrillaId: string) => personal.filter(p => p.cuadrilla_id === cuadrillaId)

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* ── CUADRILLAS ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700">Cuadrillas</h2>
          <button onClick={abrirNuevaCuadrilla}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nueva cuadrilla
          </button>
        </div>

        {cuadrillas.length === 0 ? (
          <div className="text-center py-8 text-slate-400 bg-white border border-slate-200 rounded-2xl text-sm">
            Sin cuadrillas todavía — agrupá personal para asignarlo de a varios en un solo paso.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {cuadrillas.map(c => {
              const miembros = miembrosDeCuadrilla(c.id)
              const capataz = personal.find(p => p.id === c.capataz_id)
              return (
                <div key={c.id} className="bg-white border border-slate-200 rounded-2xl p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-semibold text-slate-900">{c.nombre}</p>
                      {capataz && <p className="text-xs text-slate-400">Capataz: {capataz.nombre}</p>}
                    </div>
                    <button onClick={() => handleDeleteCuadrilla(c)}
                      className="text-xs text-red-400 hover:text-red-600 px-1 transition-colors">✕</button>
                  </div>
                  <p className="text-xs text-slate-500 mb-3">{miembros.length} persona{miembros.length !== 1 ? 's' : ''}</p>
                  {miembros.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {miembros.map(m => (
                        <span key={m.id} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{m.nombre}</span>
                      ))}
                    </div>
                  )}
                  <button onClick={() => abrirAsignarCuadrilla(c)} disabled={miembros.length === 0 || obras.length === 0}
                    className="w-full text-xs px-3 py-1.5 border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors">
                    Asignar cuadrilla a proyecto
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── PERSONAL ── */}
      <div>
        <div className="flex flex-col md:flex-row gap-3 justify-between mb-3">
          <div className="flex rounded-lg border border-slate-300 overflow-x-auto max-w-full text-sm bg-white w-fit no-scrollbar">
            {(['todos', 'disponible', 'asignado', 'licencia', 'baja'] as const).map(e => (
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
          <button onClick={abrirNuevoPersonal}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors w-fit">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nueva persona
          </button>
        </div>

        {filtrados.length === 0 ? (
          <div className="text-center py-16 text-slate-400 bg-white border border-slate-200 rounded-2xl">
            <p className="text-sm">No hay personal{filtroEstado !== 'todos' ? ` en estado ${ESTADO_INFO[filtroEstado].label.toLowerCase()}` : ''}.</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
            {filtrados.map(p => {
              const vigente = asignacionVigente(p)
              const historial = [...(p.personal_asignaciones ?? [])].sort((a, b) => b.fecha_desde.localeCompare(a.fecha_desde))
              const isExpanded = expanded === p.id

              return (
                <div key={p.id}>
                  <div
                    className={cn('px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors', isExpanded && 'bg-slate-50')}
                    onClick={() => setExpanded(isExpanded ? null : p.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-900">{p.nombre}</p>
                        <span className={cn('text-xs px-2 py-0.5 rounded font-medium', ESTADO_INFO[p.estado].color)}>{ESTADO_INFO[p.estado].label}</span>
                        {p.cuadrilla_id && cuadrillas.find(c => c.id === p.cuadrilla_id) && (
                          <span className="text-xs px-2 py-0.5 rounded font-medium bg-violet-50 text-violet-600">
                            {cuadrillas.find(c => c.id === p.cuadrilla_id)?.nombre}
                          </span>
                        )}
                        {vigente && (
                          <span className="text-xs px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-600">→ {obraNombre(obras, vigente.obra_id)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                        {[TIPO_CONTRATACION_LABEL[p.tipo_contratacion], p.categoria].filter(Boolean).join(' · ')}
                        {p.jornal && <span>· {formatCurrency(p.jornal, 'ARS')}/día</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                      {p.estado !== 'baja' && (
                        <select value={p.cuadrilla_id ?? ''} onChange={e => cambiarCuadrilla(p, e.target.value || null)}
                          title="Cuadrilla"
                          className="text-xs px-2 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                          <option value="">— Sin cuadrilla —</option>
                          {cuadrillas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                      )}
                      {(p.estado === 'disponible' || p.estado === 'asignado') && obras.length > 0 && (
                        <button onClick={() => abrirAsignar(p)}
                          className="text-xs px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors">
                          {p.estado === 'asignado' ? 'Reasignar' : 'Asignar'}
                        </button>
                      )}
                      {p.estado === 'asignado' && (
                        <button onClick={() => liberar(p, 'disponible')}
                          className="text-xs px-2.5 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">
                          Devolver
                        </button>
                      )}
                      {(p.estado === 'disponible' || p.estado === 'asignado') && (
                        <button onClick={() => liberar(p, 'licencia')}
                          className="text-xs px-2.5 py-1.5 border border-amber-200 text-amber-700 hover:bg-amber-50 rounded-lg transition-colors">
                          Licencia
                        </button>
                      )}
                      {(p.estado === 'licencia' || p.estado === 'baja') && (
                        <button onClick={() => liberar(p, 'disponible')}
                          className="text-xs px-2.5 py-1.5 border border-emerald-200 text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                          Reactivar
                        </button>
                      )}
                      {p.estado !== 'baja' && (
                        <button onClick={() => liberar(p, 'baja')}
                          className="text-xs px-2.5 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          Dar de baja
                        </button>
                      )}
                      <button onClick={() => handleDeletePersonal(p)}
                        className="text-xs text-red-400 hover:text-red-600 px-1 transition-colors">✕</button>
                      <svg className={cn('w-4 h-4 text-slate-400 transition-transform', isExpanded && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="bg-slate-50 border-t border-slate-100 px-5 py-4 space-y-3">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        {p.dni && <span>DNI: {p.dni}</span>}
                        {p.cuil && <span>CUIL: {p.cuil}</span>}
                        {p.telefono && <span>Tel: {p.telefono}</span>}
                        {p.fecha_ingreso && <span>Ingreso: {formatDate(p.fecha_ingreso)}</span>}
                        {p.art_aseguradora && <span>ART: {p.art_aseguradora}{p.art_vencimiento ? ` (vence ${formatDate(p.art_vencimiento)})` : ''}</span>}
                      </div>
                      {p.notas && <p className="text-xs text-slate-500 italic">{p.notas}</p>}

                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Trazabilidad — historial de asignaciones</p>
                      {historial.length === 0 ? (
                        <p className="text-xs text-slate-400">Todavía no fue asignado a ningún proyecto.</p>
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
      </div>

      {/* Modal: nueva persona */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Nueva persona</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleCrearPersonal} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre completo *</label>
                <input required value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">DNI</label>
                  <input value={form.dni} onChange={e => setForm(f => ({ ...f, dni: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">CUIL</label>
                  <input value={form.cuil} onChange={e => setForm(f => ({ ...f, cuil: e.target.value }))}
                    placeholder="20-12345678-9"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
                  <input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de contratación</label>
                  <select value={form.tipo_contratacion} onChange={e => setForm(f => ({ ...f, tipo_contratacion: e.target.value as TipoContratacion }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="relacion_dependencia">Relación de dependencia</option>
                    <option value="contratado">Contratado</option>
                    <option value="subcontratista">Subcontratista</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Categoría</label>
                  <input value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                    placeholder="Oficial, Medio Oficial, Ayudante..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Cuadrilla</label>
                <select value={form.cuadrilla_id} onChange={e => setForm(f => ({ ...f, cuadrilla_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">— Sin cuadrilla —</option>
                  {cuadrillas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
                <p className="text-xs text-slate-400 mt-1">Asignar la cuadrilla completa a un proyecto asigna a esta persona junto con el resto.</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Jornal (costo/día)</label>
                  <input type="number" min="0" step="0.01" value={form.jornal} onChange={e => setForm(f => ({ ...f, jornal: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">ART</label>
                  <input value={form.art_aseguradora} onChange={e => setForm(f => ({ ...f, art_aseguradora: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Vencimiento ART</label>
                  <input type="date" value={form.art_vencimiento} onChange={e => setForm(f => ({ ...f, art_vencimiento: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de ingreso</label>
                <input type="date" value={form.fecha_ingreso} onChange={e => setForm(f => ({ ...f, fecha_ingreso: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
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
                  {loading ? 'Guardando...' : 'Crear persona'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: nueva cuadrilla */}
      {showCuadrillaForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowCuadrillaForm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Nueva cuadrilla</h2>
              <button onClick={() => setShowCuadrillaForm(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleCrearCuadrilla} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre *</label>
                <input required value={cuadrillaForm.nombre} onChange={e => setCuadrillaForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej: Cuadrilla A"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Capataz</label>
                <select value={cuadrillaForm.capataz_id} onChange={e => setCuadrillaForm(f => ({ ...f, capataz_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">— Sin asignar —</option>
                  {personal.filter(p => p.estado !== 'baja').map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <p className="text-xs text-slate-400">Los integrantes se asignan después, desde la ficha de cada persona.</p>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowCuadrillaForm(false)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Guardando...' : 'Crear cuadrilla'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: asignar / reasignar persona */}
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

      {/* Modal: asignar cuadrilla completa */}
      {asignarCuadrillaTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setAsignarCuadrillaTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Asignar cuadrilla</h2>
                <p className="text-xs text-slate-400 mt-0.5">{asignarCuadrillaTarget.nombre} — {miembrosDeCuadrilla(asignarCuadrillaTarget.id).length} persona(s)</p>
              </div>
              <button onClick={() => setAsignarCuadrillaTarget(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleAsignarCuadrillaSubmit} className="p-6 space-y-4">
              <p className="text-xs text-slate-500">Asigna a cada integrante de la cuadrilla a este proyecto — quien ya estaba ahí no se toca.</p>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Proyecto *</label>
                <select required value={asignarCuadrillaObraId} onChange={e => setAsignarCuadrillaObraId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setAsignarCuadrillaTarget(null)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Asignando...' : 'Asignar cuadrilla'}
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
