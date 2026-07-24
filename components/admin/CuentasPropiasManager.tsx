'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency, redondear2 } from '@/lib/utils'
import type { CuentaPropia } from '@/types/database'
import type { SaldoCuenta } from '@/lib/tesoreria'
import ConfirmModal from './ConfirmModal'

type ConfirmModalState = { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> }

interface Props {
  // obra_nombre solo lo manda la vista de empresa (/admin/cuentas, que lista
  // cuentas de todos los proyectos a la vez) — la vista de un proyecto ya
  // está scopeada a uno solo, no hace falta repetirlo ahí.
  cuentas: (CuentaPropia & { obra_nombre?: string | null })[]
  // Saldo consolidado (saldo_inicial + movimientos) por cuenta.id, calculado
  // en el server con lib/tesoreria.ts. Si falta una cuenta acá (no debería
  // pasar, la página siempre lo calcula para todas) se cae al saldo_inicial.
  saldos?: Record<string, SaldoCuenta>
  constructoraId: string
  obraId?: string
  readOnly?: boolean
}

const EMPTY_FORM = { nombre: '', tipo: 'banco', moneda: 'USD', saldo_inicial: '0' }

export default function CuentasPropiasManager({ cuentas, saldos, constructoraId, obraId, readOnly }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<CuentaPropia | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  // Optimista: togglear activa no cambia ningún saldo, así que no hace falta
  // esperar el refresh() completo (que recalcula calcularSaldosDeCuentas
  // para TODAS las cuentas, historial completo — es lento) para reflejar el
  // cambio en pantalla. El refresh sigue disparándose en segundo plano para
  // que el resto de la página (server) quede sincronizado.
  const [activaOverride, setActivaOverride] = useState<Record<string, boolean>>({})

  // Una vez que el refresh() en segundo plano trae props nuevas del server
  // que ya coinciden con lo optimista, soltamos el override — así nunca
  // queda tapando para siempre un valor real distinto (ej. otro admin lo
  // cambió mientras tanto).
  useEffect(() => {
    setActivaOverride(prev => {
      if (Object.keys(prev).length === 0) return prev
      const next = { ...prev }
      let changed = false
      for (const c of cuentas) {
        if (c.id in next && next[c.id] === c.activa) {
          delete next[c.id]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [cuentas])

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
      saldo_inicial: redondear2(parseFloat(form.saldo_inicial || '0')),
    }
    const { error: err } = editing
      ? await supabase.from('cuentas_propias').update(payload).eq('id', editing.id)
      : await supabase.from('cuentas_propias').insert({ ...payload, constructora_id: constructoraId, obra_id: obraId ?? null })
    setLoading(false)
    if (err) { setError(err.message); return }
    setShowForm(false)
    refresh()
  }

  async function handleToggle(c: CuentaPropia) {
    if (togglingId === c.id) return // ya hay un toggle de esta fila en vuelo
    setError(null)
    // Ojo: el valor base es lo que se ve en pantalla (esActiva, que ya
    // incluye cualquier override optimista pendiente), NO c.activa — c.activa
    // es el prop del último render del servidor, que puede estar desactualizado
    // mientras el refresh() anterior todavía está en camino. Calcular a partir
    // de c.activa acá era el bug: dos toggles rápidos (desactivar → activar)
    // antes de que el primer refresh terminara mandaban el mismo valor dos
    // veces, y quedaba pegado en el estado del primer click.
    const valorPrevio = esActiva(c)
    const nuevoValor = !valorPrevio
    setTogglingId(c.id)
    setActivaOverride(o => ({ ...o, [c.id]: nuevoValor }))

    const supabase = createClient()
    // .select().maybeSingle() para poder distinguir "se guardó" de "el UPDATE
    // no matcheó ninguna fila" (RLS bloqueando en silencio, sin lanzar error) —
    // antes esto se trataba como éxito y la UI quedaba mostrando un cambio
    // que nunca llegó a la base.
    const { data, error } = await supabase
      .from('cuentas_propias')
      .update({ activa: nuevoValor })
      .eq('id', c.id)
      .select('id, activa')
      .maybeSingle()

    setTogglingId(null)

    if (error || !data) {
      setActivaOverride(o => ({ ...o, [c.id]: valorPrevio }))
      setError(error?.message ?? 'No se pudo actualizar la cuenta — puede que no tengas permiso sobre esta cuenta o ya no exista.')
      return
    }

    setActivaOverride(o => ({ ...o, [c.id]: data.activa }))
    refresh()
  }

  function handleDelete(c: CuentaPropia) {
    setConfirmModal({
      title: 'Eliminar cuenta',
      message: `¿Eliminar "${c.nombre}"? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      onConfirm: async () => {
        const supabase = createClient()
        const { error } = await supabase.from('cuentas_propias').delete().eq('id', c.id)
        if (error) throw new Error(error.message)
        setConfirmModal(null)
        refresh()
      },
    })
  }

  const esActiva = (c: CuentaPropia) => activaOverride[c.id] ?? c.activa
  const fmtSaldoInicial = (c: CuentaPropia) => formatCurrency(c.saldo_inicial, c.moneda)
  const saldoActual = (c: CuentaPropia) => saldos?.[c.id]?.saldo_actual ?? c.saldo_inicial
  const fmtSaldoActual = (c: CuentaPropia) => formatCurrency(saldoActual(c), c.moneda)

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <p className="text-slate-500 text-sm">{cuentas.length} cuenta(s) configurada(s)</p>
        {!readOnly && (
          <button onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500
                       text-white rounded-lg text-sm font-medium transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nueva cuenta
          </button>
        )}
      </div>

      <div className="space-y-2">
        {cuentas.map(c => (
          <div key={c.id} className={cn(
            'bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center gap-4',
            !esActiva(c) && 'opacity-60'
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
                {!esActiva(c) && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Inactiva</span>}
                {c.obra_nombre !== undefined && (
                  c.obra_nombre ? (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-50 text-indigo-600">{c.obra_nombre}</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-500">Empresa</span>
                  )
                )}
              </div>
              <p className="text-sm text-slate-500 mt-0.5">
                Saldo inicial: <span className="font-medium text-slate-700">{fmtSaldoInicial(c)}</span>
              </p>
            </div>

            <div className="text-right shrink-0">
              <p className="text-xs text-slate-400">Saldo actual</p>
              <p className={cn(
                'text-lg font-bold',
                saldoActual(c) >= 0 ? 'text-slate-900' : 'text-red-600'
              )}>{fmtSaldoActual(c)}</p>
            </div>

            {!readOnly && (
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => openEdit(c)}
                  className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-600
                             hover:border-indigo-300 hover:text-indigo-600 transition-colors">
                  Editar
                </button>
                <button onClick={() => handleToggle(c)}
                  disabled={togglingId === c.id}
                  className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-600
                             hover:border-slate-300 transition-colors disabled:opacity-50 disabled:cursor-wait">
                  {togglingId === c.id ? '...' : esActiva(c) ? 'Desactivar' : 'Activar'}
                </button>
                <button onClick={() => handleDelete(c)}
                  className="text-xs text-red-400 hover:text-red-600 px-1 transition-colors">✕</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {cuentas.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <p className="mb-2 text-sm">No hay cuentas configuradas.</p>
          <p className="text-xs mb-4 text-slate-300">
            Creá tus cuentas bancarias y cajas para poder asignar cobros y pagos.
          </p>
          {!readOnly && (
            <button onClick={openNew} className="text-indigo-500 text-sm hover:text-indigo-700">
              Crear primera cuenta
            </button>
          )}
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
                  {editing ? (
                    <div className="w-full px-3 py-2 border border-slate-200 bg-slate-50 rounded-lg text-sm text-slate-500">
                      {form.moneda}
                    </div>
                  ) : (
                    <select value={form.moneda} onChange={e => setForm(f => ({ ...f, moneda: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option>USD</option>
                      <option>ARS</option>
                    </select>
                  )}
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
