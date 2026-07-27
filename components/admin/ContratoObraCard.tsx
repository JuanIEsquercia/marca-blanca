'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency, formatDate, redondear2 } from '@/lib/utils'
import { obtenerOCrearRubro } from '@/lib/rubros'
import ConfirmModal from './ConfirmModal'
import ItemsRubroTable, { nuevaFilaItem, type FilaItem } from './ItemsRubroTable'
import type { ContratoObra, CertificadoAvance, CobroProyecto, Gasto, CuentaPropia, EstadoCertificado, ContratoObraItem, CertificadoItem } from '@/types/database'

type ConfirmState = { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> }
type CertificadoConMov = CertificadoAvance & { cobros_proyecto?: CobroProyecto[]; pagos?: Gasto[]; certificado_items?: CertificadoItem[] }

interface Props {
  contrato: ContratoObra
  certificados: CertificadoConMov[]
  contratoObraItems: ContratoObraItem[]
  cuentasPropias: CuentaPropia[]
  constructoraId: string
  obraId: string
  readOnly?: boolean
  rubros?: string[]
  onChanged: () => void
}

const ESTADO_CERT: Record<EstadoCertificado, { label: string; color: string; next: EstadoCertificado | null; nextLabel: string | null }> = {
  borrador:   { label: 'Borrador',   color: 'bg-slate-100 text-slate-600',   next: 'presentado', nextLabel: 'Marcar como presentado' },
  presentado: { label: 'Presentado', color: 'bg-amber-100 text-amber-700',   next: 'aprobado',   nextLabel: 'Marcar como aprobado' },
  aprobado:   { label: 'Aprobado',   color: 'bg-emerald-100 text-emerald-700', next: null,       nextLabel: null },
}

const EMPTY_CERT = { periodo: '', porcentaje_avance: '', monto_certificado: '', descripcion_avances: '', notas: '' }
const EMPTY_COBRO = { numero: '', fecha_vencimiento: '', monto: '', moneda: 'ARS', notas: '' }
const EMPTY_PAGO_SUBC = { descripcion: '', fecha_vencimiento: '', monto: '', moneda: 'ARS' }
const EMPTY_REGISTRAR_PAGO = { fecha_pago: new Date().toISOString().split('T')[0], cuenta_propia_id: '' }

