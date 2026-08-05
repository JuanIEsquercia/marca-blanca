'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { uploadToCloudinary } from '@/lib/cloudinary'
import { cn, estaVencido, formatCurrency, formatDate, redondear2, sumarMontos } from '@/lib/utils'
import IvaCalculator from './IvaCalculator'
import PlanDePagoModal from './PlanDePagoModal'
import CuotasList from './CuotasList'
import CuentaPropiaSelect from './CuentaPropiaSelect'
import type { CobroProyecto, CuentaPropia } from '@/types/database'

type FiltroCobro = 'todos' | 'Pendiente' | 'Cobrado'

type CobroConCertificado = CobroProyecto & {
  certificados_avance: { numero: number; periodo: string } | null
  cuentas_propias: CuentaPropia | null
}

type CertificadoRef = { id: string; numero: number; periodo: string; monto_certificado: number; contrato_obra_id: string }
type ContratoRef = { id: string; moneda: string; descripcion: string | null; fecha_inicio: string | null; compradores: { nombre_completo: string } | null }

interface Props {
  cobros: CobroConCertificado[]
  cuentasPropias: CuentaPropia[]
  certificados: CertificadoRef[]
  contratos: ContratoRef[]
  obraId: string
  constructoraId: string
  puedeCrearCuenta: boolean
  readOnly?: boolean
}

const EMPTY_PAGO = { fecha_pago: new Date().toISOString().split('T')[0], cuenta_propia_id: '' }
const mkEmptyCobro = (contratoId: string, moneda: string) => ({
  monto: '', fecha_vencimiento: '', certificado_id: '', contrato_obra_id: contratoId, moneda, notas: '',
  monto_neto: '', iva: '', percepciones: '', numero_comprobante: '',
})

