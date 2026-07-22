'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency, formatDate, redondear2, sumarMontos } from '@/lib/utils'
import ConfirmModal from './ConfirmModal'
import type { Presupuesto, PresupuestoItem, EstadoPresupuesto } from '@/types/database'

type ConfirmState = { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> }
type ObraDisponible = { id: string; nombre: string }

interface Props {
  presupuestos: Presupuesto[]
  obrasDisponibles: ObraDisponible[]
  constructoraId: string
}

const ESTADO_INFO: Record<EstadoPresupuesto, { label: string; color: string }> = {
  borrador:  { label: 'Borrador',  color: 'bg-slate-100 text-slate-600' },
  enviado:   { label: 'Enviado',   color: 'bg-amber-100 text-amber-700' },
  aceptado:  { label: 'Aceptado',  color: 'bg-emerald-100 text-emerald-700' },
  rechazado: { label: 'Rechazado', color: 'bg-red-100 text-red-700' },
}

const EMPTY_ITEM = { rubro: '', unidad: '', cantidad: '1', precio_unitario: '' }

function totalPresupuesto(items: PresupuestoItem[] | undefined) {
  return sumarMontos((items ?? []).map(i => i.subtotal))
}

export default function PresupuestosManager({ presupuestos, obrasDisponibles, constructoraId }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [confirmModal, setConfirmModal] = useState<ConfirmState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoPresupuesto>('todos')
  const [expanded, setExpanded] = useState<string | null>(null)

  const [itemForm, setItemForm] = useState(EMPTY_ITEM)
  const [addingItemTo, setAddingItemTo] = useState<string | null>(null)

  const [aceptarTarget, setAceptarTarget] = useState<Presupuesto | null>(null)
  const [aceptarModo, setAceptarModo] = useState<'existente' | 'nueva'>(obrasDisponibles.length > 0 ? 'existente' : 'nueva')
  const [aceptarObraId, setAceptarObraId] = useState('')
  const [aceptarNuevaNombre, setAceptarNuevaNombre] = useState('')
  const [aceptarNuevaDireccion, setAceptarNuevaDireccion] = useState('')
  const [aceptarModoCuentas, setAceptarModoCuentas] = useState<'empresa' | 'especificas'>('empresa')
  const [aceptarReplicarCuentas, setAceptarReplicarCuentas] = useState(true)

  function refresh() { startTransition(() => router.refresh()) }

  const filtrados = presupuestos.filter(p => filtroEstado === 'todos' || p.estado === filtroEstado)

  function handleDeletePresupuesto(p: Presupuesto) {
    setConfirmModal({
      title: 'Eliminar presupuesto',
      message: `¿Eliminar el presupuesto de "${p.cliente_nombre}"? Se eliminarán también sus ítems.`,
      confirmLabel: 'Eliminar',
      danger: true,
      onConfirm: async () => {
        const supabase = createClient()
        const { error: err } = await supabase.from('presupuestos').delete().eq('id', p.id)
        if (err) throw new Error(err.message)
        setConfirmModal(null)
        refresh()
      },
    })
  }

  async function cambiarEstado(p: Presupuesto, estado: EstadoPresupuesto) {
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.from('presupuestos').update({ estado }).eq('id', p.id)
    if (err) { setError(err.message); return }
    refresh()
  }

  // ── Ítems ──────────────────────────────────────────────────────

  async function handleAddItem(e: React.FormEvent, presupuestoId: string, orden: number) {
    e.preventDefault()
    if (!itemForm.rubro.trim() || !itemForm.precio_unitario) return
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.from('presupuesto_items').insert({
      presupuesto_id: presupuestoId,
      constructora_id: constructoraId,
      orden,
      rubro: itemForm.rubro.trim(),
      unidad: itemForm.unidad.trim() || null,
      cantidad: redondear2(parseFloat(itemForm.cantidad) || 1),
      precio_unitario: redondear2(parseFloat(itemForm.precio_unitario)),
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setItemForm(EMPTY_ITEM)
    setAddingItemTo(null)
    refresh()
  }

  function handleDeleteItem(item: PresupuestoItem) {
    setConfirmModal({
      title: 'Eliminar ítem',
      message: `¿Eliminar "${item.rubro}" del presupuesto?`,
      confirmLabel: 'Eliminar',
      danger: true,
      onConfirm: async () => {
        const supabase = createClient()
        const { error: err } = await supabase.from('presupuesto_items').delete().eq('id', item.id)
        if (err) throw new Error(err.message)
        setConfirmModal(null)
        refresh()
      },
    })
  }

  // ── Aceptar (crea/vincula obra + contrato_obra) ────────────────

  function abrirAceptar(p: Presupuesto) {
    setAceptarTarget(p)
    setAceptarModo(obrasDisponibles.length > 0 ? 'existente' : 'nueva')
    setAceptarObraId(obrasDisponibles[0]?.id ?? '')
    setAceptarNuevaNombre(p.cliente_nombre)
    setAceptarNuevaDireccion('')
    setAceptarModoCuentas('empresa')
    setAceptarReplicarCuentas(true)
    setError(null)
  }

  async function handleAceptarSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!aceptarTarget) return
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error: err } = await supabase.rpc('aceptar_presupuesto', {
      p_presupuesto_id: aceptarTarget.id,
      p_obra_id: aceptarModo === 'existente' ? aceptarObraId : null,
      p_nueva_obra_nombre: aceptarModo === 'nueva' ? aceptarNuevaNombre.trim() : null,
      p_nueva_obra_direccion: aceptarModo === 'nueva' ? (aceptarNuevaDireccion.trim() || null) : null,
      p_modo_cuentas: aceptarModoCuentas,
      p_replicar_cuentas: aceptarModoCuentas === 'especificas' && aceptarReplicarCuentas,
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setAceptarTarget(null)
    router.push(`/admin/proyectos/${data}/certificados`)
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row gap-3 justify-between">
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm bg-white w-fit">
          {(['todos', 'borrador', 'enviado', 'aceptado', 'rechazado'] as const).map(e => (
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
        <Link href="/admin/presupuestos/nuevo"
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors w-fit">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuevo presupuesto
        </Link>
      </div>

      {filtrados.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-white border border-slate-200 rounded-2xl">
          <p className="text-sm">No hay presupuestos{filtroEstado !== 'todos' ? ` en estado ${ESTADO_INFO[filtroEstado].label.toLowerCase()}` : ''}.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
          {filtrados.map(p => {
            const items = p.presupuesto_items ?? []
            const total = totalPresupuesto(items)
            const isExpanded = expanded === p.id
            const puedeEditarItems = p.estado === 'borrador' || p.estado === 'enviado'

            return (
              <div key={p.id}>
                <div
                  className={cn('px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors', isExpanded && 'bg-slate-50')}
                  onClick={() => setExpanded(isExpanded ? null : p.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-900">{p.cliente_nombre}</p>
                      <span className={cn('text-xs px-2 py-0.5 rounded font-medium', ESTADO_INFO[p.estado].color)}>{ESTADO_INFO[p.estado].label}</span>
                      {p.obras && (
                        <span className="text-xs px-2 py-0.5 rounded font-medium bg-indigo-50 text-indigo-600">→ {p.obras.nombre}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                      <span>{items.length} ítem{items.length !== 1 ? 's' : ''}</span>
                      <span className="font-medium text-slate-700">{formatCurrency(total, p.moneda)}</span>
                      <span>{formatDate(p.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => window.open(`/print/presupuesto/${p.id}`, '_blank')}
                      title="Imprimir presupuesto"
                      className="text-slate-400 hover:text-slate-600 px-1 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                      </svg>
                    </button>
                    {p.estado === 'borrador' && (
                      <button onClick={() => cambiarEstado(p, 'enviado')}
                        className="text-xs px-2.5 py-1.5 border border-amber-200 text-amber-700 hover:bg-amber-50 rounded-lg transition-colors">
                        Marcar enviado
                      </button>
                    )}
                    {(p.estado === 'borrador' || p.estado === 'enviado') && (
                      <>
                        <button onClick={() => abrirAceptar(p)}
                          className="text-xs px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors">
                          Aceptar y crear proyecto
                        </button>
                        <button onClick={() => cambiarEstado(p, 'rechazado')}
                          className="text-xs px-2.5 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          Rechazar
                        </button>
                      </>
                    )}
                    {p.estado === 'borrador' && (
                      <button onClick={() => handleDeletePresupuesto(p)}
                        className="text-xs text-red-400 hover:text-red-600 px-1 transition-colors">✕</button>
                    )}
                    <svg className={cn('w-4 h-4 text-slate-400 transition-transform', isExpanded && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {isExpanded && (
                  <div className="bg-slate-50 border-t border-slate-100 px-5 py-4 space-y-3">
                    {(p.cliente_cuit || p.cliente_email || p.cliente_telefono) && (
                      <p className="text-xs text-slate-500">
                        {[p.cliente_cuit, p.cliente_email, p.cliente_telefono].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {p.descripcion && <p className="text-xs text-slate-500 italic">{p.descripcion}</p>}

                    <div className="space-y-2">
                      {items.length === 0 && <p className="text-xs text-slate-400">Sin ítems todavía.</p>}
                      {items.map(item => (
                        <div key={item.id} className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900">{item.rubro}</p>
                            <p className="text-xs text-slate-400">
                              {item.cantidad} {item.unidad ?? 'u.'} × {formatCurrency(item.precio_unitario, p.moneda)}
                            </p>
                          </div>
                          <p className="text-sm font-semibold text-slate-700 shrink-0">{formatCurrency(item.subtotal, p.moneda)}</p>
                          {puedeEditarItems && (
                            <button onClick={() => handleDeleteItem(item)}
                              className="text-xs text-red-400 hover:text-red-600 px-1 transition-colors shrink-0">✕</button>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <p className="text-sm font-bold text-slate-900">Total: {formatCurrency(total, p.moneda)}</p>
                      {puedeEditarItems && addingItemTo !== p.id && (
                        <button onClick={() => { setAddingItemTo(p.id); setItemForm(EMPTY_ITEM); setError(null) }}
                          className="text-xs px-3 py-1.5 border border-indigo-200 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                          + Agregar ítem
                        </button>
                      )}
                    </div>

                    {addingItemTo === p.id && (
                      <form onSubmit={e => handleAddItem(e, p.id, items.length)} className="bg-white border border-indigo-200 rounded-xl p-3 space-y-2">
                        <input required value={itemForm.rubro} onChange={e => setItemForm(f => ({ ...f, rubro: e.target.value }))}
                          placeholder="Rubro (ej: Movimiento de suelos)"
                          className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                        <div className="grid grid-cols-3 gap-2">
                          <input value={itemForm.unidad} onChange={e => setItemForm(f => ({ ...f, unidad: e.target.value }))}
                            placeholder="Unidad (m², gl...)"
                            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                          <input required type="number" min="0.01" step="0.01" value={itemForm.cantidad}
                            onChange={e => setItemForm(f => ({ ...f, cantidad: e.target.value }))}
                            placeholder="Cantidad"
                            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                          <input required type="number" min="0" step="0.01" value={itemForm.precio_unitario}
                            onChange={e => setItemForm(f => ({ ...f, precio_unitario: e.target.value }))}
                            placeholder="Precio unitario"
                            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                        </div>
                        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">{error}</p>}
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setAddingItemTo(null)}
                            className="flex-1 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-600 hover:bg-slate-50">Cancelar</button>
                          <button type="submit" disabled={loading}
                            className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-xs font-semibold">
                            {loading ? 'Guardando...' : 'Agregar'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal: aceptar y crear/vincular proyecto */}
      {aceptarTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setAceptarTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Aceptar presupuesto</h2>
                <p className="text-xs text-slate-400 mt-0.5">{aceptarTarget.cliente_nombre} — {formatCurrency(totalPresupuesto(aceptarTarget.presupuesto_items), aceptarTarget.moneda)}</p>
              </div>
              <button onClick={() => setAceptarTarget(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleAceptarSubmit} className="p-6 space-y-4">
              <p className="text-xs text-slate-500">Los ítems del presupuesto se copian como el contrato de ese proyecto — quedan disponibles para certificar el avance rubro por rubro.</p>
              <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
                <button type="button" onClick={() => setAceptarModo('existente')} disabled={obrasDisponibles.length === 0}
                  className={cn('flex-1 px-3 py-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                    aceptarModo === 'existente' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>
                  Proyecto existente
                </button>
                <button type="button" onClick={() => setAceptarModo('nueva')}
                  className={cn('flex-1 px-3 py-2 transition-colors',
                    aceptarModo === 'nueva' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>
                  Proyecto nuevo
                </button>
              </div>

              {aceptarModo === 'existente' ? (
                obrasDisponibles.length === 0 ? (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    No hay proyectos tipo Obra sin contrato todavía — creá uno nuevo.
                  </p>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Proyecto *</label>
                    <select required value={aceptarObraId} onChange={e => setAceptarObraId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      {obrasDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                    </select>
                  </div>
                )
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nombre del proyecto *</label>
                    <input required value={aceptarNuevaNombre} onChange={e => setAceptarNuevaNombre(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Dirección</label>
                    <input value={aceptarNuevaDireccion} onChange={e => setAceptarNuevaDireccion(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Cuentas del proyecto</label>
                    <select value={aceptarModoCuentas} onChange={e => setAceptarModoCuentas(e.target.value as 'empresa' | 'especificas')}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="empresa">Compartidas con la empresa</option>
                      <option value="especificas">Específicas de este proyecto</option>
                    </select>
                  </div>
                  {aceptarModoCuentas === 'especificas' && (
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input type="checkbox" checked={aceptarReplicarCuentas} onChange={e => setAceptarReplicarCuentas(e.target.checked)} />
                      Replicar las cuentas de empresa existentes como cuentas propias de este proyecto (con saldo inicial en 0)
                    </label>
                  )}
                </div>
              )}

              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setAceptarTarget(null)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button type="submit" disabled={loading || (aceptarModo === 'existente' && obrasDisponibles.length === 0)}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Procesando...' : 'Aceptar y continuar'}
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