// Toda la gestión de UN contrato de obra — certificados de avance y, según
// el tipo, o bien Cobros (contrato con el cliente, comportamiento de
// siempre) o Pagos a proveedor (contrato con un subcontratista, genera
// gastos en vez de cobros_proyecto). Extraído de CertificadosManager para
// poder mostrar varios contratos por proyecto en vez de uno solo.
export default function ContratoObraCard({ contrato, certificados, contratoObraItems, cuentasPropias, constructoraId, obraId, readOnly = false, rubros = [], onChanged }: Props) {
  const esCliente = contrato.tipo === 'cliente'
  const [confirmModal, setConfirmModal] = useState<ConfirmState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [expanded, setExpanded] = useState<string | null>(null)
  const [showCertForm, setShowCertForm] = useState(false)
  const [certForm, setCertForm] = useState(EMPTY_CERT)
  const [itemPcts, setItemPcts] = useState<Record<string, string>>({})
  const [showAdicionalForm, setShowAdicionalForm] = useState(false)
  const [adicionalFilas, setAdicionalFilas] = useState<FilaItem[]>([nuevaFilaItem()])

  const usaItems = contratoObraItems.length > 0

  const avanceAcumuladoPrevio: Record<string, number> = {}
  for (const cert of certificados) {
    for (const ci of cert.certificado_items ?? []) {
      avanceAcumuladoPrevio[ci.contrato_obra_item_id] = Math.max(avanceAcumuladoPrevio[ci.contrato_obra_item_id] ?? 0, ci.pct_avance_acumulado)
    }
  }

  function abrirNuevoCert() {
    setShowCertForm(true)
    setCertForm(EMPTY_CERT)
    const iniciales: Record<string, string> = {}
    for (const item of contratoObraItems) iniciales[item.id] = String(avanceAcumuladoPrevio[item.id] ?? 0)
    setItemPcts(iniciales)
    setError(null)
  }

  const totalCertificarEsteItem = (item: ContratoObraItem) => {
    const nuevoPct = parseFloat(itemPcts[item.id] ?? '0') || 0
    const previoPct = avanceAcumuladoPrevio[item.id] ?? 0
    return redondear2(((nuevoPct - previoPct) / 100) * item.monto_contratado)
  }
  const totalCertificarNuevo = contratoObraItems.reduce((s, item) => s + totalCertificarEsteItem(item), 0)

  // Cobros (contrato cliente)
  const [cobroParaCert, setCobroParaCert] = useState<string | null>(null)
  const [cobroForm, setCobroForm] = useState({ ...EMPTY_COBRO, moneda: contrato.moneda })
  const [pagoCobroTarget, setPagoCobroTarget] = useState<CobroProyecto | null>(null)

  // Pagos a proveedor (contrato subcontratista)
  const [pagoParaCert, setPagoParaCert] = useState<string | null>(null)
  const [pagoSubcForm, setPagoSubcForm] = useState({ ...EMPTY_PAGO_SUBC, moneda: contrato.moneda })
  const [pagarGastoTarget, setPagarGastoTarget] = useState<Gasto | null>(null)

  const [registrarPagoForm, setRegistrarPagoForm] = useState(EMPTY_REGISTRAR_PAGO)

  function refresh() { onChanged() }

  // ── Nuevo certificado ─────────────────────────────────────────

  async function handleCertSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createClient()

    if (usaItems) {
      const { data: nuevoCert, error: errCert } = await supabase
        .from('certificados_avance')
        .insert({
          contrato_obra_id: contrato.id,
          obra_id: obraId,
          constructora_id: constructoraId,
          periodo: certForm.periodo.trim(),
          porcentaje_avance: 0,
          monto_certificado: 0,
          descripcion_avances: certForm.descripcion_avances.trim() || null,
          notas: certForm.notas.trim() || null,
          estado: 'borrador',
        })
        .select('id')
        .single()

      if (errCert || !nuevoCert) { setLoading(false); setError(errCert?.message ?? 'Error al crear el certificado'); return }

      const filas = contratoObraItems.map(item => ({
        certificado_id: nuevoCert.id,
        contrato_obra_item_id: item.id,
        constructora_id: constructoraId,
        pct_avance_acumulado: parseFloat(itemPcts[item.id] ?? '0') || 0,
        monto_certificado: totalCertificarEsteItem(item),
      }))

      const { error: errItems } = await supabase.from('certificado_items').insert(filas)
      setLoading(false)
      if (errItems) {
        await supabase.from('certificados_avance').delete().eq('id', nuevoCert.id)
        setError(errItems.message)
        return
      }
    } else {
      const nextNum = (certificados.length > 0 ? Math.max(...certificados.map(c => c.numero)) : 0) + 1
      const { error: err } = await supabase
        .from('certificados_avance')
        .insert({
          contrato_obra_id: contrato.id,
          obra_id: obraId,
          constructora_id: constructoraId,
          numero: nextNum,
          periodo: certForm.periodo.trim(),
          porcentaje_avance: parseFloat(certForm.porcentaje_avance),
          monto_certificado: parseFloat(certForm.monto_certificado),
          descripcion_avances: certForm.descripcion_avances.trim() || null,
          notas: certForm.notas.trim() || null,
          estado: 'borrador',
        })
      setLoading(false)
      if (err) { setError(err.message); return }
    }

    setCertForm(EMPTY_CERT)
    setShowCertForm(false)
    refresh()
  }

  async function avanzarEstado(cert: CertificadoConMov) {
    const next = ESTADO_CERT[cert.estado].next
    if (!next) return
    const supabase = createClient()
    const updates: Record<string, string> = { estado: next }
    if (next === 'presentado') updates.fecha_presentacion = new Date().toISOString().split('T')[0]
    if (next === 'aprobado')   updates.fecha_aprobacion   = new Date().toISOString().split('T')[0]
    await supabase.from('certificados_avance').update(updates).eq('id', cert.id)
    refresh()
  }

  async function handleAdicionalSubmit(e: React.FormEvent) {
    e.preventDefault()
    const filasValidas = adicionalFilas.filter(f => f.rubro.trim() && f.precio_unitario)
    if (filasValidas.length === 0) return
    setError(null)
    setLoading(true)
    const supabase = createClient()
    const rubrosCanonicos = await Promise.all(filasValidas.map(f => obtenerOCrearRubro(supabase, constructoraId, f.rubro)))
    const { error: err } = await supabase.from('contrato_obra_items').insert(
      filasValidas.map((f, i) => ({
        contrato_obra_id: contrato.id,
        constructora_id: constructoraId,
        orden: contratoObraItems.length + i,
        rubro: rubrosCanonicos[i],
        unidad: f.unidad.trim() || null,
        cantidad: redondear2(parseFloat(f.cantidad) || 1),
        precio_unitario: redondear2(parseFloat(f.precio_unitario)),
        origen: 'adicional',
      }))
    )
    setLoading(false)
    if (err) { setError(err.message); return }
    setAdicionalFilas([nuevaFilaItem()])
    setShowAdicionalForm(false)
    refresh()
  }

  function handleDeleteCert(cert: CertificadoConMov) {
    setConfirmModal({
      title: 'Eliminar certificado',
      message: `¿Eliminar certificado N°${cert.numero} "${cert.periodo}"? Se eliminarán también sus ${esCliente ? 'cobros' : 'referencias de pago'}.`,
      confirmLabel: 'Eliminar',
      danger: true,
      onConfirm: async () => {
        const supabase = createClient()
        await supabase.from('certificados_avance').delete().eq('id', cert.id)
        setConfirmModal(null)
        refresh()
      },
    })
  }

  // ── Cobros (contrato cliente) ────────────────────────────────

  async function handleCobroSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!cobroParaCert) return
    setError(null)
    setLoading(true)
    const cert = certificados.find(c => c.id === cobroParaCert)
    const nextNum = (cert?.cobros_proyecto?.length ?? 0) + 1
    const supabase = createClient()
    const { error: err } = await supabase.from('cobros_proyecto').insert({
      obra_id: obraId,
      constructora_id: constructoraId,
      contrato_obra_id: contrato.id,
      certificado_id: cobroParaCert,
      numero: nextNum,
      fecha_vencimiento: cobroForm.fecha_vencimiento,
      fecha: cobroForm.fecha_vencimiento,
      monto: parseFloat(cobroForm.monto),
      moneda: cobroForm.moneda,
      notas: cobroForm.notas.trim() || null,
      estado: 'pendiente',
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setCobroForm({ ...EMPTY_COBRO, moneda: contrato.moneda })
    setCobroParaCert(null)
    refresh()
  }

  function handleDeleteCobro(cobro: CobroProyecto) {
    setConfirmModal({
      title: 'Eliminar cobro',
      message: `¿Eliminar este cobro de ${formatCurrency(cobro.monto, cobro.moneda)}?`,
      confirmLabel: 'Eliminar',
      danger: true,
      onConfirm: async () => {
        const supabase = createClient()
        await supabase.from('cobros_proyecto').delete().eq('id', cobro.id)
        setConfirmModal(null)
        refresh()
      },
    })
  }

  async function handleRegistrarCobroSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!pagoCobroTarget) return
    setLoading(true)
    const supabase = createClient()
    const { error: err } = await supabase.from('cobros_proyecto').update({
      estado: 'cobrado',
      fecha_pago: registrarPagoForm.fecha_pago,
      cuenta_propia_id: registrarPagoForm.cuenta_propia_id || null,
    }).eq('id', pagoCobroTarget.id)
    setLoading(false)
    if (err) { setError(err.message); return }
    setPagoCobroTarget(null)
    setRegistrarPagoForm(EMPTY_REGISTRAR_PAGO)
    refresh()
  }

  // ── Pagos a proveedor (contrato subcontratista) ──────────────

  async function handlePagoSubcSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!pagoParaCert || !contrato.proveedor_id) return
    setError(null)
    setLoading(true)
    const cert = certificados.find(c => c.id === pagoParaCert)
    const supabase = createClient()
    const { error: err } = await supabase.from('gastos').insert({
      constructora_id: constructoraId,
      obra_id: obraId,
      proveedor_id: contrato.proveedor_id,
      certificado_id: pagoParaCert,
      descripcion: pagoSubcForm.descripcion.trim() || `Certificado N°${cert?.numero ?? ''} — ${cert?.periodo ?? ''}`,
      monto: parseFloat(pagoSubcForm.monto),
      moneda: pagoSubcForm.moneda,
      fecha_vencimiento: pagoSubcForm.fecha_vencimiento,
      estado: 'Pendiente',
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setPagoSubcForm({ ...EMPTY_PAGO_SUBC, moneda: contrato.moneda })
    setPagoParaCert(null)
    refresh()
  }

  function handleDeleteGasto(gasto: Gasto) {
    setConfirmModal({
      title: 'Eliminar pago',
      message: `¿Eliminar este pago de ${formatCurrency(gasto.monto, gasto.moneda)}?`,
      confirmLabel: 'Eliminar',
      danger: true,
      onConfirm: async () => {
        const supabase = createClient()
        await supabase.from('gastos').delete().eq('id', gasto.id)
        setConfirmModal(null)
        refresh()
      },
    })
  }

  async function handleRegistrarPagoSubcSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!pagarGastoTarget) return
    setLoading(true)
    const supabase = createClient()
    const { error: err } = await supabase.from('gastos').update({
      estado: 'Pagado',
      fecha_pago: registrarPagoForm.fecha_pago,
      cuenta_propia_id: registrarPagoForm.cuenta_propia_id || null,
    }).eq('id', pagarGastoTarget.id)
    setLoading(false)
    if (err) { setError(err.message); return }
    setPagarGastoTarget(null)
    setRegistrarPagoForm(EMPTY_REGISTRAR_PAGO)
    refresh()
  }

  // ── Helpers UI ────────────────────────────────────────────────

  const today = new Date().toISOString().split('T')[0]
  const totalCertificado = certificados.reduce((s, c) => s + c.monto_certificado, 0)
  const porcentajeCertificado = contrato.monto_total > 0
    ? Math.min(100, Math.round((totalCertificado / contrato.monto_total) * 100))
    : 0

  function movVencido(fechaVenc: string | null, estado: string, estadoPendiente: string) {
    return estado === estadoPendiente && !!fechaVenc && fechaVenc < today
  }

  const nombreParte = esCliente ? (contrato.compradores?.nombre_completo ?? 'Cliente') : (contrato.proveedores?.razon_social ?? 'Subcontratista')

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      {/* ── Encabezado del contrato ── */}
      <div className="p-5 border-b border-slate-100">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-semibold',
                esCliente ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700')}>
                {esCliente ? 'Contrato con el cliente' : 'Subcontratista'}
              </span>
              <span className={cn('text-xs px-2 py-0.5 rounded font-medium capitalize',
                contrato.estado === 'vigente' ? 'bg-emerald-100 text-emerald-700' :
                contrato.estado === 'terminado' ? 'bg-slate-100 text-slate-500' : 'bg-red-100 text-red-700'
              )}>{contrato.estado}</span>
            </div>
            <p className="text-lg font-bold text-slate-900">{nombreParte}</p>
            <div className="flex items-center gap-3 mt-1 text-sm text-slate-500 flex-wrap">
              <span>{formatCurrency(contrato.monto_total, contrato.moneda)}</span>
              {contrato.fecha_inicio && <span>Inicio: {formatDate(contrato.fecha_inicio)}</span>}
              {contrato.fecha_fin_estimada && <span>Fin est.: {formatDate(contrato.fecha_fin_estimada)}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            {esCliente && (
              <button
                onClick={() => window.open(`/print/contrato/${contrato.id}`, '_blank')}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                Imprimir contrato
              </button>
            )}
            <div className="text-right">
              <p className="text-xs text-slate-400 mb-1">Certificado</p>
              <p className="text-2xl font-bold text-slate-900">{porcentajeCertificado}%</p>
              <p className="text-xs text-slate-500">{formatCurrency(totalCertificado, contrato.moneda)} de {formatCurrency(contrato.monto_total, contrato.moneda)}</p>
            </div>
          </div>
        </div>
        {contrato.monto_total > 0 && (
          <div className="mt-4 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full transition-all', esCliente ? 'bg-indigo-500' : 'bg-amber-500')} style={{ width: `${porcentajeCertificado}%` }} />
          </div>
        )}

        {usaItems && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Ítems contratados</p>
            <div className="divide-y divide-slate-100">
              {contratoObraItems.map(item => {
                const acumulado = avanceAcumuladoPrevio[item.id] ?? 0
                return (
                  <div key={item.id} className="py-2 grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
                    <span className="text-slate-700 truncate min-w-0">
                      {item.rubro}
                      {item.origen === 'adicional' && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 align-middle">Adicional</span>}
                    </span>
                    <span className="text-xs text-slate-400 text-right w-24 shrink-0">{acumulado}% certificado</span>
                    <span className="font-medium text-slate-900 text-right w-28 shrink-0">{formatCurrency(item.monto_contratado, contrato.moneda)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Certificados ── */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">Certificados de avance</h3>
          <p className="text-xs text-slate-400 mt-0.5">{certificados.length} certificado{certificados.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {!readOnly && usaItems && (
            <button onClick={() => { setShowAdicionalForm(true); setAdicionalFilas([nuevaFilaItem()]); setError(null) }}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium rounded-lg transition-colors">
              + Adicional
            </button>
          )}
          {!readOnly && (
            <button onClick={abrirNuevoCert}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Nuevo certificado
            </button>
          )}
        </div>
      </div>

      {certificados.length === 0 ? (
        <div className="px-5 py-12 text-center text-slate-400">
          <p className="text-sm">Sin certificados todavía.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {certificados.map(cert => {
            const estadoInfo = ESTADO_CERT[cert.estado]
            const cobros = cert.cobros_proyecto ?? []
            const pagos = cert.pagos ?? []
            const cobradoTotal = cobros.filter(c => c.estado === 'cobrado').reduce((s, c) => s + c.monto, 0)
            const pagadoTotal = pagos.filter(p => p.estado === 'Pagado').reduce((s, p) => s + p.monto, 0)
            const hayVencidosCobro = cobros.some(c => movVencido(c.fecha_vencimiento, c.estado, 'pendiente'))
            const hayVencidosPago = pagos.some(p => movVencido(p.fecha_vencimiento, p.estado, 'Pendiente'))
            const isExpanded = expanded === cert.id

            return (
              <div key={cert.id}>
                <div
                  className={cn('px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors', isExpanded && 'bg-slate-50')}
                  onClick={() => setExpanded(isExpanded ? null : cert.id)}
                >
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-indigo-600">#{cert.numero}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-900">{cert.periodo}</p>
                      <span className={cn('text-xs px-2 py-0.5 rounded font-medium', estadoInfo.color)}>{estadoInfo.label}</span>
                      {(hayVencidosCobro || hayVencidosPago) && (
                        <span className="text-xs px-2 py-0.5 rounded font-medium bg-red-100 text-red-700">
                          {esCliente ? 'Cobro vencido' : 'Pago vencido'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                      <span>{cert.porcentaje_avance}% avance</span>
                      <span>Certificado: {formatCurrency(cert.monto_certificado, contrato.moneda)}</span>
                      {esCliente && cobros.length > 0 && (
                        <span>{cobros.length} cobro{cobros.length !== 1 ? 's' : ''} · {formatCurrency(cobradoTotal, contrato.moneda)} cobrado</span>
                      )}
                      {!esCliente && pagos.length > 0 && (
                        <span>{pagos.length} pago{pagos.length !== 1 ? 's' : ''} · {formatCurrency(pagadoTotal, contrato.moneda)} pagado</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                    {!readOnly && estadoInfo.next && (
                      <button onClick={() => avanzarEstado(cert)}
                        className="text-xs px-2.5 py-1.5 border border-indigo-200 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                        {estadoInfo.nextLabel}
                      </button>
                    )}
                    {esCliente && (
                      <button
                        onClick={() => window.open(`/print/certificado/${cert.id}`, '_blank')}
                        title="Imprimir certificado"
                        className="text-slate-400 hover:text-slate-600 px-1 transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                      </button>
                    )}
                    {!readOnly && (
                      <button onClick={() => handleDeleteCert(cert)}
                        className="text-xs text-red-400 hover:text-red-600 px-1 transition-colors">✕</button>
                    )}
                    <svg className={cn('w-4 h-4 text-slate-400 transition-transform', isExpanded && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {isExpanded && (
                  <div className="bg-slate-50 border-t border-slate-100 px-5 py-4 space-y-3">
                    {cert.descripcion_avances && <p className="text-xs text-slate-500 italic">{cert.descripcion_avances}</p>}

                    {(cert.certificado_items?.length ?? 0) > 0 && (
                      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                        {cert.certificado_items!.map(ci => {
                          const item = contratoObraItems.find(i => i.id === ci.contrato_obra_item_id)
                          return (
                            <div key={ci.id} className="px-4 py-2 grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
                              <span className="text-slate-700 truncate min-w-0">{item?.rubro ?? 'Ítem'}</span>
                              <span className="text-xs text-slate-400 text-right w-20 shrink-0">{ci.pct_avance_acumulado}% acum.</span>
                              <span className="font-medium text-slate-900 text-right w-28 shrink-0">{formatCurrency(ci.monto_certificado, contrato.moneda)}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {esCliente ? (
                      <div className="space-y-2">
                        {cobros.map(cobro => {
                          const vencido = movVencido(cobro.fecha_vencimiento, cobro.estado, 'pendiente')
                          return (
                            <div key={cobro.id} className={cn('bg-white border rounded-xl px-4 py-3 flex items-center gap-3', vencido ? 'border-red-200' : 'border-slate-200')}>
                              <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0',
                                cobro.estado === 'cobrado' ? 'bg-emerald-100 text-emerald-700' : vencido ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700')}>
                                {cobro.numero ?? '—'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-slate-900">{formatCurrency(cobro.monto, cobro.moneda)}</p>
                                  <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium',
                                    cobro.estado === 'cobrado' ? 'bg-emerald-100 text-emerald-700' : vencido ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700')}>
                                    {cobro.estado === 'cobrado' ? 'Cobrado' : vencido ? 'Vencido' : 'Pendiente'}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-400 mt-0.5">
                                  {cobro.estado === 'cobrado' && cobro.fecha_pago ? `Pagado el ${formatDate(cobro.fecha_pago)}` : cobro.fecha_vencimiento ? `Vence: ${formatDate(cobro.fecha_vencimiento)}` : ''}
                                  {cobro.notas ? ` · ${cobro.notas}` : ''}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {!readOnly && cobro.estado === 'pendiente' && (
                                  <button onClick={() => { setPagoCobroTarget(cobro); setRegistrarPagoForm({ ...EMPTY_REGISTRAR_PAGO }) }}
                                    className="text-xs px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors">
                                    Registrar pago
                                  </button>
                                )}
                                {cobro.estado === 'cobrado' && (
                                  <button onClick={() => window.open(`/print/cobro/${cobro.id}`, '_blank')} title="Imprimir recibo"
                                    className="text-slate-400 hover:text-slate-600 px-1 transition-colors">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                    </svg>
                                  </button>
                                )}
                                {!readOnly && (
                                  <button onClick={() => handleDeleteCobro(cobro)} className="text-xs text-red-400 hover:text-red-600 px-1 transition-colors">✕</button>
                                )}
                              </div>
                            </div>
                          )
                        })}

                        <div className="flex items-center justify-between pt-1">
                          <div className="flex gap-4 text-xs">
                            {cobros.some(c => c.estado === 'pendiente') && (
                              <span className="text-amber-700">Pendiente: {formatCurrency(cobros.filter(c => c.estado === 'pendiente').reduce((s, c) => s + c.monto, 0), cobros[0]?.moneda ?? contrato.moneda)}</span>
                            )}
                            {cobradoTotal > 0 && <span className="text-emerald-700">Cobrado: {formatCurrency(cobradoTotal, cobros[0]?.moneda ?? contrato.moneda)}</span>}
                          </div>
                          {!readOnly && (
                            <button onClick={() => { setCobroParaCert(cert.id); setCobroForm({ ...EMPTY_COBRO, moneda: contrato.moneda }); setError(null) }}
                              className="text-xs px-3 py-1.5 border border-indigo-200 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                              + Agregar cobro
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {pagos.map(pago => {
                          const vencido = movVencido(pago.fecha_vencimiento, pago.estado, 'Pendiente')
                          return (
                            <div key={pago.id} className={cn('bg-white border rounded-xl px-4 py-3 flex items-center gap-3', vencido ? 'border-red-200' : 'border-slate-200')}>
                              <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
                                pago.estado === 'Pagado' ? 'bg-emerald-100' : vencido ? 'bg-red-100' : 'bg-amber-100')}>
                                <svg className={cn('w-3.5 h-3.5', pago.estado === 'Pagado' ? 'text-emerald-700' : vencido ? 'text-red-600' : 'text-amber-700')}
                                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                                </svg>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-slate-900">{formatCurrency(pago.monto, pago.moneda)}</p>
                                  <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium',
                                    pago.estado === 'Pagado' ? 'bg-emerald-100 text-emerald-700' : vencido ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700')}>
                                    {pago.estado === 'Pagado' ? 'Pagado' : vencido ? 'Vencido' : 'Pendiente'}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-400 mt-0.5 truncate">
                                  {pago.descripcion}
                                  {pago.estado === 'Pagado' && pago.fecha_pago ? ` · Pagado el ${formatDate(pago.fecha_pago)}` : pago.fecha_vencimiento ? ` · Vence: ${formatDate(pago.fecha_vencimiento)}` : ''}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {!readOnly && pago.estado === 'Pendiente' && (
                                  <button onClick={() => { setPagarGastoTarget(pago); setRegistrarPagoForm({ ...EMPTY_REGISTRAR_PAGO }) }}
                                    className="text-xs px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors">
                                    Registrar pago
                                  </button>
                                )}
                                {!readOnly && (
                                  <button onClick={() => handleDeleteGasto(pago)} className="text-xs text-red-400 hover:text-red-600 px-1 transition-colors">✕</button>
                                )}
                              </div>
                            </div>
                          )
                        })}

                        <div className="flex items-center justify-between pt-1">
                          <div className="flex gap-4 text-xs">
                            {pagos.some(p => p.estado === 'Pendiente') && (
                              <span className="text-amber-700">Pendiente: {formatCurrency(pagos.filter(p => p.estado === 'Pendiente').reduce((s, p) => s + p.monto, 0), pagos[0]?.moneda ?? contrato.moneda)}</span>
                            )}
                            {pagadoTotal > 0 && <span className="text-emerald-700">Pagado: {formatCurrency(pagadoTotal, pagos[0]?.moneda ?? contrato.moneda)}</span>}
                          </div>
                          {!readOnly && (
                            <button onClick={() => { setPagoParaCert(cert.id); setPagoSubcForm({ ...EMPTY_PAGO_SUBC, moneda: contrato.moneda }); setError(null) }}
                              className="text-xs px-3 py-1.5 border border-amber-200 text-amber-700 hover:bg-amber-50 rounded-lg transition-colors">
                              + Agregar pago
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── MODAL: Nuevo certificado ── */}
      {showCertForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className={cn('bg-white rounded-2xl shadow-2xl w-full', usaItems ? 'max-w-lg' : 'max-w-md')} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Nuevo certificado</h2>
              <button onClick={() => setShowCertForm(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleCertSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Período *</label>
                <input required value={certForm.periodo}
                  onChange={e => setCertForm(f => ({ ...f, periodo: e.target.value }))}
                  placeholder="Ej: Enero 2025, Mes 3, Etapa 1..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              {usaItems ? (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-600">Avance acumulado por ítem *</label>
                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {contratoObraItems.map(item => {
                      const previo = avanceAcumuladoPrevio[item.id] ?? 0
                      return (
                        <div key={item.id} className="px-3 py-2.5 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm text-slate-800 truncate">
                              {item.rubro}
                              {item.origen === 'adicional' && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 align-middle">Adicional</span>}
                            </span>
                            <span className="text-xs text-slate-400 shrink-0">{formatCurrency(item.monto_contratado, contrato.moneda)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-slate-400 shrink-0">Previo: {previo}%</span>
                            <input type="number" min={previo} max="100" step="0.01"
                              value={itemPcts[item.id] ?? String(previo)}
                              onChange={e => setItemPcts(p => ({ ...p, [item.id]: e.target.value }))}
                              className="w-20 px-2 py-1 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                            <span className="text-xs text-slate-400">% acum.</span>
                            <span className="ml-auto text-xs font-medium text-slate-700">{formatCurrency(totalCertificarEsteItem(item), contrato.moneda)}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-sm font-semibold text-slate-900 text-right">Total a certificar: {formatCurrency(totalCertificarNuevo, contrato.moneda)}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">% Avance *</label>
                    <input required type="number" min="0" max="100" step="0.01" value={certForm.porcentaje_avance}
                      onChange={e => setCertForm(f => ({ ...f, porcentaje_avance: e.target.value }))}
                      placeholder="Ej: 25"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Monto a certificar *</label>
                    <input required type="number" min="0" step="0.01" value={certForm.monto_certificado}
                      onChange={e => setCertForm(f => ({ ...f, monto_certificado: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Descripción de los avances</label>
                <textarea rows={3} value={certForm.descripcion_avances}
                  onChange={e => setCertForm(f => ({ ...f, descripcion_avances: e.target.value }))}
                  placeholder="Detalle de los trabajos ejecutados en el período..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowCertForm(false)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button type="submit" disabled={loading || (usaItems && totalCertificarNuevo <= 0)}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Guardando...' : 'Crear certificado'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: Adicional de obra ── */}
      {showAdicionalForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Adicional de obra</h2>
                <p className="text-xs text-slate-400 mt-0.5">Trabajo extra no incluido en el contrato original</p>
              </div>
              <button onClick={() => setShowAdicionalForm(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleAdicionalSubmit} className="p-6 space-y-4">
              <ItemsRubroTable filas={adicionalFilas} onChange={setAdicionalFilas} moneda={contrato.moneda} titulo="Ítems adicionales" rubros={rubros} />
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowAdicionalForm(false)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Guardando...' : 'Agregar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: Nuevo cobro ── */}
      {cobroParaCert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Agregar cobro</h2>
              <button onClick={() => setCobroParaCert(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleCobroSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Monto *</label>
                  <input required type="number" min="0" step="0.01" value={cobroForm.monto}
                    onChange={e => setCobroForm(f => ({ ...f, monto: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Moneda *</label>
                  <select value={cobroForm.moneda} onChange={e => setCobroForm(f => ({ ...f, moneda: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="ARS">ARS — Pesos</option>
                    <option value="USD">USD — Dólares</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de vencimiento *</label>
                <input required type="date" value={cobroForm.fecha_vencimiento}
                  onChange={e => setCobroForm(f => ({ ...f, fecha_vencimiento: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notas</label>
                <input value={cobroForm.notas} onChange={e => setCobroForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Ej: 50% del certificado, cuota 1/2..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setCobroParaCert(null)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Guardando...' : 'Agregar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: Nuevo pago a proveedor ── */}
      {pagoParaCert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Agregar pago</h2>
              <button onClick={() => setPagoParaCert(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handlePagoSubcSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Descripción</label>
                <input value={pagoSubcForm.descripcion} onChange={e => setPagoSubcForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Se completa solo si lo dejás vacío"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Monto *</label>
                  <input required type="number" min="0" step="0.01" value={pagoSubcForm.monto}
                    onChange={e => setPagoSubcForm(f => ({ ...f, monto: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Moneda *</label>
                  <select value={pagoSubcForm.moneda} onChange={e => setPagoSubcForm(f => ({ ...f, moneda: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="ARS">ARS — Pesos</option>
                    <option value="USD">USD — Dólares</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de vencimiento *</label>
                <input required type="date" value={pagoSubcForm.fecha_vencimiento}
                  onChange={e => setPagoSubcForm(f => ({ ...f, fecha_vencimiento: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setPagoParaCert(null)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Guardando...' : 'Agregar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: Registrar pago (cobro o gasto) ── */}
      {(pagoCobroTarget || pagarGastoTarget) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Registrar pago</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {formatCurrency((pagoCobroTarget ?? pagarGastoTarget)!.monto, (pagoCobroTarget ?? pagarGastoTarget)!.moneda)}
                </p>
              </div>
              <button onClick={() => { setPagoCobroTarget(null); setPagarGastoTarget(null) }} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={pagoCobroTarget ? handleRegistrarCobroSubmit : handleRegistrarPagoSubcSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de pago *</label>
                <input required type="date" value={registrarPagoForm.fecha_pago}
                  onChange={e => setRegistrarPagoForm(f => ({ ...f, fecha_pago: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {cuentasPropias.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{pagoCobroTarget ? 'Acreditado en' : 'Pagado desde'}</label>
                  <select value={registrarPagoForm.cuenta_propia_id}
                    onChange={e => setRegistrarPagoForm(f => ({ ...f, cuenta_propia_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">— Sin cuenta asignada —</option>
                    {cuentasPropias.map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.moneda})</option>)}
                  </select>
                </div>
              )}
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setPagoCobroTarget(null); setPagarGastoTarget(null) }}
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
