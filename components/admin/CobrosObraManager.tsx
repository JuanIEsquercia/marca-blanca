'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import type { CobroProyecto, CuentaPropia } from '@/types/database'

type FiltroCobro = 'todos' | 'pendiente' | 'cobrado'

type CobroConCertificado = CobroProyecto & {
  certificados_avance: { numero: number; periodo: string } | null
  cuentas_propias: CuentaPropia | null
}

type CertificadoRef = { id: string; numero: number; periodo: string; monto_certificado: number }

interface Props {
  cobros: CobroConCertificado[]
  cuentasPropias: CuentaPropia[]
  certificados: CertificadoRef[]
  obraId: string
  constructoraId: string
  moneda: string
  readOnly?: boolean
}

const EMPTY_PAGO   = { fecha_pago: new Date().toISOString().split('T')[0], cuenta_propia_id: '' }
const mkEmptyCobro = (moneda: string) => ({ monto: '', fecha_vencimiento: '', certificado_id: '', moneda, notas: '' })

export default function CobrosObraManager({ cobros, cuentasPropias, certificados, obraId, constructoraId, moneda, readOnly = false }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [filtro, setFiltro] = useState<FiltroCobro>('todos')
  const [pagoTarget, setPagoTarget]       = useState<CobroConCertificado | null>(null)
  const [pagoForm, setPagoForm]           = useState(EMPTY_PAGO)
  const [showNuevo, setShowNuevo]         = useState(false)
  const [nuevoForm, setNuevoForm]         = useState(() => mkEmptyCobro(moneda))
  const [deleteTarget, setDeleteTarget]   = useState<CobroConCertificado | null>(null)
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState<string | null>(null)

  function refresh() { startTransition(() => router.refresh()) }

  const today = new Date().toISOString().split('T')[0]

  function esVencido(c: CobroConCertificado) {
    return c.estado === 'pendiente' && c.fecha_vencimiento != null && c.fecha_vencimiento < today
  }

  const vencidos   = cobros.filter(c => esVencido(c))
  const pendientes = cobros.filter(c => c.estado === 'pendiente' && !esVencido(c))
  const cobrados   = cobros.filter(c => c.estado === 'cobrado')

  const totalCobrado   = cobrados.reduce((s, c) => s + c.monto, 0)
  const totalPendiente = pendientes.reduce((s, c) => s + c.monto, 0)
  const totalVencido   = vencidos.reduce((s, c) => s + c.monto, 0)

  const filtrados = filtro === 'pendiente'
    ? [...vencidos, ...pendientes]
    : filtro === 'cobrado'
      ? cobrados
      : [...vencidos, ...pendientes, ...cobrados]

  // ── Registrar pago ────────────────────────────────────────────

  async function handlePagoSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!pagoTarget) return
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase
      .from('cobros_proyecto')
      .update({
        estado:           'cobrado',
        fecha_pago:       pagoForm.fecha_pago,
        cuenta_propia_id: pagoForm.cuenta_propia_id || null,
      })
      .eq('id', pagoTarget.id)
    setLoading(false)
    if (err) { setError(err.message); return }
    setPagoTarget(null)
    setPagoForm(EMPTY_PAGO)
    refresh()
  }

  // ── Eliminar cobro ────────────────────────────────────────────

  async function handleDelete() {
    if (!deleteTarget) return
    setLoading(true)
    const supabase = createClient()
    await supabase.from('cobros_proyecto').delete().eq('id', deleteTarget.id)
    setLoading(false)
    setDeleteTarget(null)
    refresh()
  }

  // ── Nuevo cobro ───────────────────────────────────────────────

  async function handleNuevoSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase
      .from('cobros_proyecto')
      .insert({
        obra_id:           obraId,
        constructora_id:   constructoraId,
        certificado_id:    nuevoForm.certificado_id || null,
        monto:             parseFloat(nuevoForm.monto),
        moneda:            nuevoForm.moneda,
        fecha_vencimiento: nuevoForm.fecha_vencimiento,
        fecha:             nuevoForm.fecha_vencimiento, // legacy
        notas:             nuevoForm.notas.trim() || null,
        estado:            'pendiente',
      })
    setLoading(false)
    if (err) { setError(err.message); return }
    setShowNuevo(false)
    setNuevoForm(mkEmptyCobro(moneda))
    refresh()
  }

  return (
    <div className="space-y-6">

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Cobrado</p>
          <p className="text-2xl font-bold text-emerald-600">{formatCurrency(totalCobrado, moneda)}</p>
          <p className="text-xs text-slate-400 mt-1">{cobrados.length} pago{cobrados.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="bg-white border border-amber-200 rounded-2xl p-5">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-1">Pendiente</p>
          <p className="text-2xl font-bold text-amber-700">{formatCurrency(totalPendiente, moneda)}</p>
          <p className="text-xs text-amber-500 mt-1">{pendientes.length} cobro{pendientes.length !== 1 ? 's' : ''}</p>
        </div>
        <div className={cn(
          'rounded-2xl p-5 border',
          vencidos.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'
        )}>
          <p className={cn('text-xs font-semibold uppercase tracking-wider mb-1', vencidos.length > 0 ? 'text-red-600' : 'text-slate-500')}>
            Vencido
          </p>
          <p className={cn('text-2xl font-bold', vencidos.length > 0 ? 'text-red-700' : 'text-slate-400')}>
            {formatCurrency(totalVencido, moneda)}
          </p>
          <p className={cn('text-xs mt-1', vencidos.length > 0 ? 'text-red-500' : 'text-slate-400')}>
            {vencidos.length} cobro{vencidos.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Barra de acciones */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {([
            { key: 'todos', label: 'Todos' },
            { key: 'pendiente', label: 'Pendientes' },
            { key: 'cobrado', label: 'Cobrados' },
          ] as { key: FiltroCobro; label: string }[]).map(f => (
            <button key={f.key} onClick={() => setFiltro(f.key)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                filtro === f.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
              )}>
              {f.label}
            </button>
          ))}
        </div>
        {!readOnly && <button
          onClick={() => { setShowNuevo(true); setNuevoForm(mkEmptyCobro(moneda)); setError(null) }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuevo cobro
        </button>}
      </div>

      {/* Lista */}
      {filtrados.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl px-5 py-12 text-center text-slate-400">
          <p className="text-sm">Sin cobros en esta vista.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden">
          {filtrados.map(cobro => {
            const vencido = esVencido(cobro)
            return (
              <div key={cobro.id}
                className={cn('px-5 py-4 flex items-center gap-4', vencido && 'bg-red-50/50')}>
                <div className={cn(
                  'w-2.5 h-2.5 rounded-full shrink-0',
                  cobro.estado === 'cobrado' ? 'bg-emerald-500' :
                  vencido ? 'bg-red-500' : 'bg-amber-400'
                )} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-900">{formatCurrency(cobro.monto, cobro.moneda)}</p>
                    {cobro.certificados_avance && (
                      <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                        Cert. #{cobro.certificados_avance.numero} — {cobro.certificados_avance.periodo}
                      </span>
                    )}
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded font-medium',
                      cobro.estado === 'cobrado' ? 'bg-emerald-100 text-emerald-700' :
                      vencido ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    )}>
                      {cobro.estado === 'cobrado' ? 'Cobrado' : vencido ? 'Vencido' : 'Pendiente'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                    {cobro.estado === 'cobrado' && cobro.fecha_pago && (
                      <span>Pagado: {formatDate(cobro.fecha_pago)}</span>
                    )}
                    {cobro.fecha_vencimiento && (
                      <span className={vencido ? 'text-red-500' : ''}>
                        Vence: {formatDate(cobro.fecha_vencimiento)}
                      </span>
                    )}
                    {cobro.cuentas_propias && <span>→ {cobro.cuentas_propias.nombre}</span>}
                    {cobro.notas && <span>{cobro.notas}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!readOnly && cobro.estado === 'pendiente' && (
                    <button
                      onClick={() => { setPagoTarget(cobro); setPagoForm(EMPTY_PAGO); setError(null) }}
                      className={cn(
                        'text-xs px-3 py-1.5 rounded-lg font-medium transition-colors text-white',
                        vencido ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'
                      )}>
                      Registrar pago
                    </button>
                  )}
                  {cobro.estado === 'cobrado' && (
                    <button
                      onClick={() => window.open(`/print/cobro/${cobro.id}`, '_blank')}
                      title="Imprimir recibo"
                      className="text-slate-400 hover:text-slate-600 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                      </svg>
                    </button>
                  )}
                  {!readOnly && <button
                    onClick={() => setDeleteTarget(cobro)}
                    title="Eliminar cobro"
                    className="text-red-300 hover:text-red-500 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* MODAL: Confirmar eliminación */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Eliminar cobro</h2>
            <p className="text-sm text-slate-600 mb-6">
              ¿Eliminar el cobro de <strong>{formatCurrency(deleteTarget.monto, moneda)}</strong>?
              {deleteTarget.certificados_avance && ` (Cert. #${deleteTarget.certificados_avance.numero} — ${deleteTarget.certificados_avance.periodo})`}
              Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleDelete} disabled={loading}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                {loading ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Nuevo cobro */}
      {showNuevo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Nuevo cobro</h2>
              <button onClick={() => setShowNuevo(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleNuevoSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Monto *</label>
                  <input required type="number" min="0" step="0.01" value={nuevoForm.monto}
                    onChange={e => setNuevoForm(f => ({ ...f, monto: e.target.value }))}
                    placeholder="Ej: 500000"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Moneda *</label>
                  <select value={nuevoForm.moneda}
                    onChange={e => setNuevoForm(f => ({ ...f, moneda: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="ARS">ARS — Pesos</option>
                    <option value="USD">USD — Dólares</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de vencimiento *</label>
                <input required type="date" value={nuevoForm.fecha_vencimiento}
                  onChange={e => setNuevoForm(f => ({ ...f, fecha_vencimiento: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {certificados.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Certificado (opcional)</label>
                  <select value={nuevoForm.certificado_id}
                    onChange={e => setNuevoForm(f => ({ ...f, certificado_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">— Sin certificado —</option>
                    {certificados.map(c => (
                      <option key={c.id} value={c.id}>
                        #{c.numero} — {c.periodo} ({formatCurrency(c.monto_certificado, nuevoForm.moneda)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notas</label>
                <input value={nuevoForm.notas}
                  onChange={e => setNuevoForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Ej: Cuota 1/3, anticipo, saldo final..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowNuevo(false)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Guardando...' : 'Crear cobro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Registrar pago */}
      {pagoTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Registrar pago</h2>
                <p className="text-sm text-slate-500 mt-0.5">{formatCurrency(pagoTarget.monto, moneda)}</p>
              </div>
              <button onClick={() => setPagoTarget(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handlePagoSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de pago *</label>
                <input required type="date" value={pagoForm.fecha_pago}
                  onChange={e => setPagoForm(f => ({ ...f, fecha_pago: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {cuentasPropias.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Acreditado en</label>
                  <select value={pagoForm.cuenta_propia_id}
                    onChange={e => setPagoForm(f => ({ ...f, cuenta_propia_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">— Sin cuenta asignada —</option>
                    {cuentasPropias.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre} ({c.moneda})</option>
                    ))}
                  </select>
                </div>
              )}
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setPagoTarget(null)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Guardando...' : 'Confirmar pago'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
