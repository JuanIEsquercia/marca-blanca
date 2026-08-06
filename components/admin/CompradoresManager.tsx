'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Comprador } from '@/types/database'
import ConfirmModal from './ConfirmModal'

type ConfirmModalState = { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> }

interface Props {
  compradores: Comprador[]
  constructoraId: string
  readOnly?: boolean
}

const EMPTY_FORM = { nombre_completo: '', dni_cuit: '', email: '', telefono: '' }

// Mismo patrón que ProveedoresManager.tsx — CRUD simple, sin cuenta
// corriente propia (a diferencia de proveedores, un cliente no tiene un
// saldo consolidado acá: sus pagos viven en cuotas/cobros_proyecto, ya
// visibles desde Contratos/Cobros de cada proyecto).
export default function CompradoresManager({ compradores, constructoraId, readOnly = false }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null)
  const [busqueda, setBusqueda] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Comprador | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return compradores
    return compradores.filter(c =>
      c.nombre_completo.toLowerCase().includes(q) || (c.dni_cuit ?? '').includes(q)
    )
  }, [compradores, busqueda])

  function refresh() { startTransition(() => router.refresh()) }

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
    setShowForm(true)
  }

  function openEdit(c: Comprador) {
    setEditing(c)
    setForm({
      nombre_completo: c.nombre_completo,
      dni_cuit: c.dni_cuit ?? '',
      email: c.email ?? '',
      telefono: c.telefono ?? '',
    })
    setError(null)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createClient()
    const payload = {
      nombre_completo: form.nombre_completo.trim(),
      dni_cuit: form.dni_cuit.trim() || null,
      email: form.email.trim() || null,
      telefono: form.telefono.trim() || null,
    }
    const { error: err } = editing
      ? await supabase.from('compradores').update(payload).eq('id', editing.id)
      : await supabase.from('compradores').insert({ ...payload, constructora_id: constructoraId })
    setLoading(false)
    if (err) { setError(err.message); return }
    setShowForm(false)
    refresh()
  }

  function handleDelete(c: Comprador) {
    setConfirmModal({
      title: 'Eliminar cliente',
      message: `¿Eliminar "${c.nombre_completo}"? Si tiene reservas, ventas o contratos asociados, no se va a poder — hay que resolver esos registros primero.`,
      confirmLabel: 'Eliminar',
      danger: true,
      onConfirm: async () => {
        const supabase = createClient()
        const { error: err } = await supabase.from('compradores').delete().eq('id', c.id)
        if (err) throw new Error(err.message)
        setConfirmModal(null)
        refresh()
      },
    })
  }

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
        <div className="flex flex-wrap items-center gap-4">
          <input
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o CUIT/DNI..."
            className="w-full sm:w-64 px-3 py-2 border border-slate-300 rounded-lg text-sm
                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-slate-500 text-sm whitespace-nowrap">{filtrados.length} de {compradores.length} cliente(s)</p>
        </div>
        {!readOnly && (
          <button onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500
                       text-white rounded-lg text-sm font-medium transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nuevo cliente
          </button>
        )}
      </div>

      {compradores.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="mb-2">No hay clientes cargados aún.</p>
          {!readOnly && (
            <button onClick={openNew} className="text-indigo-500 text-sm hover:text-indigo-700">
              Crear el primero
            </button>
          )}
        </div>
      ) : filtrados.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p>Ningún cliente coincide con la búsqueda.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
          {filtrados.map(c => (
            <div key={c.id} className="flex items-center gap-4 px-5 py-4">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900">{c.nombre_completo}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {[c.dni_cuit, c.email, c.telefono].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                </p>
              </div>
              {!readOnly && (
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => openEdit(c)}
                    className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-600
                               hover:border-indigo-300 hover:text-indigo-600 transition-colors">
                    Editar
                  </button>
                  <button onClick={() => handleDelete(c)}
                    className="text-xs text-red-400 hover:text-red-600 px-1 transition-colors">✕</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">
                {editing ? 'Editar cliente' : 'Nuevo cliente'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre completo *</label>
                <input required value={form.nombre_completo}
                  onChange={e => setForm(f => ({ ...f, nombre_completo: e.target.value }))}
                  placeholder="Nombre y apellido, o razón social..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">CUIT/DNI</label>
                  <input value={form.dni_cuit} onChange={e => setForm(f => ({ ...f, dni_cuit: e.target.value }))}
                    placeholder="20-12345678-9"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
                  <input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input type="email" value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                  Cancelar
                </button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Guardando...' : editing ? 'Guardar' : 'Crear'}
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
