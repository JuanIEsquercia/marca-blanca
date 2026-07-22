'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency, formatDate, redondear2 } from '@/lib/utils'
import ConfirmModal from './ConfirmModal'
import ClienteYFechasForm, { EMPTY_DATOS_GENERALES, type DatosGenerales } from './ClienteYFechasForm'
import ItemsRubroTable, { nuevaFilaItem, subtotalFilaItem, totalFilasItem, type FilaItem } from './ItemsRubroTable'
import type { ContratoObra, CertificadoAvance, CobroProyecto, CuentaPropia, EstadoCertificado, ContratoObraItem, CertificadoItem } from '@/types/database'

type ConfirmState = { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> }

type CertificadoConCobros = CertificadoAvance & { cobros_proyecto: CobroProyecto[]; certificado_items?: CertificadoItem[] }

interface Props {
  contrato: ContratoObra | null
  certificados: CertificadoConCobros[]
  contratoObraItems?: ContratoObraItem[]
  cuentasPropias: CuentaPropia[]
  constructoraId: string
  obraId: string
  readOnly?: boolean
}

const ESTADO_CERT: Record<EstadoCertificado, { label: string; color: string; next: EstadoCertificado | null; nextLabel: string | null }> = {
  borrador:   { label: 'Borrador',   color: 'bg-slate-100 text-slate-600',   next: 'presentado', nextLabel: 'Marcar como presentado' },
  presentado: { label: 'Presentado', color: 'bg-amber-100 text-amber-700',   next: 'aprobado',   nextLabel: 'Marcar como aprobado' },
  aprobado:   { label: 'Aprobado',   color: 'bg-emerald-100 text-emerald-700', next: null,       nextLabel: null },
}

const EMPTY_CERT = { periodo: '', porcentaje_avance: '', monto_certificado: '', descripcion_avances: '', notas: '' }
const EMPTY_COBRO = { numero: '', fecha_vencimiento: '', monto: '', moneda: 'ARS', notas: '' }
const EMPTY_PAGO = { fecha_pago: new Date().toISOString().split('T')[0], cuenta_propia_id: '' }
const EMPTY_ADICIONAL = { rubro: '', monto: '' }

