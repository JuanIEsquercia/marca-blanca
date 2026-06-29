'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency, formatDate, ESTADO_COLORS } from '@/lib/utils'
import type { Cuota, ContratoVenta, Comprador, Unidad, Tipologia, CuentaPropia } from '@/types/database'

type ContratoConRelaciones = ContratoVenta & {
  compradores: Comprador
  unidades: Unidad & { tipologias: Tipologia }
  cuotas: Cuota[]
}

interface Props {
  contratos: ContratoConRelaciones[]
  cuentasPropias: CuentaPropia[]
  initialContratoId?: string
}

export default function CuentaCorriente({ contratos, cuentasPropias, initialContratoId }: Props) {
  const router = useRouter()
  const today = new Date().toISOString().split('T')[0]

  const [busqueda, setBusqueda] = useState('')
  const [soloVencidas, setSoloVencidas] = useState(false)
  const [contratoSeleccionado, setContratoSeleccionado] = useState<ContratoConRelaciones | null>(
    initialContratoId ? (contratos.find(c => c.id === initialContratoId) ?? null) : null
  )
  const [isPending, startTransition] = useTransition()

  // Modal de pago
  const [pagoModal, setPagoModal] = useState<{ cuotaId: string; monto: number } | null>(null)
  const [pagoCuenta, setPagoCuenta] = useState('')
  const [pagoFecha, setPagoFecha] = useState(new Date().toISOString().split('T')[0])
  const [pagoMonto, setPagoMonto] = useState('')
  const [loadingPago, setLoadingPago] = useState(false)

  // Actualizar selección si llega un initialContratoId después del render
  useEffect(() => {
    if (initialContratoId && !contratoSeleccionado) {
      const c = contratos.find(c => c.id === initialContratoId)
      if (c) setContratoSeleccionado(c)
    }
  }, [initialContratoId, contratos, contratoSeleccionado])

  const contratosFiltrados = contratos.filter(c => {
    const matchBusqueda =
      c.compradores.nombre_completo.toLowerCase().includes(busqueda.toLowerCase()) ||
      c.compradores.dni_cuit.includes(busqueda)

    if (!matchBusqueda) return false

    if (soloVencidas) {
      const tieneVencidas = c.cuotas.some(
        q => q.estado_pago === 'Pendiente' && q.fecha_vencimiento < today
      )
      return tieneVencidas
    }

    return true
  })

  function abrirPago(cuotaId: string, monto: number) {
    setPagoModal({ cuotaId, monto })
    setPagoCuenta('')
    setPagoFecha(new Date().toISOString().split('T')[0])
    setPagoMonto(String(monto))
  }

  function imprimirRecibo(cuota: Cuota) {
    const contrato = contratoSeleccionado!
    const comp = contrato.compradores
    const unidad = contrato.unidades
    const fmt = (n: number) =>
      new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
    const fmtDate = (s: string) =>
      new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const totalCuotas = [...cuotasSelected].sort((a, b) => a.numero_cuota - b.numero_cuota).length

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
    <div class="row"><span class="label">Precio total del contrato</span><span class="value">${fmt(contrato.precio_final)}</span></div>
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

  <div class="footer">
    Recibo Nº ${cuota.id.slice(0, 8).toUpperCase()} · Emitido el ${fmtDate(new Date().toISOString())}
  </div>
</body>
</html>`

    const w = window.open('', '_blank', 'width=720,height=960')
    if (!w) return
    w.document.write(html)
    w.document.close()
    setTimeout(() => { w.print() }, 300)
  }

  function imprimirEstadoCuenta() {
    const contrato = contratoSeleccionado!
    const comp = contrato.compradores
    const unidad = contrato.unidades
    const cuotasOrdenadas = [...cuotasSelected].sort((a, b) => a.numero_cuota - b.numero_cuota)
    const fmt = (n: number) =>
      new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
    const fmtDate = (s: string) =>
      new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })

    const saldoFinanciado = contrato.precio_final - contrato.entrega_efectiva
    const cuotasPagadasCount = cuotasOrdenadas.filter(c => c.estado_pago === 'Pagado').length
    const cuotasPendientesCount = cuotasOrdenadas.filter(c => c.estado_pago === 'Pendiente').length
    const totalCuotasPagado = cuotasOrdenadas
      .filter(c => c.estado_pago === 'Pagado')
      .reduce((acc, c) => acc + Number(c.monto_cobrado ?? c.monto_base), 0)
    const totalPendiente = cuotasOrdenadas
      .filter(c => c.estado_pago === 'Pendiente')
      .reduce((acc, c) => acc + Number(c.monto_base), 0)
    const totalAbonado = contrato.entrega_efectiva + totalCuotasPagado
    const pctAbonado = Math.round((totalAbonado / contrato.precio_final) * 100)
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
        <td style="padding:8px 10px;text-align:center;">
          <span style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${estadoColor};background:${c.estado_pago === 'Pagado' ? '#f0fdf4' : esVencida ? '#fef2f2' : '#fff7ed'};">${estadoLabel}</span>
        </td>
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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; background: white; font-size: 12px; line-height: 1.5; }
    .header { background: #1e293b; color: white; padding: 28px 40px; }
    .header-inner { display: flex; justify-content: space-between; align-items: flex-start; }
    .doc-title { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; }
    .doc-tagline { font-size: 12px; opacity: 0.55; margin-top: 4px; }
    .doc-meta { text-align: right; }
    .meta-block { margin-bottom: 8px; }
    .meta-label { font-size: 9px; opacity: 0.5; text-transform: uppercase; letter-spacing: 0.1em; }
    .meta-value { font-size: 13px; font-weight: 700; margin-top: 1px; }
    .content { padding: 32px 40px; }
    .two-col { display: flex; gap: 40px; margin-bottom: 28px; padding-bottom: 28px; border-bottom: 1px solid #e2e8f0; }
    .col { flex: 1; }
    .section-heading { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: #94a3b8; margin-bottom: 10px; }
    .field { margin-bottom: 8px; }
    .field-label { font-size: 10px; color: #94a3b8; }
    .field-value { font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 1px; }
    .finance-box { border: 1.5px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 24px; }
    .finance-box-header { background: #f8fafc; padding: 10px 18px; border-bottom: 1px solid #e2e8f0; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; }
    .finance-body { padding: 16px 18px; }
    .finance-row { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 0; }
    .finance-row-label { font-size: 12px; color: #475569; }
    .finance-row-sub { font-size: 10px; color: #94a3b8; margin-top: 1px; }
    .finance-row-value { font-size: 14px; font-weight: 700; }
    .finance-divider { height: 1px; background: #e2e8f0; margin: 4px 0; }
    .finance-total-row { display: flex; justify-content: space-between; align-items: baseline; padding: 10px 0 4px; border-top: 2px solid #0f172a; margin-top: 4px; }
    .finance-total-label { font-size: 12px; font-weight: 700; color: #0f172a; }
    .finance-total-value { font-size: 18px; font-weight: 800; color: #0f172a; }
    .cards { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 28px; }
    .card { border-radius: 10px; padding: 14px 16px; border: 1.5px solid #e2e8f0; }
    .card-label { font-size: 10px; font-weight: 600; margin-bottom: 4px; }
    .card-value { font-size: 20px; font-weight: 800; }
    .card-sub { font-size: 10px; margin-top: 3px; }
    .card-paid { background: #f0fdf4; border-color: #bbf7d0; }
    .card-paid .card-label { color: #15803d; }
    .card-paid .card-value { color: #15803d; }
    .card-paid .card-sub { color: #86efac; }
    .card-pend { background: #fff7ed; border-color: #fed7aa; }
    .card-pend .card-label { color: #c2410c; }
    .card-pend .card-value { color: #c2410c; }
    .card-pend .card-sub { color: #fdba74; }
    .card-pct .card-label { color: #475569; }
    .card-pct .card-value { color: #0f172a; }
    .card-pct .card-sub { color: #94a3b8; }
    .progress-bar-bg { height: 6px; background: #f1f5f9; border-radius: 99px; margin-top: 8px; overflow: hidden; }
    .progress-bar-fill { height: 100%; background: #22c55e; border-radius: 99px; }
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: #f8fafc; }
    th { padding: 9px 10px; text-align: left; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; border-bottom: 1.5px solid #e2e8f0; }
    td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; font-size: 11px; }
    .footer { margin-top: 36px; display: flex; justify-content: space-between; align-items: flex-end; padding-top: 16px; border-top: 1px solid #e2e8f0; }
    .footer-ref { font-size: 10px; color: #94a3b8; line-height: 1.6; }
    .signature { text-align: center; }
    .signature-line { width: 180px; border-top: 1px solid #cbd5e1; padding-top: 6px; font-size: 9px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
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
        <div class="meta-block">
          <div class="meta-label">Nº de contrato</div>
          <div class="meta-value">${contrato.id.slice(0, 8).toUpperCase()}</div>
        </div>
        <div class="meta-block">
          <div class="meta-label">Fecha de emisión</div>
          <div class="meta-value">${fmtDate(new Date().toISOString())}</div>
        </div>
      </div>
    </div>
  </div>

  <div class="content">

    <div class="two-col">
      <div class="col">
        <div class="section-heading">Comprador</div>
        <div class="field">
          <div class="field-label">Nombre completo</div>
          <div class="field-value">${comp.nombre_completo}</div>
        </div>
        <div class="field">
          <div class="field-label">DNI / CUIT</div>
          <div class="field-value">${comp.dni_cuit}</div>
        </div>
      </div>
      <div class="col">
        <div class="section-heading">Unidad</div>
        <div class="field">
          <div class="field-label">Identificación</div>
          <div class="field-value">Piso ${unidad.piso} · Unidad ${unidad.numero}${unidad.letra ?? ''}</div>
        </div>
        <div class="field">
          <div class="field-label">Tipología</div>
          <div class="field-value">${unidad.tipologias.nombre}</div>
        </div>
        <div class="field">
          <div class="field-label">Fecha de firma del contrato</div>
          <div class="field-value">${fmtDate(contrato.fecha_firma)}</div>
        </div>
      </div>
    </div>

    <div class="finance-box">
      <div class="finance-box-header">Estructura financiera del contrato</div>
      <div class="finance-body">
        <div class="finance-row">
          <div>
            <div class="finance-row-label">Precio total del contrato</div>
          </div>
          <div class="finance-row-value" style="color:#0f172a;">${fmt(contrato.precio_final)}</div>
        </div>
        <div class="finance-divider"></div>
        <div class="finance-row">
          <div>
            <div class="finance-row-label">Entrega efectiva</div>
            <div class="finance-row-sub">Pagada al momento de la firma · ${fmtDate(contrato.fecha_firma)}</div>
          </div>
          <div class="finance-row-value" style="color:#15803d;">— ${fmt(contrato.entrega_efectiva)}</div>
        </div>
        <div class="finance-total-row">
          <div class="finance-total-label">Saldo financiado en ${cuotasOrdenadas.length} cuotas</div>
          <div class="finance-total-value">${fmt(saldoFinanciado)}</div>
        </div>
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
      <div class="footer-ref">
        <div>Contrato Nº ${contrato.id.slice(0, 8).toUpperCase()}</div>
        <div>Emitido el ${fmtDate(new Date().toISOString())}</div>
      </div>
      <div class="signature">
        <div class="signature-line">Firma y aclaración</div>
      </div>
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

  async function confirmarPago() {
    if (!pagoModal) return
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
    startTransition(() => router.refresh())
  }

  const cuotasSelected = contratoSeleccionado?.cuotas ?? []
  const vencidasSelected = cuotasSelected.filter(c => c.estado_pago === 'Pendiente' && c.fecha_vencimiento < today)
  const pendientes = cuotasSelected.filter(c => c.estado_pago === 'Pendiente').length
  const pagadas = cuotasSelected.filter(c => c.estado_pago === 'Pagado').length
  const vencidas = vencidasSelected.length

  const totalVencidasGlobal = contratos.reduce((acc, c) =>
    acc + c.cuotas.filter(q => q.estado_pago === 'Pendiente' && q.fecha_vencimiento < today).length, 0
  )

  return (
    <>
    <div className="flex gap-6 h-full">
      {/* Panel izquierdo */}
      <div className="w-80 shrink-0 flex flex-col gap-3">
        <input
          type="text"
          placeholder="Buscar por nombre o DNI..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />

        {/* Filtro vencidas */}
        <button
          onClick={() => setSoloVencidas(v => !v)}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors text-left',
            soloVencidas
              ? 'bg-red-50 border-red-300 text-red-700'
              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
          )}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          {soloVencidas ? 'Mostrando con vencidas' : 'Filtrar con cuotas vencidas'}
          {totalVencidasGlobal > 0 && (
            <span className="ml-auto text-xs bg-red-500 text-white px-1.5 py-0.5 rounded-full font-bold">
              {totalVencidasGlobal}
            </span>
          )}
        </button>

        <div className="space-y-2 overflow-y-auto flex-1">
          {contratosFiltrados.map(c => {
            const vencidasC = c.cuotas.filter(q => q.estado_pago === 'Pendiente' && q.fecha_vencimiento < today).length
            return (
              <button
                key={c.id}
                onClick={() => setContratoSeleccionado(c)}
                className={cn(
                  'w-full text-left p-3 rounded-xl border transition-colors',
                  contratoSeleccionado?.id === c.id
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                )}
              >
                <p className="font-medium text-slate-900 text-sm">{c.compradores.nombre_completo}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {c.unidades.piso}° piso · {c.unidades.tipologias.nombre}
                </p>
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  {vencidasC > 0 && (
                    <span className="text-xs font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
                      {vencidasC} vencida{vencidasC > 1 ? 's' : ''}
                    </span>
                  )}
                  <span className="text-xs text-orange-600">
                    {c.cuotas.filter(q => q.estado_pago === 'Pendiente').length} pendientes
                  </span>
                  <span className="text-xs text-slate-400">·</span>
                  <span className="text-xs text-green-600">
                    {c.cuotas.filter(q => q.estado_pago === 'Pagado').length} pagadas
                  </span>
                </div>
              </button>
            )
          })}

          {contratosFiltrados.length === 0 && (
            <p className="text-center text-slate-400 text-sm py-8">No se encontraron resultados.</p>
          )}
        </div>
      </div>

      {/* Panel derecho */}
      <div className="flex-1 overflow-auto">
        {!contratoSeleccionado ? (
          <div className="h-full flex items-center justify-center text-slate-400">
            <div className="text-center">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">Seleccioná un comprador para ver sus cuotas</p>
            </div>
          </div>
        ) : (
          <div>
            {/* Header del comprador */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {contratoSeleccionado.compradores.nombre_completo}
                  </h2>
                  <p className="text-slate-500 text-sm">
                    DNI/CUIT: {contratoSeleccionado.compradores.dni_cuit} ·{' '}
                    Unidad P{contratoSeleccionado.unidades.piso} - {contratoSeleccionado.unidades.numero}
                    {contratoSeleccionado.unidades.letra ?? ''}
                  </p>
                </div>
                <div className="flex items-start gap-3">
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
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Precio final</p>
                    <p className="font-bold text-slate-900">{formatCurrency(contratoSeleccionado.precio_final)}</p>
                  </div>
                </div>
              </div>
              <div className="flex gap-4 mt-3 pt-3 border-t border-slate-100">
                <div className="text-center">
                  <p className="text-xl font-bold text-slate-900">{cuotasSelected.length}</p>
                  <p className="text-xs text-slate-500">Total</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-green-600">{pagadas}</p>
                  <p className="text-xs text-slate-500">Pagadas</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-orange-500">{pendientes}</p>
                  <p className="text-xs text-slate-500">Pendientes</p>
                </div>
                {vencidas > 0 && (
                  <div className="text-center">
                    <p className="text-xl font-bold text-red-600">{vencidas}</p>
                    <p className="text-xs text-red-500">Vencidas</p>
                  </div>
                )}
              </div>
            </div>

            {/* Tabla de cuotas */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-center px-4 py-3 font-semibold text-slate-600 w-16">Nº</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Monto base</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Vencimiento</th>
                    <th className="text-center px-4 py-3 font-semibold text-slate-600">Estado</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Cobrado</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Fecha pago</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...cuotasSelected]
                    .sort((a, b) => a.numero_cuota - b.numero_cuota)
                    .map(cuota => {
                      const esVencida = cuota.estado_pago === 'Pendiente' && cuota.fecha_vencimiento < today
                      return (
                        <tr key={cuota.id}
                          className={cn('hover:bg-slate-50 transition-colors', esVencida && 'bg-red-50/40')}>
                          <td className="px-4 py-3 text-center text-slate-500">{cuota.numero_cuota}</td>
                          <td className="px-4 py-3 text-right font-medium text-slate-900">
                            {formatCurrency(cuota.monto_base)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn('text-sm', esVencida ? 'text-red-600 font-semibold' : 'text-slate-600')}>
                              {formatDate(cuota.fecha_vencimiento)}
                            </span>
                            {esVencida && (
                              <p className="text-[10px] text-red-500">Vencida</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={cn(
                              'inline-block text-xs font-medium px-2 py-0.5 rounded-full border',
                              ESTADO_COLORS[cuota.estado_pago]
                            )}>
                              {cuota.estado_pago}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-500 text-xs">
                            {cuota.monto_cobrado ? formatCurrency(cuota.monto_cobrado) : '—'}
                          </td>
                          <td className="px-4 py-3 text-slate-500 text-xs">
                            {cuota.fecha_pago ? formatDate(cuota.fecha_pago) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {cuota.estado_pago === 'Pagado' ? (
                              <button
                                onClick={() => imprimirRecibo(cuota)}
                                className="text-xs font-medium text-slate-400 hover:text-slate-700 transition-colors"
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
                                Registrar pago
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
        )}
      </div>
    </div>

    {/* Modal registrar pago de cuota */}
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
                type="number"
                min="0"
                step="0.01"
                value={pagoMonto}
                onChange={e => setPagoMonto(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">Podés modificar si se cobró un monto diferente al base</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Cuenta donde se recibió el pago</label>
              <select
                value={pagoCuenta}
                onChange={e => setPagoCuenta(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
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
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setPagoModal(null)}
                className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={confirmarPago}
                disabled={loadingPago || !pagoMonto}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                {loadingPago ? 'Guardando...' : 'Confirmar cobro'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
