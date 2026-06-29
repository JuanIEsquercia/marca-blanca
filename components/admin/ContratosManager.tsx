'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency, formatDate, ESTADO_COLORS } from '@/lib/utils'
import SaleForm from './SaleForm'
import ConfirmModal from './ConfirmModal'
import type { Unidad, Tipologia, Comprador, Cuota, CuentaPropia } from '@/types/database'

type UnidadConTipologia = Unidad & { tipologias: Tipologia }

type ContratoRow = {
  id: string
  unidad_id: string
  precio_final: number
  entrega_efectiva: number
  cantidad_cuotas: number
  fecha_firma: string
  notas: string | null
  compradores: Comprador | null
  unidades: (Unidad & { tipologias: { nombre: string } }) | null
  cuotas: Cuota[]
  pagadas: number
  vencidas: number
}

interface Props {
  contratos: ContratoRow[]
  unidadesDisponibles: UnidadConTipologia[]
  cuentasPropias: CuentaPropia[]
}

interface DeleteTarget {
  contratoId: string
  compradorNombre: string
  unidadId: string
}

interface EditState {
  contratoId: string
  precioFinal: string
  entregaEfectiva: string
  fechaFirma: string
  notas: string
}

export default function ContratosManager({ contratos, unidadesDisponibles, cuentasPropias }: Props) {
  const router = useRouter()
  const today = new Date().toISOString().split('T')[0]
  const [, startTransition] = useTransition()

  // Lista
  const [showUnitPicker, setShowUnitPicker] = useState(false)
  const [unidadSeleccionada, setUnidadSeleccionada] = useState<UnidadConTipologia | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')

  // Panel cuotas
  const [cuotaPanel, setCuotaPanel] = useState<ContratoRow | null>(null)

  // Modal pago
  const [pagoModal, setPagoModal] = useState<{ cuotaId: string; monto: number } | null>(null)
  const [pagoCuenta, setPagoCuenta] = useState('')
  const [pagoFecha, setPagoFecha] = useState(today)
  const [pagoMonto, setPagoMonto] = useState('')
  const [loadingPago, setLoadingPago] = useState(false)

  const rows = contratos.map((c) => {
    const cuotas = c.cuotas ?? []
    const pagadas = cuotas.filter((q) => q.estado_pago === 'Pagado').length
    const vencidas = cuotas.filter(
      (q) => q.estado_pago === 'Pendiente' && q.fecha_vencimiento < today
    ).length
    return { ...c, cuotas, pagadas, vencidas }
  })

  const rowsFiltrados = busqueda
    ? rows.filter(c => {
        const q = busqueda.toLowerCase()
        return (
          c.compradores?.nombre_completo.toLowerCase().includes(q) ||
          c.compradores?.dni_cuit.toLowerCase().includes(q)
        )
      })
    : rows

  const totalIngresos = rows.reduce((acc, c) => acc + Number(c.precio_final), 0)
  const totalVencidas = rows.reduce((acc, c) => acc + c.vencidas, 0)

  function refresh() { startTransition(() => router.refresh()) }

  function openCuotaPanel(c: ContratoRow) {
    // Usar la versión enriquecida de rows (con pagadas/vencidas calculados)
    const enriched = rows.find(r => r.id === c.id) ?? c
    setCuotaPanel(enriched)
    setPagoModal(null)
  }

  // Sincronizar panel con datos frescos tras refresh
  function refreshAndSyncPanel(contratoId: string) {
    startTransition(() => {
      router.refresh()
    })
    // El panel se actualiza en el próximo render porque rows se recalcula
    setCuotaPanel(prev => {
      if (!prev || prev.id !== contratoId) return prev
      return null // cerrar y dejar que el usuario lo reabra, o mantener abierto
    })
  }

  function abrirPago(cuotaId: string, monto: number) {
    setPagoModal({ cuotaId, monto })
    setPagoCuenta('')
    setPagoFecha(today)
    setPagoMonto(String(monto))
  }

  async function confirmarPago() {
    if (!pagoModal || !cuotaPanel) return
    setLoadingPago(true)
    const supabase = createClient()
    await supabase
      .from('cuotas')
      .update({
        estado_pago: 'Pagado',
        fecha_pago: pagoFecha,
        monto_cobrado: parseFloat(pagoMonto) || pagoModal.monto,
        cuenta_propia_id: pagoCuenta || null,
      })
      .eq('id', pagoModal.cuotaId)
    setLoadingPago(false)
    setPagoModal(null)
    refreshAndSyncPanel(cuotaPanel.id)
    setCuotaPanel(null)
  }

  function imprimirRecibo(cuota: Cuota) {
    if (!cuotaPanel) return
    const comp = cuotaPanel.compradores!
    const unidad = cuotaPanel.unidades!
    const totalCuotas = cuotaPanel.cuotas.length
    const fmt = (n: number) =>
      new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
    const fmtDate = (s: string) =>
      new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Recibo Cuota ${cuota.numero_cuota}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; color: #1e293b; padding: 48px; max-width: 640px; margin: auto; }
    h1 { font-size: 22px; font-weight: bold; margin-bottom: 4px; }
    .subtitle { color: #64748b; font-size: 13px; margin-bottom: 32px; }
    .section { margin-bottom: 24px; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
    .label { color: #64748b; }
    .value { font-weight: 600; }
    .highlight { background: #f1f5f9; border-radius: 10px; padding: 20px 24px; margin: 24px 0; }
    .monto-label { font-size: 12px; color: #64748b; margin-bottom: 4px; }
    .monto { font-size: 32px; font-weight: bold; color: #0f172a; }
    .footer { margin-top: 48px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 16px; }
  </style>
</head>
<body>
  <h1>Recibo de Pago</h1>
  <p class="subtitle">Cuota ${cuota.numero_cuota} de ${totalCuotas}</p>
  <div class="section">
    <div class="row"><span class="label">Comprador</span><span class="value">${comp.nombre_completo}</span></div>
    <div class="row"><span class="label">DNI / CUIT</span><span class="value">${comp.dni_cuit}</span></div>
    <div class="row"><span class="label">Unidad</span><span class="value">P${unidad.piso} · ${unidad.numero}${unidad.letra ?? ''} · ${unidad.tipologias.nombre}</span></div>
    <div class="row"><span class="label">Precio total del contrato</span><span class="value">${fmt(cuotaPanel.precio_final)}</span></div>
  </div>
  <div class="highlight">
    <div class="monto-label">Monto cobrado</div>
    <div class="monto">${fmt(Number(cuota.monto_cobrado ?? cuota.monto_base))}</div>
  </div>
  <div class="section">
    <div class="row"><span class="label">Monto base de cuota</span><span class="value">${fmt(cuota.monto_base)}</span></div>
    <div class="row"><span class="label">Fecha de vencimiento</span><span class="value">${fmtDate(cuota.fecha_vencimiento)}</span></div>
    <div class="row"><span class="label">Fecha de pago</span><span class="value">${fmtDate(cuota.fecha_pago!)}</span></div>
  </div>
  <div class="footer">Recibo Nº ${cuota.id.slice(0, 8).toUpperCase()} · Emitido el ${fmtDate(new Date().toISOString())}</div>
</body>
</html>`
    const w = window.open('', '_blank', 'width=720,height=960')
    if (!w) return
    w.document.write(html)
    w.document.close()
    setTimeout(() => { w.print() }, 300)
  }

  function imprimirEstadoCuenta() {
    if (!cuotaPanel) return
    const comp = cuotaPanel.compradores!
    const unidad = cuotaPanel.unidades!
    const cuotasOrdenadas = [...cuotaPanel.cuotas].sort((a, b) => a.numero_cuota - b.numero_cuota)
    const fmt = (n: number) =>
      new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
    const fmtDate = (s: string) =>
      new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })

    const saldoFinanciado = cuotaPanel.precio_final - cuotaPanel.entrega_efectiva
    const cuotasPagadasCount = cuotasOrdenadas.filter(c => c.estado_pago === 'Pagado').length
    const cuotasPendientesCount = cuotasOrdenadas.filter(c => c.estado_pago === 'Pendiente').length
    const totalCuotasPagado = cuotasOrdenadas
      .filter(c => c.estado_pago === 'Pagado')
      .reduce((acc, c) => acc + Number(c.monto_cobrado ?? c.monto_base), 0)
    const totalPendiente = cuotasOrdenadas
      .filter(c => c.estado_pago === 'Pendiente')
      .reduce((acc, c) => acc + Number(c.monto_base), 0)
    const totalAbonado = cuotaPanel.entrega_efectiva + totalCuotasPagado
    const pctAbonado = Math.round((totalAbonado / cuotaPanel.precio_final) * 100)
    const montoCuotaAprox = cuotasOrdenadas.length > 0
      ? Math.round(saldoFinanciado / cuotasOrdenadas.length)
      : 0

    const filas = cuotasOrdenadas.map(c => {
      const esVencida = c.estado_pago === 'Pendiente' && c.fecha_vencimiento < today
      const estadoLabel = esVencida ? 'Vencida' : c.estado_pago
      const estadoColor = c.estado_pago === 'Pagado' ? '#16a34a' : esVencida ? '#dc2626' : '#ea580c'
      const rowBg = c.estado_pago === 'Pagado' ? '' : esVencida ? '#fff5f5' : ''
      return `<tr style="background:${rowBg};">
        <td style="padding:8px 10px;text-align:center;font-weight:700;color:#475569;">${c.numero_cuota}</td>
        <td style="padding:8px 10px;${esVencida ? 'color:#dc2626;font-weight:600;' : 'color:#475569;'}">${fmtDate(c.fecha_vencimiento)}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:600;color:#0f172a;">${fmt(c.monto_base)}</td>
        <td style="padding:8px 10px;text-align:center;"><span style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;color:${estadoColor};background:${c.estado_pago === 'Pagado' ? '#f0fdf4' : esVencida ? '#fef2f2' : '#fff7ed'};">${estadoLabel}</span></td>
        <td style="padding:8px 10px;text-align:right;color:#475569;">${c.monto_cobrado ? fmt(Number(c.monto_cobrado)) : '—'}</td>
        <td style="padding:8px 10px;color:#475569;">${c.fecha_pago ? fmtDate(c.fecha_pago) : '—'}</td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Estado de Cuenta — ${comp.nombre_completo}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;background:white;font-size:12px;line-height:1.5}
    .header{background:#1e293b;color:white;padding:28px 40px}
    .header-inner{display:flex;justify-content:space-between;align-items:flex-start}
    .doc-title{font-size:24px;font-weight:800;letter-spacing:-0.02em}
    .doc-tagline{font-size:12px;opacity:0.55;margin-top:4px}
    .doc-meta{text-align:right}
    .meta-block{margin-bottom:8px}
    .meta-label{font-size:9px;opacity:0.5;text-transform:uppercase;letter-spacing:0.1em}
    .meta-value{font-size:13px;font-weight:700;margin-top:1px}
    .content{padding:32px 40px}
    .two-col{display:flex;gap:40px;margin-bottom:28px;padding-bottom:28px;border-bottom:1px solid #e2e8f0}
    .col{flex:1}
    .section-heading{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#94a3b8;margin-bottom:10px}
    .field{margin-bottom:8px}
    .field-label{font-size:10px;color:#94a3b8}
    .field-value{font-size:13px;font-weight:700;color:#0f172a;margin-top:1px}
    .finance-box{border:1.5px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px}
    .finance-box-header{background:#f8fafc;padding:10px 18px;border-bottom:1px solid #e2e8f0;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#64748b}
    .finance-body{padding:16px 18px}
    .finance-row{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0}
    .finance-row-label{font-size:12px;color:#475569}
    .finance-row-sub{font-size:10px;color:#94a3b8;margin-top:1px}
    .finance-row-value{font-size:14px;font-weight:700}
    .finance-divider{height:1px;background:#e2e8f0;margin:4px 0}
    .finance-total-row{display:flex;justify-content:space-between;align-items:baseline;padding:10px 0 4px;border-top:2px solid #0f172a;margin-top:4px}
    .finance-total-label{font-size:12px;font-weight:700;color:#0f172a}
    .finance-total-value{font-size:18px;font-weight:800;color:#0f172a}
    .cards{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:28px}
    .card{border-radius:10px;padding:14px 16px;border:1.5px solid #e2e8f0}
    .card-label{font-size:10px;font-weight:600;margin-bottom:4px}
    .card-value{font-size:20px;font-weight:800}
    .card-sub{font-size:10px;margin-top:3px}
    .card-paid{background:#f0fdf4;border-color:#bbf7d0}
    .card-paid .card-label,.card-paid .card-value{color:#15803d}
    .card-paid .card-sub{color:#86efac}
    .card-pend{background:#fff7ed;border-color:#fed7aa}
    .card-pend .card-label,.card-pend .card-value{color:#c2410c}
    .card-pend .card-sub{color:#fdba74}
    .card-pct .card-label{color:#475569}
    .card-pct .card-value{color:#0f172a}
    .card-pct .card-sub{color:#94a3b8}
    .progress-bar-bg{height:6px;background:#f1f5f9;border-radius:99px;margin-top:8px;overflow:hidden}
    .progress-bar-fill{height:100%;background:#22c55e;border-radius:99px}
    table{width:100%;border-collapse:collapse}
    thead tr{background:#f8fafc}
    th{padding:9px 10px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;border-bottom:1.5px solid #e2e8f0}
    td{padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:11px}
    .footer{margin-top:36px;display:flex;justify-content:space-between;align-items:flex-end;padding-top:16px;border-top:1px solid #e2e8f0}
    .footer-ref{font-size:10px;color:#94a3b8;line-height:1.6}
    .signature{text-align:center}
    .signature-line{width:180px;border-top:1px solid #cbd5e1;padding-top:6px;font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style>
</head>
<body>
  <div class="header">
    <div class="header-inner">
      <div>
        <div class="doc-title">Estado de Cuenta</div>
        <div class="doc-tagline">Plan de cuotas y posición de pagos</div>
      </div>
      <div class="doc-meta">
        <div class="meta-block"><div class="meta-label">Nº de contrato</div><div class="meta-value">${cuotaPanel.id.slice(0, 8).toUpperCase()}</div></div>
        <div class="meta-block"><div class="meta-label">Fecha de emisión</div><div class="meta-value">${fmtDate(new Date().toISOString())}</div></div>
      </div>
    </div>
  </div>
  <div class="content">
    <div class="two-col">
      <div class="col">
        <div class="section-heading">Comprador</div>
        <div class="field"><div class="field-label">Nombre completo</div><div class="field-value">${comp.nombre_completo}</div></div>
        <div class="field"><div class="field-label">DNI / CUIT</div><div class="field-value">${comp.dni_cuit}</div></div>
      </div>
      <div class="col">
        <div class="section-heading">Unidad</div>
        <div class="field"><div class="field-label">Identificación</div><div class="field-value">Piso ${unidad.piso} · Unidad ${unidad.numero}${unidad.letra ?? ''}</div></div>
        <div class="field"><div class="field-label">Tipología</div><div class="field-value">${unidad.tipologias.nombre}</div></div>
        <div class="field"><div class="field-label">Fecha de firma</div><div class="field-value">${fmtDate(cuotaPanel.fecha_firma)}</div></div>
      </div>
    </div>
    <div class="finance-box">
      <div class="finance-box-header">Estructura financiera del contrato</div>
      <div class="finance-body">
        <div class="finance-row"><div><div class="finance-row-label">Precio total</div></div><div class="finance-row-value" style="color:#0f172a;">${fmt(cuotaPanel.precio_final)}</div></div>
        <div class="finance-divider"></div>
        <div class="finance-row"><div><div class="finance-row-label">Entrega efectiva</div><div class="finance-row-sub">Pagada al momento de la firma · ${fmtDate(cuotaPanel.fecha_firma)}</div></div><div class="finance-row-value" style="color:#15803d;">— ${fmt(cuotaPanel.entrega_efectiva)}</div></div>
        <div class="finance-total-row"><div class="finance-total-label">Saldo financiado en ${cuotasOrdenadas.length} cuotas</div><div class="finance-total-value">${fmt(saldoFinanciado)}</div></div>
        <div style="font-size:10px;color:#94a3b8;margin-top:4px;">Valor de referencia por cuota: ${fmt(montoCuotaAprox)}</div>
      </div>
    </div>
    <div class="cards">
      <div class="card card-paid">
        <div class="card-label">Total abonado</div>
        <div class="card-value">${fmt(totalAbonado)}</div>
        <div class="card-sub">Entrega + ${cuotasPagadasCount} cuota${cuotasPagadasCount !== 1 ? 's' : ''} pagada${cuotasPagadasCount !== 1 ? 's' : ''}</div>
        <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pctAbonado}%;"></div></div>
      </div>
      <div class="card card-pend">
        <div class="card-label">Saldo pendiente</div>
        <div class="card-value">${fmt(totalPendiente)}</div>
        <div class="card-sub">${cuotasPendientesCount} cuota${cuotasPendientesCount !== 1 ? 's' : ''} por cobrar</div>
      </div>
      <div class="card card-pct">
        <div class="card-label">Porcentaje abonado</div>
        <div class="card-value">${pctAbonado}%</div>
        <div class="card-sub">del precio total del contrato</div>
      </div>
    </div>
    <div class="section-heading" style="margin-bottom:10px;">Detalle de cuotas</div>
    <table>
      <thead>
        <tr>
          <th style="text-align:center;width:44px;">Nº</th>
          <th>Vencimiento</th>
          <th style="text-align:right;">Monto base</th>
          <th style="text-align:center;">Estado</th>
          <th style="text-align:right;">Cobrado</th>
          <th>Fecha de pago</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
    <div class="footer">
      <div class="footer-ref"><div>Contrato Nº ${cuotaPanel.id.slice(0, 8).toUpperCase()}</div><div>Emitido el ${fmtDate(new Date().toISOString())}</div></div>
      <div class="signature"><div class="signature-line">Firma y aclaración</div></div>
    </div>
  </div>
</body>
</html>`
    const w = window.open('', '_blank', 'width=900,height=1100')
    if (!w) return
    w.document.write(html)
    w.document.close()
    setTimeout(() => { w.print() }, 300)
  }

  function openEdit(c: ContratoRow) {
    setEditState({
      contratoId: c.id,
      precioFinal: String(c.precio_final),
      entregaEfectiva: String(c.entrega_efectiva),
      fechaFirma: c.fecha_firma,
      notas: c.notas ?? '',
    })
    setEditError(null)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editState) return
    setEditLoading(true)
    setEditError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('contratos_venta')
      .update({
        precio_final: parseFloat(editState.precioFinal),
        entrega_efectiva: parseFloat(editState.entregaEfectiva),
        fecha_firma: editState.fechaFirma,
        notas: editState.notas || null,
      })
      .eq('id', editState.contratoId)
    setEditLoading(false)
    if (error) { setEditError(error.message); return }
    setEditState(null)
    refresh()
  }

  async function handleDelete() {
    if (!deleteTarget) return
    const supabase = createClient()
    await supabase.from('cuotas').delete().eq('contrato_id', deleteTarget.contratoId)
    await supabase.from('contratos_venta').delete().eq('id', deleteTarget.contratoId)
    await supabase.from('unidades').update({ estado_comercial: 'Disponible' }).eq('id', deleteTarget.unidadId)
    setDeleteTarget(null)
    refresh()
  }

  function handleVentaSuccess() {
    setUnidadSeleccionada(null)
    refresh()
  }

  const saldoEdicion = editState
    ? Math.max(0, parseFloat(editState.precioFinal || '0') - parseFloat(editState.entregaEfectiva || '0'))
    : 0

  // Cuotas del panel activo
  const cuotasPanel = cuotaPanel
    ? [...cuotaPanel.cuotas].sort((a, b) => a.numero_cuota - b.numero_cuota)
    : []
  const cuotasPagadas = cuotasPanel.filter(c => c.estado_pago === 'Pagado').length
  const cuotasPendientes = cuotasPanel.filter(c => c.estado_pago === 'Pendiente').length
  const cuotasVencidas = cuotasPanel.filter(c => c.estado_pago === 'Pendiente' && c.fecha_vencimiento < today).length

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Ventas</h1>
          <p className="text-slate-500 text-sm mt-1">Todos los contratos de venta del desarrollo</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar por nombre o DNI..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              className="pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64 bg-white"
            />
          </div>
          <button
            onClick={() => setShowUnitPicker(true)}
            disabled={unidadesDisponibles.length === 0}
            title={unidadesDisponibles.length === 0 ? 'No hay unidades disponibles' : undefined}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500
                       disabled:opacity-40 disabled:cursor-not-allowed
                       text-white rounded-xl text-sm font-semibold transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nueva venta
          </button>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 mb-1">Ventas registradas</p>
          <p className="text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 mb-1">Ingresos totales</p>
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(totalIngresos)}</p>
        </div>
        <div className={`border rounded-xl p-4 ${totalVencidas > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
          <p className={`text-xs font-medium mb-1 ${totalVencidas > 0 ? 'text-red-600' : 'text-slate-500'}`}>
            Cuotas vencidas sin cobrar
          </p>
          <p className={`text-2xl font-bold ${totalVencidas > 0 ? 'text-red-700' : 'text-slate-900'}`}>
            {totalVencidas}
          </p>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Comprador</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Unidad</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">Precio final</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">Entrega</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Cuotas</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Firma</th>
                <th className="px-4 py-3 w-44" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rowsFiltrados.map((c) => {
                const unidad = c.unidades
                const comprador = c.compradores
                return (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{comprador?.nombre_completo}</p>
                      <p className="text-xs text-slate-400 font-mono">{comprador?.dni_cuit}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {unidad ? `P${unidad.piso} - ${unidad.numero}${unidad.letra ?? ''}` : '—'}
                      <p className="text-xs text-slate-400">{unidad?.tipologias?.nombre}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {formatCurrency(c.precio_final)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {formatCurrency(c.entrega_efectiva)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-xs text-slate-500">{c.pagadas}/{c.cuotas.length} pagadas</span>
                        {c.vencidas > 0 && (
                          <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
                            {c.vencidas} vencida{c.vencidas > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(c.fecha_firma)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openCuotaPanel(c)}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors px-2 py-1"
                        >
                          Ver cuotas →
                        </button>
                        <button
                          onClick={() => openEdit(c)}
                          title="Editar"
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setDeleteTarget({
                            contratoId: c.id,
                            compradorNombre: comprador?.nombre_completo ?? '',
                            unidadId: c.unidad_id,
                          })}
                          title="Eliminar"
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {rowsFiltrados.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              {busqueda ? (
                <p className="text-sm">Sin resultados para &quot;{busqueda}&quot;</p>
              ) : (
                <>
                  <p className="text-sm">No hay ventas registradas aún.</p>
                  <button
                    onClick={() => setShowUnitPicker(true)}
                    disabled={unidadesDisponibles.length === 0}
                    className="mt-2 text-xs text-indigo-500 hover:text-indigo-700 disabled:opacity-40"
                  >
                    {unidadesDisponibles.length > 0 ? 'Registrar primera venta →' : 'No hay unidades disponibles'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Panel de cuotas ──────────────────────────────────── */}
      {cuotaPanel && (
        <div className="fixed inset-0 z-40 flex items-stretch">
          {/* Overlay */}
          <div className="flex-1 bg-black/40" onClick={() => setCuotaPanel(null)} />
          {/* Panel */}
          <div className="w-full max-w-2xl bg-slate-50 flex flex-col shadow-2xl overflow-hidden">
            {/* Panel header */}
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-start justify-between shrink-0">
              <div>
                <p className="font-bold text-slate-900 text-lg">
                  {cuotaPanel.compradores?.nombre_completo}
                </p>
                <p className="text-slate-500 text-sm mt-0.5">
                  DNI/CUIT: {cuotaPanel.compradores?.dni_cuit} ·{' '}
                  P{cuotaPanel.unidades?.piso} - {cuotaPanel.unidades?.numero}{cuotaPanel.unidades?.letra ?? ''} ·{' '}
                  Precio: {formatCurrency(cuotaPanel.precio_final)}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4 shrink-0">
                <button
                  onClick={imprimirEstadoCuenta}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600
                             border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Estado de cuenta
                </button>
                <button
                  onClick={() => setCuotaPanel(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="px-6 py-3 bg-white border-b border-slate-100 flex gap-6 shrink-0">
              <div className="text-center">
                <p className="text-xl font-bold text-slate-900">{cuotasPanel.length}</p>
                <p className="text-xs text-slate-500">Total</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-green-600">{cuotasPagadas}</p>
                <p className="text-xs text-slate-500">Pagadas</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-orange-500">{cuotasPendientes}</p>
                <p className="text-xs text-slate-500">Pendientes</p>
              </div>
              {cuotasVencidas > 0 && (
                <div className="text-center">
                  <p className="text-xl font-bold text-red-600">{cuotasVencidas}</p>
                  <p className="text-xs text-red-500">Vencidas</p>
                </div>
              )}
            </div>

            {/* Tabla cuotas */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-center px-3 py-2.5 font-semibold text-slate-600 w-12">Nº</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-slate-600">Monto</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-600">Vencimiento</th>
                      <th className="text-center px-3 py-2.5 font-semibold text-slate-600">Estado</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-slate-600">Cobrado</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-600">Pago</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cuotasPanel.map(cuota => {
                      const esVencida = cuota.estado_pago === 'Pendiente' && cuota.fecha_vencimiento < today
                      return (
                        <tr key={cuota.id}
                          className={cn('hover:bg-slate-50 transition-colors', esVencida && 'bg-red-50/40')}>
                          <td className="px-3 py-2.5 text-center text-slate-500 text-xs">{cuota.numero_cuota}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-slate-900">
                            {formatCurrency(cuota.monto_base)}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={cn('text-xs', esVencida ? 'text-red-600 font-semibold' : 'text-slate-600')}>
                              {formatDate(cuota.fecha_vencimiento)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={cn(
                              'inline-block text-xs font-medium px-2 py-0.5 rounded-full border',
                              ESTADO_COLORS[cuota.estado_pago]
                            )}>
                              {esVencida ? 'Vencida' : cuota.estado_pago}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-500 text-xs">
                            {cuota.monto_cobrado ? formatCurrency(cuota.monto_cobrado) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-slate-500 text-xs">
                            {cuota.fecha_pago ? formatDate(cuota.fecha_pago) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {cuota.estado_pago === 'Pagado' ? (
                              <button
                                onClick={() => imprimirRecibo(cuota)}
                                className="text-xs text-slate-400 hover:text-slate-700 transition-colors"
                              >
                                Recibo
                              </button>
                            ) : (
                              <button
                                onClick={() => abrirPago(cuota.id, cuota.monto_base)}
                                className={cn(
                                  'text-xs font-medium transition-colors',
                                  esVencida
                                    ? 'text-red-600 hover:text-red-800'
                                    : 'text-indigo-600 hover:text-indigo-800'
                                )}
                              >
                                Cobrar
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal pago de cuota ──────────────────────────────── */}
      {pagoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="p-6 border-b border-slate-200">
              <h2 className="font-bold text-slate-900">Registrar cobro de cuota</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Monto base: <strong>{formatCurrency(pagoModal.monto)}</strong>
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Monto cobrado *</label>
                <input
                  type="number" min="0" step="0.01" value={pagoMonto}
                  onChange={e => setPagoMonto(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">Modificá si se cobró un monto diferente al base</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Cuenta donde se recibió</label>
                <select
                  value={pagoCuenta}
                  onChange={e => setPagoCuenta(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Sin asignar</option>
                  {cuentasPropias.filter(c => c.activa).map(c => (
                    <option key={c.id} value={c.id}>{c.nombre} ({c.moneda})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de cobro *</label>
                <input type="date" value={pagoFecha}
                  onChange={e => setPagoFecha(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setPagoModal(null)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                  Cancelar
                </button>
                <button onClick={confirmarPago}
                  disabled={loadingPago || !pagoMonto}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
                             text-white rounded-lg text-sm font-semibold">
                  {loadingPago ? 'Guardando...' : 'Confirmar cobro'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: selector de unidad ────────────────────────── */}
      {showUnitPicker && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="font-bold text-slate-900">Nueva venta</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {unidadesDisponibles.length} unidad{unidadesDisponibles.length !== 1 ? 'es' : ''} disponible{unidadesDisponibles.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button onClick={() => setShowUnitPicker(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 overflow-y-auto grid grid-cols-2 gap-3">
              {unidadesDisponibles.map(u => (
                <button
                  key={u.id}
                  onClick={() => { setShowUnitPicker(false); setUnidadSeleccionada(u) }}
                  className="text-left p-4 border border-slate-200 rounded-xl
                             hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                >
                  <p className="font-semibold text-slate-900">P{u.piso} · {u.numero}{u.letra ?? ''}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{u.tipologias.nombre}</p>
                  <p className="text-sm font-medium text-indigo-600 mt-2">{formatCurrency(u.precio_lista)}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: editar venta ──────────────────────────────── */}
      {editState && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="font-bold text-slate-900">Editar venta</h2>
              <button onClick={() => setEditState(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleEdit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Precio final (USD) *</label>
                  <input
                    required type="number" min="0" step="0.01"
                    value={editState.precioFinal}
                    onChange={e => setEditState(s => s && { ...s, precioFinal: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Entrega efectiva (USD) *</label>
                  <input
                    required type="number" min="0" step="0.01"
                    value={editState.entregaEfectiva}
                    onChange={e => setEditState(s => s && { ...s, entregaEfectiva: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de firma *</label>
                  <input
                    required type="date"
                    value={editState.fechaFirma}
                    onChange={e => setEditState(s => s && { ...s, fechaFirma: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="bg-slate-50 rounded-lg p-3 flex flex-col justify-center">
                  <p className="text-xs text-slate-500">Saldo financiado</p>
                  <p className="font-bold text-slate-900 mt-0.5">{formatCurrency(saldoEdicion)}</p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notas</label>
                <textarea
                  rows={2}
                  value={editState.notas}
                  onChange={e => setEditState(s => s && { ...s, notas: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
              <p className="text-[11px] text-slate-400">
                Los cambios de precio no actualizan retroactivamente el plan de cuotas existente.
              </p>
              {editError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {editError}
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  type="button" onClick={() => setEditState(null)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-xl text-sm font-medium
                             text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit" disabled={editLoading}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
                             text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  {editLoading ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SaleForm */}
      {unidadSeleccionada && (
        <SaleForm
          unidad={unidadSeleccionada}
          onClose={() => setUnidadSeleccionada(null)}
          onSuccess={handleVentaSuccess}
        />
      )}

      {/* Confirmar eliminación */}
      {deleteTarget && (
        <ConfirmModal
          title="Eliminar venta"
          message={`¿Eliminar la venta de ${deleteTarget.compradorNombre}? Se borrarán todas las cuotas asociadas y la unidad volverá a estar disponible.`}
          confirmLabel="Eliminar venta"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
