'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { CuentaPropia } from '@/types/database'

interface Props {
  cuentas: CuentaPropia[]
}

const EMPTY_FORM = { nombre: '', tipo: 'banco', moneda: 'USD', saldo_inicial: '0' }

export default function CuentasPropiasManager({ cuentas }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<CuentaPropia | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function refresh() { startTransition(() => router.refresh()) }

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
    setShowForm(true)
  }

  function openEdit(c: CuentaPropia) {
    setEditing(c)
    setForm({
      nombre: c.nombre,
      tipo: c.tipo,
      moneda: c.moneda,
      saldo_inicial: String(c.saldo_inicial),
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
      nombre: form.nombre.trim(),
      tipo: form.tipo,
      moneda: form.moneda,
      saldo_inicial: parseFloat(form.saldo_inicial || '0'),
    }
    const { error: err } = editing
      ? await supabase.from('cuentas_propias').update(payload).eq('id', editing.id)
      : await supabase.from('cuentas_propias').insert(payload)
    setLoading(false)
    if (err) { setError(err.message); return }
    setShowForm(false)
    refresh()
  }

  async function handleToggle(c: CuentaPropia) {
    const supabase = createClient()
    await supabase.from('cuentas_propias').update({ activa: !c.activa }).eq('id', c.id)
    refresh()
  }

  async function handleDelete(c: CuentaPropia) {
    if (!confirm(`¿Eliminar "${c.nombre}"? Esta acción no se puede deshacer.`)) return
    const supabase = createClient()
    const { error: err } = await supabase.from('cuentas_propias').delete().eq('id', c.id)
    if (err) { alert(err.message); return }
    refresh()
  }

  const fmt = (c: CuentaPropia) =>
    c.moneda === 'USD'
      ? `U$D ${c.saldo_inicial.toLocaleString('es-AR')}`
      : `$ ${c.saldo_inicial.toLocaleString('es-AR')}`

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <p className="text-slate-500 text-sm">{cuentas.length} cuenta(s) configurada(s)</p>
        <button onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500
                     text-white rounded-lg text-sm font-medium transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nueva cuenta
        </button>
      </div>

      <div className="space-y-2">
        {cuentas.map(c => (
          <div key={c.id} className={cn(
            'bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center gap-4',
            !c.activa && 'opacity-60'
          )}>
            {/* Ícono tipo cuenta */}
            <div className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
              c.moneda === 'USD' ? 'bg-blue-100' : 'bg-emerald-100'
            )}>
              {c.tipo === 'banco' ? (
                <svg className={cn('w-5 h-5', c.moneda === 'USD' ? 'text-blue-600' : 'text-emerald-600')}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                </svg>
              ) : (
                <svg className={cn('w-5 h-5', c.moneda === 'USD' ? 'text-blue-600' : 'text-emerald-600')}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-slate-900">{c.nombre}</p>
                <span className={cn(
                  'text-xs px-2 py-0.5 rounded-full font-medium',
                  c.moneda === 'USD' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                )}>{c.moneda}</span>
                <span className="text-xs text-slate-400 capitalize">{c.tipo}</span>
                {!c.activa && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Inactiva</span>}
              </div>
              <p className="text-sm text-slate-500 mt-0.5">
                Saldo inicial: <span className="font-medium text-slate-700">{fmt(c)}</span>
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => openEdit(c)}
                className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-600
                           hover:border-indigo-300 hover:text-indigo-600 transition-colors">
                Editar
              </button>
              <button onClick={() => handleToggle(c)}
                className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-600
                           hover:border-slate-300 transition-colors">
                {c.activa ? 'Desactivar' : 'Activar'}
              </button>
              <button onClick={() => handleDelete(c)}
                className="text-xs text-red-400 hover:text-red-600 px-1 transition-colors">✕</button>
            </div>
          </div>
        ))}
      </div>

      {cuentas.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <p className="mb-2 text-sm">No hay cuentas configuradas.</p>
          <p className="text-xs mb-4 text-slate-300">
            Creá tus cuentas bancarias y cajas para poder asignar cobros y pagos.
          </p>
          <button onClick={openNew} className="text-indigo-500 text-sm hover:text-indigo-700">
            Crear primera cuenta
          </button>
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">
                {editing ? 'Editar cuenta' : 'Nueva cuenta propia'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre de la cuenta *</label>
                <input required value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej: Cta. Cte. Galicia, Caja USD, Cuenta dólares..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
                  <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="banco">Banco</option>
                    <option value="caja">Caja / Efectivo</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Moneda</label>
                  <select value={form.moneda} onChange={e => setForm(f => ({ ...f, moneda: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option>USD</option>
                    <option>ARS</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Saldo inicial ({form.moneda})
                </label>
                <input type="number" min="0" step="0.01" value={form.saldo_inicial}
                  onChange={e => setForm(f => ({ ...f, saldo_inicial: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <p className="text-xs text-slate-400 mt-1">
                  El saldo desde el que parte la cuenta al momento de crearla en el sistema.
                </p>
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
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
                             text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Guardando...' : editing ? 'Guardar' : 'Crear cuenta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