export default function CertificadosManager({ contrato: contratoInicial, certificados, contratoObraItems = [], cuentasPropias, constructoraId, obraId, readOnly = false }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [confirmModal, setConfirmModal] = useState<ConfirmState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Contrato
  const [contrato, setContrato] = useState<ContratoObra | null>(contratoInicial)
  const [showContratoForm, setShowContratoForm] = useState(!contratoInicial)

  // contratoInicial llega fresco del servidor en cada refresh() (ej. al
  // agregar un adicional, que cambia monto_total vía trigger) — sin esto,
  // `contrato` quedaba congelado con el valor del primer render, porque
  // useState solo usa su argumento inicial una vez. Se ajusta durante el
  // render (patrón recomendado por React para este caso) en vez de un
  // useEffect, que dispararía un render extra en cascada.
  const [contratoPrevio, setContratoPrevio] = useState(contratoInicial)
  if (contratoInicial !== contratoPrevio) {
    setContratoPrevio(contratoInicial)
    setContrato(contratoInicial)
  }
  const [contratoForm, setContratoForm] = useState<DatosGenerales>(EMPTY_DATOS_GENERALES)
  const [contratoFilas, setContratoFilas] = useState<FilaItem[]>([nuevaFilaItem()])
  const totalContratoFilas = totalFilasItem(contratoFilas)

  // Certificados
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showCertForm, setShowCertForm] = useState(false)
  const [certForm, setCertForm] = useState(EMPTY_CERT)
  const [itemPcts, setItemPcts] = useState<Record<string, string>>({})
  const [showAdicionalForm, setShowAdicionalForm] = useState(false)
  const [adicionalForm, setAdicionalForm] = useState(EMPTY_ADICIONAL)

  // El contrato certifica por ítem (presupuesto aceptado) apenas tiene algún
  // contrato_obra_items — si no tiene ninguno, sigue el flujo viejo de %
  // global tipeado a mano, sin tocar nada de ese comportamiento.
  const usaItems = contratoObraItems.length > 0

  // Avance acumulado ya certificado de cada ítem, a la fecha (el máximo entre
  // todos los certificados existentes) — es el punto de partida para el
  // próximo certificado, nunca puede bajar.
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
    for (const item of contratoObraItems) {
      iniciales[item.id] = String(avanceAcumuladoPrevio[item.id] ?? 0)
    }
    setItemPcts(iniciales)
    setError(null)
  }

  const totalCertificarEsteItem = (item: ContratoObraItem) => {
    const nuevoPct = parseFloat(itemPcts[item.id] ?? '0') || 0
    const previoPct = avanceAcumuladoPrevio[item.id] ?? 0
    return redondear2(((nuevoPct - previoPct) / 100) * item.monto_contratado)
  }
  const totalCertificarNuevo = contratoObraItems.reduce((s, item) => s + totalCertificarEsteItem(item), 0)

  // Cobros
  const [cobroParaCert, setCobroParaCert] = useState<string | null>(null)
  const [cobroForm, setCobroForm] = useState({ ...EMPTY_COBRO, moneda: contratoInicial?.moneda ?? 'ARS' })

  // Pago
  const [pagoTarget, setPagoTarget] = useState<CobroProyecto | null>(null)
  const [pagoForm, setPagoForm] = useState(EMPTY_PAGO)

  function refresh() { startTransition(() => router.refresh()) }

  // ── Contrato ─────────────────────────────────────────────────

  async function handleContratoSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createClient()

    // Buscar o crear cliente (misma entidad `compradores` que usa el flujo
    // DESARROLLO — mismo patrón de dedupe por CUIT que SaleForm/ReservaForm).
    const cuit = contratoForm.cliente_cuit.trim() || null
    let clienteId: string | null = null
    if (cuit) {
      const { data: existente } = await supabase
        .from('compradores')
        .select('id')
        .eq('constructora_id', constructoraId)
        .eq('dni_cuit', cuit)
        .maybeSingle()
      clienteId = existente?.id ?? null
    }
    if (!clienteId) {
      const { data: nuevoCliente, error: errCliente } = await supabase
        .from('compradores')
        .insert({
          constructora_id: constructoraId,
          nombre_completo: contratoForm.cliente_nombre.trim(),
          dni_cuit: cuit,
          email: contratoForm.cliente_email.trim() || null,
          telefono: contratoForm.cliente_telefono.trim() || null,
        })
        .select('id')
        .single()
      if (errCliente || !nuevoCliente) {
        setLoading(false)
        setError(errCliente?.message ?? 'Error al crear el cliente')
        return
      }
      clienteId = nuevoCliente.id
    }

    // monto_total arranca en 0 — lo fija solo el trigger
    // recalcular_monto_total_contrato apenas se insertan los ítems abajo,
    // nunca se tipea a mano (mismo criterio que un contrato originado en
    // un presupuesto aceptado).
    const { data, error: err } = await supabase
      .from('contratos_obra')
      .insert({
        obra_id: obraId,
        constructora_id: constructoraId,
        cliente_id:     clienteId,
        monto_total:    0,
        moneda:         contratoForm.moneda,
        fecha_inicio:   contratoForm.fecha_inicio || null,
        fecha_fin_estimada: contratoForm.fecha_fin_estimada || null,
        descripcion:    contratoForm.descripcion.trim() || null,
      })
      .select('*, compradores(*)')
      .single()
    if (err || !data) { setLoading(false); setError(err?.message ?? 'Error al crear el contrato'); return }

    const filasValidas = contratoFilas.filter(f => f.rubro.trim() && f.precio_unitario)
    if (filasValidas.length > 0) {
      const { error: errItems } = await supabase.from('contrato_obra_items').insert(
        filasValidas.map((f, i) => ({
          contrato_obra_id: data.id,
          constructora_id: constructoraId,
          orden: i,
          rubro: f.rubro.trim(),
          monto_contratado: subtotalFilaItem(f),
          origen: 'directo',
        }))
      )
      if (errItems) {
        // Compensar: no dejar un contrato sin ítems (monto_total=0) colgado.
        await supabase.from('contratos_obra').delete().eq('id', data.id)
        setLoading(false)
        setError(errItems.message)
        return
      }
    }

    setLoading(false)
    // Optimista: el trigger ya dejó monto_total correcto en la base, pero
    // `data` se leyó antes de insertar los ítems — se corrige acá mismo
    // para no mostrar "0" hasta que llegue el refresh().
    setContrato({ ...(data as ContratoObra), monto_total: totalContratoFilas })
    setShowContratoForm(false)
    refresh()
  }

  // ── Avance de estado del certificado ─────────────────────────

  async function avanzarEstado(cert: CertificadoConCobros) {
    const next = ESTADO_CERT[cert.estado].next
    if (!next) return
    const supabase = createClient()
    const updates: Record<string, string> = { estado: next }
    if (next === 'presentado') updates.fecha_presentacion = new Date().toISOString().split('T')[0]
    if (next === 'aprobado')   updates.fecha_aprobacion   = new Date().toISOString().split('T')[0]
    await supabase.from('certificados_avance').update(updates).eq('id', cert.id)
    refresh()
  }

  // ── Nuevo certificado ─────────────────────────────────────────

  async function handleCertSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!contrato) return
    setError(null)
    setLoading(true)
    const supabase = createClient()

    if (usaItems) {
      // Modo por ítem: el certificado se crea en 0/0 y el trigger
      // recalcular_monto_certificado lo completa solo apenas se insertan los
      // certificado_items (una sola sentencia INSERT con todas las filas —
      // si el trigger de validación rechaza un ítem, la sentencia entera se
      // revierte y no queda ningún certificado_item huérfano).
      const { data: nuevoCert, error: errCert } = await supabase
        .from('certificados_avance')
        .insert({
          contrato_obra_id:    contrato.id,
          obra_id:             obraId,
          constructora_id:     constructoraId,
          periodo:             certForm.periodo.trim(),
          porcentaje_avance:   0,
          monto_certificado:   0,
          descripcion_avances: certForm.descripcion_avances.trim() || null,
          notas:               certForm.notas.trim() || null,
          estado:              'borrador',
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
        // Compensar: no dejar un certificado vacío colgado si los ítems fallaron.
        await supabase.from('certificados_avance').delete().eq('id', nuevoCert.id)
        setError(errItems.message)
        return
      }
    } else {
      const nextNum = (certificados.length > 0 ? Math.max(...certificados.map(c => c.numero)) : 0) + 1
      const { error: err } = await supabase
        .from('certificados_avance')
        .insert({
          contrato_obra_id:    contrato.id,
          obra_id:             obraId,
          constructora_id:     constructoraId,
          numero:              nextNum,
          periodo:             certForm.periodo.trim(),
          porcentaje_avance:   parseFloat(certForm.porcentaje_avance),
          monto_certificado:   parseFloat(certForm.monto_certificado),
          descripcion_avances: certForm.descripcion_avances.trim() || null,
          notas:               certForm.notas.trim() || null,
          estado:              'borrador',
        })
      setLoading(false)
      if (err) { setError(err.message); return }
    }

    setCertForm(EMPTY_CERT)
    setShowCertForm(false)
    refresh()
  }

  async function handleAdicionalSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!contrato || !adicionalForm.rubro.trim() || !adicionalForm.monto) return
    setError(null)
    setLoading(true)
    const supabase = createClient()
    const { error: err } = await supabase.from('contrato_obra_items').insert({
      contrato_obra_id: contrato.id,
      constructora_id: constructoraId,
      orden: contratoObraItems.length,
      rubro: adicionalForm.rubro.trim(),
      monto_contratado: redondear2(parseFloat(adicionalForm.monto)),
      origen: 'adicional',
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setAdicionalForm(EMPTY_ADICIONAL)
    setShowAdicionalForm(false)
    refresh()
  }

  function handleDeleteCert(cert: CertificadoConCobros) {
    setConfirmModal({
      title: 'Eliminar certificado',
      message: `¿Eliminar certificado N°${cert.numero} "${cert.periodo}"? Se eliminarán también sus cobros.`,
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

  // ── Nuevo cobro ───────────────────────────────────────────────

  async function handleCobroSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!cobroParaCert) return
    setError(null)
    setLoading(true)
    const cert = certificados.find(c => c.id === cobroParaCert)
    const nextNum = (cert?.cobros_proyecto?.length ?? 0) + 1
    const supabase = createClient()
    const { error: err } = await supabase
      .from('cobros_proyecto')
      .insert({
        obra_id:          obraId,
        constructora_id:  constructoraId,
        certificado_id:    cobroParaCert,
        numero:            nextNum,
        fecha_vencimiento: cobroForm.fecha_vencimiento,
        fecha:             cobroForm.fecha_vencimiento, // campo legacy
        monto:             parseFloat(cobroForm.monto),
        moneda:            cobroForm.moneda,
        notas:             cobroForm.notas.trim() || null,
        estado:            'pendiente',
      })
    setLoading(false)
    if (err) { setError(err.message); return }
    setCobroForm({ ...EMPTY_COBRO, moneda: contrato?.moneda ?? 'ARS' })
    setCobroParaCert(null)
    refresh()
  }

  function handleDeleteCobro(cobro: CobroProyecto) {
    setConfirmModal({
      title: 'Eliminar cobro',
      message: `¿Eliminar este cobro de ${formatCurrency(cobro.monto)}?`,
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

  // ── Registrar pago ────────────────────────────────────────────

  async function handlePagoSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!pagoTarget) return
    setLoading(true)
    const supabase = createClient()
    const { error: err } = await supabase
      .from('cobros_proyecto')
      .update({
        estado:          'cobrado',
        fecha_pago:      pagoForm.fecha_pago,
        cuenta_propia_id: pagoForm.cuenta_propia_id || null,
      })
      .eq('id', pagoTarget.id)
    setLoading(false)
    if (err) { setError(err.message); return }
    setPagoTarget(null)
    setPagoForm(EMPTY_PAGO)
    refresh()
  }

  // ── Helpers UI ────────────────────────────────────────────────

  const today = new Date().toISOString().split('T')[0]
  const totalCertificado = certificados.reduce((s, c) => s + c.monto_certificado, 0)
  const porcentajeCertificado = contrato && contrato.monto_total > 0
    ? Math.min(100, Math.round((totalCertificado / contrato.monto_total) * 100))
    : 0

  function cobroEsVencido(cobro: CobroProyecto) {
    return cobro.estado === 'pendiente' && cobro.fecha_vencimiento && cobro.fecha_vencimiento < today
  }

  // ── Render ────────────────────────────────────────────────────

  // ── Step indicator ───────────────────────────────────────────
  const paso1Done = !!contrato
  const paso2Done = certificados.length > 0
  const paso3Done = certificados.some(c => c.cobros_proyecto?.length > 0)

  return (
    <div className="space-y-6">

      {/* ── PASOS ── */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { n: 1, label: 'Contrato', done: paso1Done, active: !paso1Done },
          { n: 2, label: 'Certificados', done: paso2Done, active: paso1Done && !paso2Done },
          { n: 3, label: 'Cobros', done: paso3Done, active: paso1Done && paso2Done && !paso3Done },
        ].map((paso, i) => (
          <div key={paso.n} className="flex items-center gap-2">
            {i > 0 && <div className={cn('w-8 h-px', paso.done || paso.active ? 'bg-indigo-300' : 'bg-slate-200')} />}
            <div className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold',
              paso.done ? 'bg-emerald-100 text-emerald-700' :
              paso.active ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-400'
            )}>
              <span className={cn(
                'w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold',
                paso.done ? 'bg-emerald-500 text-white' :
                paso.active ? 'bg-indigo-500 text-white' : 'bg-slate-300 text-white'
              )}>
                {paso.done ? '✓' : paso.n}
              </span>
              {paso.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── CONTRATO ── */}
      {!contrato ? (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-800">Contrato de obra</h2>
              <p className="text-xs text-slate-400 mt-0.5">Cargá el contrato con el cliente para comenzar a emitir certificados</p>
            </div>
          </div>
          <form onSubmit={handleContratoSubmit} className="p-6 space-y-4">
            <ClienteYFechasForm form={contratoForm} onChange={setContratoForm} descripcionLabel="Descripción del objeto del contrato" />

            <ItemsRubroTable filas={contratoFilas} onChange={setContratoFilas} moneda={contratoForm.moneda} titulo="Ítems del contrato" />

            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex justify-end">
              <button type="submit" disabled={loading || totalContratoFilas <= 0}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg disabled:opacity-60">
                {loading ? 'Guardando...' : 'Crear contrato'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Paso 1 — Contrato de obra</p>
              <p className="text-lg font-bold text-slate-900">{contrato.compradores?.nombre_completo}</p>
              <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                <span>{formatCurrency(contrato.monto_total, contrato.moneda)}</span>
                {contrato.fecha_inicio && <span>Inicio: {formatDate(contrato.fecha_inicio)}</span>}
                {contrato.fecha_fin_estimada && <span>Fin est.: {formatDate(contrato.fecha_fin_estimada)}</span>}
                <span className={cn('text-xs px-2 py-0.5 rounded font-medium capitalize',
                  contrato.estado === 'vigente' ? 'bg-emerald-100 text-emerald-700' :
                  contrato.estado === 'terminado' ? 'bg-slate-100 text-slate-500' : 'bg-red-100 text-red-700'
                )}>{contrato.estado}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <button
                onClick={() => window.open(`/print/contrato/${contrato.id}`, '_blank')}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                Imprimir contrato
              </button>
              <div className="text-right">
                <p className="text-xs text-slate-400 mb-1">Certificado</p>
                <p className="text-2xl font-bold text-slate-900">{porcentajeCertificado}%</p>
                <p className="text-xs text-slate-500">{formatCurrency(totalCertificado, contrato.moneda)} de {formatCurrency(contrato.monto_total, contrato.moneda)}</p>
              </div>
            </div>
          </div>
          {contrato.monto_total > 0 && (
            <div className="mt-4 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${porcentajeCertificado}%` }} />
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
      )}

      {/* ── CERTIFICADOS ── */}
      {contrato && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-800">Paso 2 — Certificados de avance</h2>
              <p className="text-xs text-slate-400 mt-0.5">{certificados.length} certificado{certificados.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              {!readOnly && usaItems && (
                <button onClick={() => { setShowAdicionalForm(true); setAdicionalForm(EMPTY_ADICIONAL); setError(null) }}
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
              <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm">Sin certificados todavía.</p>
              <p className="text-xs mt-1">Emití el primer certificado de avance cuando tengas trabajo ejecutado.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {certificados.map(cert => {
                const estadoInfo = ESTADO_CERT[cert.estado]
                const cobros = cert.cobros_proyecto ?? []
                const cobradoTotal = cobros.filter(c => c.estado === 'cobrado').reduce((s, c) => s + c.monto, 0)
                const pendienteTotal = cobros.filter(c => c.estado === 'pendiente').reduce((s, c) => s + c.monto, 0)
                const hayVencidos = cobros.some(c => cobroEsVencido(c))
                const isExpanded = expanded === cert.id

                return (
                  <div key={cert.id}>
                    {/* Fila certificado */}
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
                          {hayVencidos && (
                            <span className="text-xs px-2 py-0.5 rounded font-medium bg-red-100 text-red-700">Cobro vencido</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                          <span>{cert.porcentaje_avance}% avance</span>
                          <span>Certificado: {formatCurrency(cert.monto_certificado, contrato.moneda)}</span>
                          {cobros.length > 0 && (
                            <span>{cobros.length} cobro{cobros.length !== 1 ? 's' : ''} · {formatCurrency(cobradoTotal, contrato.moneda)} cobrado</span>
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
                        <button
                          onClick={() => window.open(`/print/certificado/${cert.id}`, '_blank')}
                          title="Imprimir certificado"
                          className="text-slate-400 hover:text-slate-600 px-1 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                          </svg>
                        </button>
                        {!readOnly && (
                          <button onClick={() => handleDeleteCert(cert)}
                            className="text-xs text-red-400 hover:text-red-600 px-1 transition-colors">✕</button>
                        )}
                        <svg className={cn('w-4 h-4 text-slate-400 transition-transform', isExpanded && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>

                    {/* Cobros expandidos */}
                    {isExpanded && (
                      <div className="bg-slate-50 border-t border-slate-100 px-5 py-4 space-y-3">
                        {cert.descripcion_avances && (
                          <p className="text-xs text-slate-500 italic">{cert.descripcion_avances}</p>
                        )}

                        {/* Desglose por ítem/rubro (solo contratos que certifican por ítem) */}
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

                        {/* Lista de cobros */}
                        <div className="space-y-2">
                          {cobros.map(cobro => {
                            const vencido = cobroEsVencido(cobro)
                            return (
                              <div key={cobro.id}
                                className={cn(
                                  'bg-white border rounded-xl px-4 py-3 flex items-center gap-3',
                                  vencido ? 'border-red-200' : 'border-slate-200'
                                )}>
                                <div className={cn(
                                  'w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0',
                                  cobro.estado === 'cobrado' ? 'bg-emerald-100 text-emerald-700' :
                                  vencido ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
                                )}>
                                  {cobro.numero ?? '—'}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold text-slate-900">{formatCurrency(cobro.monto, cobro.moneda)}</p>
                                    <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium',
                                      cobro.estado === 'cobrado' ? 'bg-emerald-100 text-emerald-700' :
                                      vencido ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
                                    )}>
                                      {cobro.estado === 'cobrado' ? 'Cobrado' : vencido ? 'Vencido' : 'Pendiente'}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-400 mt-0.5">
                                    {cobro.estado === 'cobrado' && cobro.fecha_pago
                                      ? `Pagado el ${formatDate(cobro.fecha_pago)}`
                                      : cobro.fecha_vencimiento
                                        ? `Vence: ${formatDate(cobro.fecha_vencimiento)}`
                                        : ''}
                                    {cobro.notas ? ` · ${cobro.notas}` : ''}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {!readOnly && cobro.estado === 'pendiente' && (
                                    <button
                                      onClick={() => { setPagoTarget(cobro); setPagoForm({ ...EMPTY_PAGO }) }}
                                      className="text-xs px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors">
                                      Registrar pago
                                    </button>
                                  )}
                                  {cobro.estado === 'cobrado' && (
                                    <button
                                      onClick={() => window.open(`/print/cobro/${cobro.id}`, '_blank')}
                                      title="Imprimir recibo"
                                      className="text-slate-400 hover:text-slate-600 px-1 transition-colors">
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                      </svg>
                                    </button>
                                  )}
                                  {!readOnly && (
                                    <button onClick={() => handleDeleteCobro(cobro)}
                                      className="text-xs text-red-400 hover:text-red-600 px-1 transition-colors">✕</button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        {/* Resumen + agregar cobro */}
                        <div className="flex items-center justify-between pt-1">
                          <div className="flex gap-4 text-xs">
                            {pendienteTotal > 0 && <span className="text-amber-700">Pendiente: {formatCurrency(pendienteTotal, cobros[0]?.moneda ?? contrato.moneda)}</span>}
                            {cobradoTotal > 0 && <span className="text-emerald-700">Cobrado: {formatCurrency(cobradoTotal, cobros[0]?.moneda ?? contrato.moneda)}</span>}
                          </div>
                          {!readOnly && (
                            <button
                              onClick={() => { setCobroParaCert(cert.id); setCobroForm({ ...EMPTY_COBRO, moneda: contrato?.moneda ?? 'ARS' }); setError(null) }}
                              className="text-xs px-3 py-1.5 border border-indigo-200 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                              + Agregar cobro
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
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
                            <span className="text-xs text-slate-400 shrink-0">{formatCurrency(item.monto_contratado, contrato?.moneda)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-slate-400 shrink-0">Previo: {previo}%</span>
                            <input type="number" min={previo} max="100" step="0.01"
                              value={itemPcts[item.id] ?? String(previo)}
                              onChange={e => setItemPcts(p => ({ ...p, [item.id]: e.target.value }))}
                              className="w-20 px-2 py-1 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                            <span className="text-xs text-slate-400">% acum.</span>
                            <span className="ml-auto text-xs font-medium text-slate-700">{formatCurrency(totalCertificarEsteItem(item), contrato?.moneda)}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-sm font-semibold text-slate-900 text-right">Total a certificar: {formatCurrency(totalCertificarNuevo, contrato?.moneda)}</p>
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Adicional de obra</h2>
                <p className="text-xs text-slate-400 mt-0.5">Trabajo extra no incluido en el presupuesto original</p>
              </div>
              <button onClick={() => setShowAdicionalForm(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleAdicionalSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Rubro *</label>
                <input required value={adicionalForm.rubro}
                  onChange={e => setAdicionalForm(f => ({ ...f, rubro: e.target.value }))}
                  placeholder="Ej: Refuerzo de fundación extra"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Monto *</label>
                <input required type="number" min="0.01" step="0.01" value={adicionalForm.monto}
                  onChange={e => setAdicionalForm(f => ({ ...f, monto: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
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
                  <select value={cobroForm.moneda}
                    onChange={e => setCobroForm(f => ({ ...f, moneda: e.target.value }))}
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
                <input value={cobroForm.notas}
                  onChange={e => setCobroForm(f => ({ ...f, notas: e.target.value }))}
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

      {/* ── MODAL: Registrar pago ── */}
      {pagoTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Registrar pago</h2>
                <p className="text-sm text-slate-500 mt-0.5">{contrato && formatCurrency(pagoTarget.monto, contrato.moneda)}</p>
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