export default function CobrosObraManager({ cobros, cuentasPropias, certificados, contratos, obraId, constructoraId, puedeCrearCuenta, readOnly = false }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [filtro, setFiltro] = useState<FiltroCobro>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [pagoTarget, setPagoTarget]       = useState<CobroConCertificado | null>(null)
  const [pagoForm, setPagoForm]           = useState(EMPTY_PAGO)
  const [cuentasNuevas, setCuentasNuevas] = useState<CuentaPropia[]>([])
  // Plan de cobro (cuotas/cheques) — alternativa al cobro único de arriba.
  const [planDePagoTarget, setPlanDePagoTarget] = useState<CobroConCertificado | null>(null)
  const [expandedCobroId, setExpandedCobroId]   = useState<string | null>(null)
  const [showNuevo, setShowNuevo]         = useState(false)
  const [nuevoForm, setNuevoForm]         = useState(() => mkEmptyCobro(contratos[0]?.id ?? '', contratos[0]?.moneda ?? 'ARS'))
  const [deleteTarget, setDeleteTarget]   = useState<CobroConCertificado | null>(null)
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState<string | null>(null)
  const [comprobanteUrl, setComprobanteUrl] = useState('')
  const [uploadingComp, setUploadingComp]   = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const nombreContrato = (c: ContratoRef) => c.compradores?.nombre_completo
    ? `${c.compradores.nombre_completo}${c.descripcion ? ` — ${c.descripcion}` : ''}`
    : c.descripcion ?? 'Contrato sin descripción'

  const certificadosDelContrato = certificados.filter(c => c.contrato_obra_id === nuevoForm.contrato_obra_id)

  function refresh() { startTransition(() => router.refresh()) }

  function esVencido(c: CobroConCertificado) {
    return estaVencido(c.fecha_vencimiento, c.estado, 'Pendiente')
  }

  async function handleUploadComp(file: File) {
    setUploadingComp(true)
    try {
      const result = await uploadToCloudinary(file, 'renders')
      setComprobanteUrl(result.secure_url)
    } catch {
      setError('Error al subir el comprobante')
    } finally {
      setUploadingComp(false)
    }
  }

  const vencidos   = cobros.filter(c => esVencido(c))
  const pendientes = cobros.filter(c => c.estado === 'Pendiente' && !esVencido(c))
  const cobrados   = cobros.filter(c => c.estado === 'Cobrado')

  // Los cobros de un mismo proyecto pueden estar en distinta moneda (el
  // selector de "Nuevo cobro" lo permite) — se agrupa por moneda en vez de
  // sumar todo junto para no mostrar un total que mezcle ARS y USD.
  const monedasPresentes = Array.from(new Set(cobros.map(c => c.moneda)))
  const monedasKpi = monedasPresentes.length > 0 ? monedasPresentes : [contratos[0]?.moneda ?? 'ARS']
  const totalesPorMoneda = Object.fromEntries(monedasKpi.map(m => [m, {
    cobrado: sumarMontos(cobrados.filter(c => c.moneda === m).map(c => c.monto)),
    pendiente: sumarMontos(pendientes.filter(c => c.moneda === m).map(c => c.monto)),
    vencido: sumarMontos(vencidos.filter(c => c.moneda === m).map(c => c.monto)),
    cobradosCount: cobrados.filter(c => c.moneda === m).length,
    pendientesCount: pendientes.filter(c => c.moneda === m).length,
    vencidosCount: vencidos.filter(c => c.moneda === m).length,
  }]))

  const porEstado = filtro === 'Pendiente'
    ? [...vencidos, ...pendientes]
    : filtro === 'Cobrado'
      ? cobrados
      : [...vencidos, ...pendientes, ...cobrados]

  const q = busqueda.trim().toLowerCase()
  const filtrados = !q ? porEstado : porEstado.filter(c =>
    (c.notas ?? '').toLowerCase().includes(q) ||
    String(c.numero ?? '').includes(q) ||
    (c.certificados_avance?.periodo ?? '').toLowerCase().includes(q)
  )

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
        estado:           'Cobrado',
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
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.from('cobros_proyecto').delete().eq('id', deleteTarget.id)
    setLoading(false)
    if (err) { setError(err.message); return }
    setDeleteTarget(null)
    refresh()
  }

  // ── Nuevo cobro ───────────────────────────────────────────────

  async function handleNuevoSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nuevoForm.contrato_obra_id) { setError('Elegí a qué contrato pertenece este cobro'); return }
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase
      .from('cobros_proyecto')
      .insert({
        obra_id:           obraId,
        constructora_id:   constructoraId,
        contrato_obra_id:  nuevoForm.contrato_obra_id,
        certificado_id:    nuevoForm.certificado_id || null,
        monto:             redondear2(parseFloat(nuevoForm.monto)),
        moneda:            nuevoForm.moneda,
        fecha_vencimiento: nuevoForm.fecha_vencimiento,
        fecha:             nuevoForm.fecha_vencimiento, // legacy
        notas:             nuevoForm.notas.trim() || null,
        estado:            'Pendiente',
        monto_neto:         nuevoForm.monto_neto ? redondear2(parseFloat(nuevoForm.monto_neto)) : null,
        iva:                nuevoForm.iva ? redondear2(parseFloat(nuevoForm.iva)) : null,
        percepciones:       nuevoForm.percepciones ? redondear2(parseFloat(nuevoForm.percepciones)) : null,
        numero_comprobante: nuevoForm.numero_comprobante.trim() || null,
        comprobante_url:    comprobanteUrl || null,
      })
    setLoading(false)
    if (err) { setError(err.message); return }
    setShowNuevo(false)
    setNuevoForm(mkEmptyCobro(contratos[0]?.id ?? '', contratos[0]?.moneda ?? 'ARS'))
    setComprobanteUrl('')
    refresh()
  }

  return (
    <div className="space-y-6">

      {/* KPIs — una fila por moneda, nunca se mezclan ARS/USD en un total */}
      <div className="space-y-3">
        {monedasKpi.map(m => {
          const t = totalesPorMoneda[m]
          return (
            <div key={m}>
              {monedasKpi.length > 1 && <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{m}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-5">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Cobrado</p>
                  <p className="text-xl sm:text-2xl font-bold text-emerald-600 truncate" title={formatCurrency(t.cobrado, m)}>{formatCurrency(t.cobrado, m)}</p>
                  <p className="text-xs text-slate-400 mt-1">{t.cobradosCount} cobro{t.cobradosCount !== 1 ? 's' : ''}</p>
                </div>
                <div className="bg-white border border-amber-200 rounded-2xl p-5">
                  <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-1">Pendiente</p>
                  <p className="text-xl sm:text-2xl font-bold text-amber-700 truncate" title={formatCurrency(t.pendiente, m)}>{formatCurrency(t.pendiente, m)}</p>
                  <p className="text-xs text-amber-500 mt-1">{t.pendientesCount} cobro{t.pendientesCount !== 1 ? 's' : ''}</p>
                </div>
                <div className={cn(
                  'rounded-2xl p-5 border min-w-0',
                  t.vencidosCount > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'
                )}>
                  <p className={cn('text-xs font-semibold uppercase tracking-wider mb-1', t.vencidosCount > 0 ? 'text-red-600' : 'text-slate-500')}>
                    Vencido
                  </p>
                  <p className={cn('text-xl sm:text-2xl font-bold truncate', t.vencidosCount > 0 ? 'text-red-700' : 'text-slate-400')} title={formatCurrency(t.vencido, m)}>
                    {formatCurrency(t.vencido, m)}
                  </p>
                  <p className={cn('text-xs mt-1', t.vencidosCount > 0 ? 'text-red-500' : 'text-slate-400')}>
                    {t.vencidosCount} cobro{t.vencidosCount !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Barra de acciones */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por nota, N° o período..."
          className="w-full sm:w-56 px-3 py-1.5 border border-slate-300 rounded-lg text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="flex items-center gap-2">
          {([
            { key: 'todos', label: 'Todos' },
            { key: 'Pendiente', label: 'Pendientes' },
            { key: 'Cobrado', label: 'Cobrados' },
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
          onClick={() => { setShowNuevo(true); setNuevoForm(mkEmptyCobro(contratos[0]?.id ?? '', contratos[0]?.moneda ?? 'ARS')); setComprobanteUrl(''); setError(null) }}
          disabled={contratos.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors">
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
            const cuotas = cobro.cobro_pagos ?? []
            return (
              <div key={cobro.id}>
              <div
                className={cn('px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4', vencido && 'bg-red-50/50')}>
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className={cn(
                    'w-2.5 h-2.5 rounded-full shrink-0 mt-1.5',
                    cobro.estado === 'Cobrado' ? 'bg-emerald-500' :
                    vencido ? 'bg-red-500' : 'bg-amber-400'
                  )} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-900">{formatCurrency(cobro.monto, cobro.moneda)}</p>
                      {contratos.length > 1 && contratos.find(c => c.id === cobro.contrato_obra_id) && (
                        <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                          {nombreContrato(contratos.find(c => c.id === cobro.contrato_obra_id)!)}
                        </span>
                      )}
                      {cobro.certificados_avance && (
                        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                          Cert. #{cobro.certificados_avance.numero} — {cobro.certificados_avance.periodo}
                        </span>
                      )}
                      <span className={cn(
                        'text-xs px-2 py-0.5 rounded font-medium',
                        cobro.estado === 'Cobrado' ? 'bg-emerald-100 text-emerald-700' :
                        vencido ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      )}>
                        {cobro.estado === 'Cobrado' ? 'Cobrado' : vencido ? 'Vencido' : 'Pendiente'}
                      </span>
                      {cuotas.length > 0 && (
                        <button onClick={() => setExpandedCobroId(id => id === cobro.id ? null : cobro.id)}
                          className="text-[11px] text-indigo-600 hover:text-indigo-800">
                          {cuotas.filter(c => c.estado === 'Cobrado').length}/{cuotas.length} cobradas {expandedCobroId === cobro.id ? '▲' : '▼'}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                      {cobro.estado === 'Cobrado' && cobro.fecha_pago && (
                        <span>Cobrado: {formatDate(cobro.fecha_pago)}</span>
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
                </div>

                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                  {!readOnly && cobro.estado === 'Pendiente' && cuotas.length === 0 && (
                    <button
                      onClick={() => { setPagoTarget(cobro); setPagoForm(EMPTY_PAGO); setError(null) }}
                      className={cn(
                        'text-xs px-3 py-1.5 rounded-lg font-medium transition-colors text-white',
                        vencido ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'
                      )}>
                      Registrar cobro
                    </button>
                  )}
                  {!readOnly && cobro.estado === 'Pendiente' && (
                    <button
                      onClick={() => setPlanDePagoTarget(cobro)}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors border border-indigo-300 text-indigo-700 hover:bg-indigo-50">
                      {cuotas.length > 0 ? 'Editar plan' : 'Plan de cobro'}
                    </button>
                  )}
                  {cobro.estado === 'Cobrado' && (
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
              {expandedCobroId === cobro.id && (
                <div className="px-5 pb-4">
                  <CuotasList entidad="cobro" cuotas={cuotas} moneda={cobro.moneda}
                    cuentasPropias={cuentasPropias} constructoraId={constructoraId} obraId={obraId}
                    puedeCrearCuenta={puedeCrearCuenta} readOnly={readOnly} onChanged={refresh} />
                </div>
              )}
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
              ¿Eliminar el cobro de <strong>{formatCurrency(deleteTarget.monto, deleteTarget.moneda)}</strong>?
              {deleteTarget.certificados_avance && ` (Cert. #${deleteTarget.certificados_avance.numero} — ${deleteTarget.certificados_avance.periodo})`}
              Esta acción no se puede deshacer.
            </p>
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
            )}
            <div className="flex gap-3">
              <button onClick={() => { setDeleteTarget(null); setError(null) }}
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
            <form onSubmit={handleNuevoSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {contratos.length > 1 && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Contrato *</label>
                  <select required value={nuevoForm.contrato_obra_id}
                    onChange={e => {
                      const contratoId = e.target.value
                      const c = contratos.find(x => x.id === contratoId)
                      setNuevoForm(f => ({ ...f, contrato_obra_id: contratoId, moneda: c?.moneda ?? f.moneda, certificado_id: '' }))
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">Elegir contrato...</option>
                    {contratos.map(c => <option key={c.id} value={c.id}>{nombreContrato(c)}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Moneda *</label>
                <select value={nuevoForm.moneda}
                  onChange={e => setNuevoForm(f => ({ ...f, moneda: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="ARS">ARS — Pesos</option>
                  <option value="USD">USD — Dólares</option>
                </select>
              </div>
              <IvaCalculator
                montoNeto={nuevoForm.monto_neto} iva={nuevoForm.iva} monto={nuevoForm.monto}
                onChangeMontoNeto={v => setNuevoForm(f => ({ ...f, monto_neto: v }))}
                onChangeIva={v => setNuevoForm(f => ({ ...f, iva: v }))}
                onChangeMonto={v => setNuevoForm(f => ({ ...f, monto: v }))}
              />
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Percepciones</label>
                <input type="number" min="0" step="0.01" value={nuevoForm.percepciones}
                  onChange={e => setNuevoForm(f => ({ ...f, percepciones: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de vencimiento *</label>
                <input required type="date" value={nuevoForm.fecha_vencimiento}
                  onChange={e => setNuevoForm(f => ({ ...f, fecha_vencimiento: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">N° comprobante</label>
                <input value={nuevoForm.numero_comprobante}
                  onChange={e => setNuevoForm(f => ({ ...f, numero_comprobante: e.target.value }))}
                  placeholder="Factura A 0001-00012345"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Foto comprobante</label>
                {comprobanteUrl ? (
                  <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <a href={comprobanteUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-indigo-600 hover:underline truncate flex-1">
                      Ver comprobante adjunto
                    </a>
                    <button type="button" onClick={() => setComprobanteUrl('')}
                      className="text-xs text-red-400 hover:text-red-600">Quitar</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => fileRef.current?.click()}
                    disabled={uploadingComp}
                    className="w-full h-16 border-2 border-dashed border-slate-300 rounded-lg text-slate-400 text-xs
                               hover:border-indigo-400 hover:text-indigo-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                    {uploadingComp ? 'Subiendo...' : '+ Adjuntar foto de comprobante'}
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadComp(f); e.target.value = '' }} />
              </div>
              {certificadosDelContrato.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Certificado (opcional)</label>
                  <select value={nuevoForm.certificado_id}
                    onChange={e => setNuevoForm(f => ({ ...f, certificado_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">— Sin certificado —</option>
                    {certificadosDelContrato.map(c => (
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

      {/* MODAL: Registrar cobro */}
      {pagoTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Registrar cobro</h2>
                <p className="text-sm text-slate-500 mt-0.5">{formatCurrency(pagoTarget.monto, pagoTarget.moneda)}</p>
              </div>
              <button onClick={() => setPagoTarget(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handlePagoSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de cobro *</label>
                <input required type="date" value={pagoForm.fecha_pago}
                  onChange={e => setPagoForm(f => ({ ...f, fecha_pago: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Acreditado en</label>
                <CuentaPropiaSelect
                  cuentas={[...cuentasPropias, ...cuentasNuevas]}
                  onCreated={c => setCuentasNuevas(prev => [...prev, c])}
                  value={pagoForm.cuenta_propia_id}
                  onChange={id => setPagoForm(f => ({ ...f, cuenta_propia_id: id }))}
                  constructoraId={constructoraId}
                  obraId={obraId}
                  puedeCrear={puedeCrearCuenta}
                  moneda={pagoTarget.moneda}
                  emptyLabel="— Sin cuenta asignada —" />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setPagoTarget(null)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Guardando...' : 'Confirmar cobro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Plan de cobro */}
      {planDePagoTarget && (
        <PlanDePagoModal
          entidad="cobro"
          id={planDePagoTarget.id}
          montoTotal={planDePagoTarget.monto}
          moneda={planDePagoTarget.moneda}
          cuotasExistentes={planDePagoTarget.cobro_pagos ?? []}
          constructoraId={constructoraId}
          obraId={obraId}
          puedeCrearCuenta={puedeCrearCuenta}
          onClose={() => setPlanDePagoTarget(null)}
          onSaved={() => { setExpandedCobroId(planDePagoTarget.id); setPlanDePagoTarget(null); refresh() }}
        />
      )}
    </div>
  )
}
