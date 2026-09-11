'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, estaVencido, formatCurrency, formatDate, redondear2, sumarMontos, ESTADO_COLORS } from '@/lib/utils'
import SaleForm from './SaleForm'
import ConfirmModal from './ConfirmModal'
import IvaCalculator from './IvaCalculator'
import CuentaPropiaSelect from './CuentaPropiaSelect'
import { emitirCuota, proyectarMonto } from '@/lib/cuotas-ajuste'
import type { Unidad, Tipologia, Comprador, Cuota, CuentaPropia, MonedaPlan } from '@/types/database'

type UnidadConTipologia = Unidad & { tipologias: Tipologia }

// El precio de una unidad y la entrega efectiva son siempre en dólares. El
// PLAN DE CUOTAS puede estar pactado en pesos (migration_080). Para poder
// compararlos sin mezclar monedas en un mismo total, todo lo que se
// contrasta contra las cuotas se expresa en la moneda del plan, usando la
// cotización pactada al firmar — que es, precisamente, el tipo de cambio
// que las partes acordaron para ese contrato.
function monedaDelPlan(c: { cuotas_moneda: MonedaPlan | null }): MonedaPlan {
  return c.cuotas_moneda ?? 'USD'
}

function aMonedaDelPlan(c: { cuotas_moneda: MonedaPlan | null; cotizacion_pactada: number | null }, montoUsd: number): number {
  if (monedaDelPlan(c) !== 'ARS') return montoUsd
  return redondear2(montoUsd * (c.cotizacion_pactada ?? 1))
}

// Etiqueta corta del ajuste, para no obligar a abrir el contrato para
// saber si una cuota se mueve o no.
function etiquetaIndice(tipo: string | null): string | null {
  if (!tipo) return null
  if (tipo.startsWith('USD')) return 'dólar'
  return tipo
}

type ContratoRow = {
  id: string
  unidad_id: string
  precio_final: number
  entrega_efectiva: number
  cantidad_cuotas: number
  fecha_firma: string
  notas: string | null
  estado: 'vigente' | 'rescindido'
  // Cómo se pactó el plan de cuotas (migration_079 + migration_080). El
  // precio y la entrega son SIEMPRE en dólares; esto describe únicamente
  // las cuotas.
  cuotas_moneda: MonedaPlan | null
  cotizacion_pactada: number | null
  indice_tipo: string | null
  tasa_mora_diaria: number | null
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
  constructoraId: string
  obraId: string
  puedeCrearCuenta: boolean
  compradores?: Comprador[]
  readOnly?: boolean
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

export default function ContratosManager({ contratos, unidadesDisponibles, cuentasPropias, constructoraId, obraId, puedeCrearCuenta, compradores = [], readOnly = false }: Props) {
  const router = useRouter()
  const today = new Date().toISOString().split('T')[0]
  const [, startTransition] = useTransition()

  // Lista
  const [showUnitPicker, setShowUnitPicker] = useState(false)
  const [unidadSeleccionada, setUnidadSeleccionada] = useState<UnidadConTipologia | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [rescindirTarget, setRescindirTarget] = useState<DeleteTarget | null>(null)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')

  // Panel cuotas
  const [cuotaPanel, setCuotaPanel] = useState<ContratoRow | null>(null)
  const [confirmRecalcular, setConfirmRecalcular] = useState(false)
  // Valor del índice del contrato al día de hoy. Se pide UNA vez al abrir
  // el panel, no una por cuota: la proyección es multiplicar las unidades
  // pactadas por este número, exactamente la misma cuenta que hace
  // estado_cuota() en la base.
  const [indiceHoy, setIndiceHoy] = useState<number | null>(null)
  const [emitiendo, setEmitiendo] = useState<string | null>(null)
  const [errorEmision, setErrorEmision] = useState<string | null>(null)

  // Modal pago
  const [pagoModal, setPagoModal] = useState<{ cuotaId: string; monto: number; moneda: MonedaPlan; capital: number; interes: number; dias: number } | null>(null)
  const [pagoCuenta, setPagoCuenta] = useState('')
  const [pagoFecha, setPagoFecha] = useState(today)
  const [cuentasNuevas, setCuentasNuevas] = useState<CuentaPropia[]>([])
  const [pagoMonto, setPagoMonto] = useState('')
  const [pagoNeto, setPagoNeto] = useState('')
  const [pagoIva, setPagoIva] = useState('')
  const [pagoPercepciones, setPagoPercepciones] = useState('')
  const [pagoComprobante, setPagoComprobante] = useState('')
  const [loadingPago, setLoadingPago] = useState(false)

  const rows = contratos.map((c) => {
    const cuotas = c.cuotas ?? []
    const pagadas = cuotas.filter((q) => q.estado_pago === 'Pagado').length
    const vencidas = cuotas.filter(
      (q) => estaVencido(q.fecha_vencimiento, q.estado_pago, 'Pendiente')
    ).length
    return { ...c, cuotas, pagadas, vencidas }
  })

  const rowsFiltrados = busqueda
    ? rows.filter(c => {
        const q = busqueda.toLowerCase()
        return (
          c.compradores?.nombre_completo.toLowerCase().includes(q) ||
          c.compradores?.dni_cuit?.toLowerCase().includes(q)
        )
      })
    : rows

  const totalIngresos = sumarMontos(rows.map(c => Number(c.precio_final)))
  const totalVencidas = rows.reduce((acc, c) => acc + c.vencidas, 0)

  // Sin índice cargado la proyección no se inventa: se muestra el monto
  // pactado y se avisa que falta el índice (mismo criterio que valor_indice,
  // que devuelve NULL en vez de 1).
  useEffect(() => {
    const tipo = cuotaPanel?.indice_tipo
    let vigente = true
    const pedido = tipo
      ? createClient()
          .rpc('valor_indice', { p_tipo: tipo, p_fecha: today })
          .then(({ data }) => (data == null ? null : Number(data)))
      : Promise.resolve(null)
    pedido.then(valor => { if (vigente) setIndiceHoy(valor) })
    return () => { vigente = false }
  }, [cuotaPanel?.indice_tipo, today])

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

  // El interés por mora viene desglosado y NO se guarda en ningún lado: se
  // calcula hasta el día del cobro y quien cobra puede decidir no cobrarlo
  // (así se resuelven los días de gracia, que en la práctica se perdonan o
  // se corren en la fecha de vencimiento).
  function abrirPago(cuotaId: string, monto: number, moneda: MonedaPlan, capital: number, interes: number, dias: number) {
    setPagoModal({ cuotaId, monto, moneda, capital, interes, dias })
    setPagoCuenta('')
    setPagoFecha(today)
    setPagoMonto(String(monto))
    setPagoNeto(String(monto))
    setPagoIva('')
    setPagoPercepciones('')
    setPagoComprobante('')
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
        monto_cobrado: redondear2(parseFloat(pagoMonto) || pagoModal.monto),
        cuenta_propia_id: pagoCuenta || null,
        monto_neto: pagoNeto ? redondear2(parseFloat(pagoNeto)) : null,
        iva: pagoIva ? redondear2(parseFloat(pagoIva)) : null,
        percepciones: pagoPercepciones ? redondear2(parseFloat(pagoPercepciones)) : null,
        numero_comprobante: pagoComprobante.trim() || null,
      })
      .eq('id', pagoModal.cuotaId)
    setLoadingPago(false)
    setPagoModal(null)
    refreshAndSyncPanel(cuotaPanel.id)
    setCuotaPanel(null)
  }

  // Redistribuye el saldo pendiente ACTUAL (precio_final - entrega_efectiva
  // - lo ya cobrado) entre las cuotas que siguen Pendientes, en partes
  // iguales (misma regla de redondeo que generar_cuotas_contrato: la última
  // absorbe el resto) — nunca toca una cuota ya Pagada. Antes, editar el
  // precio de una venta dejaba el plan de cuotas desactualizado sin ninguna
  // acción en la UI para corregirlo.
  async function recalcularCuotasPendientes() {
    if (!cuotaPanel) return
    // Un plan ajustable no se redistribuye acá: qué pasa con lo ya emitido
    // y contra qué valor de índice se reparte el resto son decisiones del
    // contrato, no un promedio. Repartir en partes iguales sobre montos que
    // se mueven daría un número que no representa nada.
    if (cuotaPanel.indice_tipo) {
      throw new Error('Este contrato tiene cuotas ajustables por índice: el plan no se redistribuye en partes iguales. Ajustá las cuotas pendientes una por una.')
    }

    const pendientes = cuotasPanel.filter(c => c.estado_pago === 'Pendiente')
    if (pendientes.length === 0) return

    const pagadoTotal = sumarMontos(
      cuotasPanel.filter(c => c.estado_pago === 'Pagado').map(c => c.monto_cobrado ?? c.monto_base)
    )
    // El precio y la entrega están en dólares; las cuotas, en la moneda del
    // plan. Se convierte el precio, nunca lo ya cobrado.
    const nuevoSaldo = redondear2(
      aMonedaDelPlan(cuotaPanel, cuotaPanel.precio_final - cuotaPanel.entrega_efectiva) - pagadoTotal
    )

    if (nuevoSaldo < 0) {
      throw new Error('El precio actual es menor a la entrega + lo ya cobrado — revisá el precio del contrato antes de recalcular.')
    }

    const supabase = createClient()
    const montoCuota = redondear2(nuevoSaldo / pendientes.length)

    const resultados = await Promise.all(pendientes.map((c, i) => {
      const esUltima = i === pendientes.length - 1
      const monto = esUltima ? redondear2(nuevoSaldo - montoCuota * (pendientes.length - 1)) : montoCuota
      return supabase.from('cuotas').update({ monto_base: monto }).eq('id', c.id)
    }))

    const conError = resultados.find(r => r.error)
    if (conError?.error) throw new Error(conError.error.message)

    setConfirmRecalcular(false)
    refreshAndSyncPanel(cuotaPanel.id)
  }

  function imprimirRecibo(cuota: Cuota) {
    if (!cuotaPanel) return
    const comp = cuotaPanel.compradores!
    const unidad = cuotaPanel.unidades!
    const totalCuotas = cuotaPanel.cuotas.length
    // El precio del contrato se imprime en dólares (es como se pactó); la
    // cuota, en la moneda de su plan. Mezclarlos en un solo formato es
    // justamente lo que hacía que un recibo en pesos dijera "US$".
    const fmtUsd = (n: number) => formatCurrency(n, 'USD')
    const fmt = (n: number) => formatCurrency(n, cuota.moneda ?? 'USD')
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
    <div class="row"><span class="label">Precio total del contrato</span><span class="value">${fmtUsd(cuotaPanel.precio_final)}</span></div>
  </div>
  <div class="highlight">
    <div class="monto-label">Monto cobrado</div>
    <div class="monto">${fmt(Number(cuota.monto_cobrado ?? cuota.monto_base))}</div>
  </div>
  <div class="section">
    <div class="row"><span class="label">Monto base de cuota</span><span class="value">${fmt(cuota.monto_base)}</span></div>
    ${cuotaPanel.indice_tipo ? `<div class="row"><span class="label">Ajuste pactado</span><span class="value">${etiquetaIndice(cuotaPanel.indice_tipo)}${cuota.monto_indice != null ? ` · ${cuota.monto_indice} unidades` : ''}</span></div>` : ''}
    ${cuota.fecha_emision ? `<div class="row"><span class="label">Cuota emitida el</span><span class="value">${fmtDate(cuota.fecha_emision)}${cuota.indice_valor_emision != null ? ` · índice ${cuota.indice_valor_emision}` : ''}</span></div>` : ''}
    <div class="row"><span class="label">Fecha de vencimiento</span><span class="value">${fmtDate(cuota.fecha_vencimiento)}</span></div>
    <div class="row"><span class="label">Fecha de pago</span><span class="value">${fmtDate(cuota.fecha_pago!)}</span></div>
    ${cuota.numero_comprobante ? `<div class="row"><span class="label">N° comprobante</span><span class="value">${cuota.numero_comprobante}</span></div>` : ''}
    ${cuota.monto_neto != null ? `<div class="row"><span class="label">Neto</span><span class="value">${fmt(cuota.monto_neto)}</span></div>` : ''}
    ${cuota.iva != null ? `<div class="row"><span class="label">IVA</span><span class="value">${fmt(cuota.iva)}</span></div>` : ''}
    ${cuota.percepciones != null ? `<div class="row"><span class="label">Percepciones</span><span class="value">${fmt(cuota.percepciones)}</span></div>` : ''}
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
    // Toda la posición de pagos se expresa en la moneda del PLAN: si las
    // cuotas se pactaron en pesos, el precio y la entrega se convierten a
    // la cotización pactada al firmar. Es el único modo de que "total
    // abonado" y "% abonado" signifiquen algo — sumar pesos con dólares no.
    const moneda = monedaDelPlan(cuotaPanel)
    const fmt = (n: number) => formatCurrency(n, moneda)
    const fmtUsd = (n: number) => formatCurrency(n, 'USD')
    const precioPlan = aMonedaDelPlan(cuotaPanel, cuotaPanel.precio_final)
    const entregaPlan = aMonedaDelPlan(cuotaPanel, cuotaPanel.entrega_efectiva)
    const fmtDate = (s: string) =>
      new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })

    const saldoFinanciado = redondear2(precioPlan - entregaPlan)
    const cuotasPagadasCount = cuotasOrdenadas.filter(c => c.estado_pago === 'Pagado').length
    const cuotasPendientesCount = cuotasOrdenadas.filter(c => c.estado_pago === 'Pendiente').length
    const totalCuotasPagado = sumarMontos(
      cuotasOrdenadas.filter(c => c.estado_pago === 'Pagado').map(c => Number(c.monto_cobrado ?? c.monto_base))
    )
    const totalPendiente = sumarMontos(
      cuotasOrdenadas.filter(c => c.estado_pago === 'Pendiente').map(c => Number(c.monto_base))
    )
    const totalAbonado = redondear2(entregaPlan + totalCuotasPagado)
    const pctAbonado = precioPlan > 0 ? Math.round((totalAbonado / precioPlan) * 100) : 0
    const montoCuotaAprox = cuotasOrdenadas.length > 0
      ? redondear2(saldoFinanciado / cuotasOrdenadas.length)
      : 0

    const filas = cuotasOrdenadas.map(c => {
      const esVencida = estaVencido(c.fecha_vencimiento, c.estado_pago, 'Pendiente')
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
        <div class="finance-row"><div><div class="finance-row-label">Precio total</div>${moneda === 'ARS' ? `<div class="finance-row-sub">${fmtUsd(cuotaPanel.precio_final)} a la cotización pactada de ${cuotaPanel.cotizacion_pactada} $/US$</div>` : ''}</div><div class="finance-row-value" style="color:#0f172a;">${fmt(precioPlan)}</div></div>
        <div class="finance-divider"></div>
        <div class="finance-row"><div><div class="finance-row-label">Entrega efectiva</div><div class="finance-row-sub">Pagada al momento de la firma · ${fmtDate(cuotaPanel.fecha_firma)}${moneda === 'ARS' ? ` · ${fmtUsd(cuotaPanel.entrega_efectiva)}` : ''}</div></div><div class="finance-row-value" style="color:#15803d;">— ${fmt(entregaPlan)}</div></div>
        <div class="finance-total-row"><div class="finance-total-label">Saldo financiado en ${cuotasOrdenadas.length} cuotas</div><div class="finance-total-value">${fmt(saldoFinanciado)}</div></div>
        <div style="font-size:10px;color:#94a3b8;margin-top:4px;">Valor de referencia por cuota: ${fmt(montoCuotaAprox)}${cuotaPanel.indice_tipo ? ` · ajustable por ${etiquetaIndice(cuotaPanel.indice_tipo)}, los montos no emitidos son estimados` : ''}</div>
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
        precio_final: redondear2(parseFloat(editState.precioFinal)),
        entrega_efectiva: redondear2(parseFloat(editState.entregaEfectiva)),
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
    // Si alguna cuota ya está Pagada (o el contrato tiene entrega_efectiva
    // cobrada), la DB bloquea el borrado para no-admins — no seguir con el
    // resto de la cascada si esto falla, para no dejar la unidad marcada
    // "Disponible" con un contrato/cuotas huérfanos todavía en la base.
    const { error: errCuotas } = await supabase.from('cuotas').delete().eq('contrato_id', deleteTarget.contratoId)
    if (errCuotas) throw new Error(errCuotas.message)
    const { error: errContrato } = await supabase.from('contratos_venta').delete().eq('id', deleteTarget.contratoId)
    if (errContrato) throw new Error(errContrato.message)
    const { error: errUnidad } = await supabase.from('unidades').update({ estado_comercial: 'Disponible' }).eq('id', deleteTarget.unidadId)
    if (errUnidad) throw new Error(errUnidad.message)
    setDeleteTarget(null)
    refresh()
  }

  // A diferencia de handleDelete, no borra las cuotas — el historial de
  // pagos queda intacto (mismo espíritu que "Cerrar proyecto" en obras,
  // ver migration_058). Se usa cuando la venta cae pero ya hubo cobros
  // reales, y perderlos no tiene sentido.
  async function handleRescindir() {
    if (!rescindirTarget) return
    const supabase = createClient()
    const { error: errContrato } = await supabase.from('contratos_venta').update({ estado: 'rescindido' }).eq('id', rescindirTarget.contratoId)
    if (errContrato) throw new Error(errContrato.message)
    const { error: errUnidad } = await supabase.from('unidades').update({ estado_comercial: 'Disponible' }).eq('id', rescindirTarget.unidadId)
    if (errUnidad) throw new Error(errUnidad.message)
    setRescindirTarget(null)
    refresh()
  }

  function handleVentaSuccess() {
    setUnidadSeleccionada(null)
    refresh()
  }

  const saldoEdicion = editState
    ? Math.max(0, redondear2(parseFloat(editState.precioFinal || '0') - parseFloat(editState.entregaEfectiva || '0')))
    : 0

  // Cuánto vale HOY una cuota. Con ajuste por índice y sin emitir es una
  // PROYECCIÓN, no un compromiso: por eso vuelve marcada como estimada y la
  // pantalla lo dice. Emitida, el monto está congelado y no se recalcula
  // nunca más (lo impone un trigger, no solo esta función).
  function capitalCuota(cuota: Cuota): { monto: number; estimado: boolean } {
    if (!cuotaPanel?.indice_tipo || cuota.fecha_emision || cuota.monto_indice == null) {
      return { monto: Number(cuota.monto_base), estimado: false }
    }
    if (indiceHoy == null) return { monto: Number(cuota.monto_base), estimado: true }
    return { monto: proyectarMonto(Number(cuota.monto_indice), indiceHoy), estimado: true }
  }

  // Interés por atraso: diario simple SOBRE EL CAPITAL YA AJUSTADO, nunca
  // capitalizado, nunca guardado. Misma cuenta que estado_cuota() en la
  // base. Se calcula hasta hoy, o hasta el día que se cobró.
  function moraCuota(capital: number, cuota: Cuota): { dias: number; interes: number } {
    const hasta = cuota.fecha_pago ?? today
    const dias = Math.max(0, Math.round(
      (Date.parse(hasta) - Date.parse(cuota.fecha_vencimiento)) / 86_400_000
    ))
    const tasa = cuotaPanel?.tasa_mora_diaria
    if (!tasa || dias <= 0) return { dias, interes: 0 }
    return { dias, interes: redondear2(capital * (tasa / 100) * dias) }
  }

  // Congela el monto de la cuota con el último índice publicado. Es
  // explícito y no automático al vencer porque la cuota se le manda al
  // comprador días antes y el número tiene que quedar fijo desde ese envío.
  async function emitir(cuotaId: string) {
    setEmitiendo(cuotaId)
    setErrorEmision(null)
    const res = await emitirCuota(createClient(), cuotaId, today)
    setEmitiendo(null)
    if (!res.ok) { setErrorEmision(res.error); return }
    setCuotaPanel(prev => prev ? {
      ...prev,
      cuotas: prev.cuotas.map(q => q.id === cuotaId
        ? { ...q, monto_base: res.resultado.montoCongelado, fecha_emision: today, indice_valor_emision: res.resultado.indiceUsado }
        : q),
    } : prev)
    refresh()
  }

  // Cuotas del panel activo
  const cuotasPanel = cuotaPanel
    ? [...cuotaPanel.cuotas].sort((a, b) => a.numero_cuota - b.numero_cuota)
    : []
  const monedaPanel: MonedaPlan = cuotaPanel ? monedaDelPlan(cuotaPanel) : 'USD'
  const cuotasPagadas = cuotasPanel.filter(c => c.estado_pago === 'Pagado').length
  const cuotasPendientes = cuotasPanel.filter(c => c.estado_pago === 'Pendiente').length
  const cuotasVencidas = cuotasPanel.filter(c => estaVencido(c.fecha_vencimiento, c.estado_pago, 'Pendiente')).length

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Ventas</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Todos los contratos de venta del desarrollo</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar por nombre o DNI..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              className="pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
            />
          </div>
          {!readOnly && (
            <button
              onClick={() => setShowUnitPicker(true)}
              disabled={unidadesDisponibles.length === 0}
              title={unidadesDisponibles.length === 0 ? 'No hay unidades disponibles' : undefined}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500
                         disabled:opacity-40 disabled:cursor-not-allowed
                         text-white rounded-xl text-sm font-semibold transition-colors w-full sm:w-auto"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Nueva venta
            </button>
          )}
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Ventas registradas</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white truncate" title={String(rows.length)}>{rows.length}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Ingresos totales</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white truncate" title={formatCurrency(totalIngresos)}>{formatCurrency(totalIngresos)}</p>
        </div>
        <div className={`border rounded-xl p-4 ${totalVencidas > 0 ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/50' : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800'}`}>
          <p className={`text-xs font-medium mb-1 ${totalVencidas > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
            Cuotas vencidas sin cobrar
          </p>
          <p className={`text-xl sm:text-2xl font-bold ${totalVencidas > 0 ? 'text-red-700 dark:text-red-300' : 'text-slate-900 dark:text-white'} truncate`} title={String(totalVencidas)}>
            {totalVencidas}
          </p>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                <th className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Comprador</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Unidad</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Precio final</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Entrega</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Cuotas</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Firma</th>
                <th className="px-4 py-3 w-44" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rowsFiltrados.map((c) => {
                const unidad = c.unidades
                const comprador = c.compradores
                return (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium text-slate-900 dark:text-white">{comprador?.nombre_completo}</p>
                        {c.estado === 'rescindido' && (
                          <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/60 px-1.5 py-0.5 rounded-full">Rescindido</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 dark:text-slate-500 font-mono">{comprador?.dni_cuit}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {unidad ? `P${unidad.piso} - ${unidad.numero}${unidad.letra ?? ''}` : '—'}
                      <p className="text-xs text-slate-400 dark:text-slate-500">{unidad?.tipologias?.nombre}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-white">
                      {formatCurrency(c.precio_final)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                      {formatCurrency(c.entrega_efectiva)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-xs text-slate-500 dark:text-slate-400">{c.pagadas}/{c.cuotas.length} pagadas</span>
                        {c.vencidas > 0 && (
                          <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/60 px-1.5 py-0.5 rounded-full">
                            {c.vencidas} vencida{c.vencidas > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{formatDate(c.fecha_firma)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openCuotaPanel(c)}
                          className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors px-2 py-1"
                        >
                          Ver cuotas →
                        </button>
                        {!readOnly && (
                          <button
                            onClick={() => openEdit(c)}
                            title="Editar"
                            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                        )}
                        {!readOnly && c.estado === 'vigente' && (
                          <button
                            onClick={() => setRescindirTarget({
                              contratoId: c.id,
                              compradorNombre: comprador?.nombre_completo ?? '',
                              unidadId: c.unidad_id,
                            })}
                            title="Rescindir contrato — la venta cayó, pero conserva el historial de cuotas"
                            className="text-xs font-medium text-slate-400 hover:text-amber-700 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-lg px-2 py-1 transition-colors"
                          >
                            Rescindir
                          </button>
                        )}
                        {!readOnly && (
                          <button
                            onClick={() => setDeleteTarget({
                              contratoId: c.id,
                              compradorNombre: comprador?.nombre_completo ?? '',
                              unidadId: c.unidad_id,
                            })}
                            title="Eliminar"
                            className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
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
                  {!readOnly && (
                    <button
                      onClick={() => setShowUnitPicker(true)}
                      disabled={unidadesDisponibles.length === 0}
                      className="mt-2 text-xs text-indigo-500 hover:text-indigo-700 disabled:opacity-40"
                    >
                      {unidadesDisponibles.length > 0 ? 'Registrar primera venta →' : 'No hay unidades disponibles'}
                    </button>
                  )}
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
          <div className="w-full max-w-2xl bg-slate-50 dark:bg-slate-950 flex flex-col shadow-2xl overflow-hidden">
            {/* Panel header */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex items-start justify-between shrink-0">
              <div>
                <p className="font-bold text-slate-900 dark:text-white text-lg">
                  {cuotaPanel.compradores?.nombre_completo}
                </p>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
                  DNI/CUIT: {cuotaPanel.compradores?.dni_cuit} ·{' '}
                  P{cuotaPanel.unidades?.piso} - {cuotaPanel.unidades?.numero}{cuotaPanel.unidades?.letra ?? ''} ·{' '}
                  Precio: {formatCurrency(cuotaPanel.precio_final)}
                </p>
                {(monedaPanel === 'ARS' || cuotaPanel.indice_tipo) && (
                  <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1 font-medium">
                    Cuotas en {monedaPanel === 'ARS' ? 'pesos' : 'dólares'}
                    {cuotaPanel.cotizacion_pactada ? ` · cotización pactada ${cuotaPanel.cotizacion_pactada} $/US$` : ''}
                    {cuotaPanel.indice_tipo ? ` · ajustables por ${etiquetaIndice(cuotaPanel.indice_tipo)}` : ''}
                    {cuotaPanel.tasa_mora_diaria ? ` · mora ${cuotaPanel.tasa_mora_diaria}% diario` : ''}
                  </p>
                )}
                {cuotaPanel.indice_tipo && indiceHoy == null && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    No hay ningún valor de {etiquetaIndice(cuotaPanel.indice_tipo)} cargado: los montos que se muestran son los pactados, sin ajustar.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 ml-4 shrink-0">
                {!readOnly && cuotasPendientes > 0 && !cuotaPanel.indice_tipo && (
                  <button
                    onClick={() => setConfirmRecalcular(true)}
                    title="Redistribuye el saldo pendiente actual (precio - entrega - lo ya cobrado) entre las cuotas que siguen pendientes. Las cuotas ya pagadas no se tocan."
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300
                               border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Recalcular cuotas pendientes
                  </button>
                )}
                <button
                  onClick={imprimirEstadoCuenta}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300
                             border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Estado de cuenta
                </button>
                <button
                  onClick={() => setCuotaPanel(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="px-6 py-3 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 flex gap-6 shrink-0">
              <div className="text-center">
                <p className="text-xl font-bold text-slate-900 dark:text-white">{cuotasPanel.length}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Total</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-green-600 dark:text-emerald-400">{cuotasPagadas}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Pagadas</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-orange-500 dark:text-amber-400">{cuotasPendientes}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Pendientes</p>
              </div>
              {cuotasVencidas > 0 && (
                <div className="text-center">
                  <p className="text-xl font-bold text-red-600 dark:text-red-400">{cuotasVencidas}</p>
                  <p className="text-xs text-red-500 dark:text-red-400">Vencidas</p>
                </div>
              )}
            </div>

            {/* Tabla cuotas */}
            <div className="flex-1 overflow-y-auto p-4">
              {errorEmision && (
                <div className="mb-3 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg text-sm">
                  {errorEmision}
                </div>
              )}
              <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                        <th className="text-center px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 w-12">Nº</th>
                        <th className="text-right px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300">Monto</th>
                        <th className="text-left px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300">Vencimiento</th>
                        <th className="text-center px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300">Estado</th>
                        <th className="text-right px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300">Cobrado</th>
                        <th className="text-left px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300">Pago</th>
                        <th className="px-3 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {cuotasPanel.map(cuota => {
                        const esVencida = estaVencido(cuota.fecha_vencimiento, cuota.estado_pago, 'Pendiente')
                        const { monto: capital, estimado } = capitalCuota(cuota)
                        const { dias, interes } = moraCuota(capital, cuota)
                        const puedeEmitir = !readOnly && !!cuotaPanel.indice_tipo
                          && !cuota.fecha_emision && cuota.estado_pago !== 'Pagado'
                        return (
                          <tr key={cuota.id}
                            className={cn('hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors', esVencida && 'bg-red-50/40 dark:bg-red-950/20')}>
                            <td className="px-3 py-2.5 text-center text-slate-500 dark:text-slate-400 text-xs">{cuota.numero_cuota}</td>
                            <td className="px-3 py-2.5 text-right font-medium text-slate-900 dark:text-white">
                              {formatCurrency(capital, cuota.moneda ?? 'USD')}
                              {estimado && (
                                <span className="block text-[10px] font-normal text-amber-600 dark:text-amber-400">estimado</span>
                              )}
                              {cuota.fecha_emision && (
                                <span className="block text-[10px] font-normal text-slate-400 dark:text-slate-500">
                                  emitida {formatDate(cuota.fecha_emision)}
                                </span>
                              )}
                              {interes > 0 && cuota.estado_pago !== 'Pagado' && (
                                <span className="block text-[10px] font-normal text-red-600 dark:text-red-400">
                                  + {formatCurrency(interes, cuota.moneda ?? 'USD')} de mora ({dias} d)
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={cn('text-xs', esVencida ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-slate-600 dark:text-slate-300')}>
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
                            <td className="px-3 py-2.5 text-right text-slate-500 dark:text-slate-400 text-xs">
                              {cuota.monto_cobrado ? formatCurrency(cuota.monto_cobrado, cuota.moneda ?? 'USD') : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400 text-xs">
                              {cuota.fecha_pago ? formatDate(cuota.fecha_pago) : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right whitespace-nowrap">
                              {puedeEmitir && (
                                <button
                                  onClick={() => emitir(cuota.id)}
                                  disabled={emitiendo === cuota.id}
                                  title="Congela el monto de esta cuota con el último índice publicado. Una vez emitida ya no se ajusta: el ajuste corre siempre hacia adelante."
                                  className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 disabled:opacity-50 mr-3 transition-colors"
                                >
                                  {emitiendo === cuota.id ? 'Emitiendo...' : 'Emitir'}
                                </button>
                              )}
                              {cuota.estado_pago === 'Pagado' ? (
                                <button
                                  onClick={() => imprimirRecibo(cuota)}
                                  className="text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                                >
                                  Recibo
                                </button>
                              ) : !readOnly ? (
                                <button
                                  onClick={() => abrirPago(cuota.id, redondear2(capital + interes), (cuota.moneda ?? 'USD'), capital, interes, dias)}
                                  className={cn(
                                    'text-xs font-medium transition-colors',
                                    esVencida
                                      ? 'text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300'
                                      : 'text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300'
                                  )}
                                >
                                  Cobrar
                                </button>
                              ) : null}
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
        </div>
      )}

      {/* ── Modal pago de cuota ──────────────────────────────── */}
      {pagoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="p-6 border-b border-slate-200 dark:border-slate-800">
              <h2 className="font-bold text-slate-900 dark:text-white">Registrar cobro de cuota</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Monto base: <strong>{formatCurrency(pagoModal.capital, pagoModal.moneda)}</strong>
              </p>
              {pagoModal.interes > 0 && (
                <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                  + {formatCurrency(pagoModal.interes, pagoModal.moneda)} de interés por {pagoModal.dias} día{pagoModal.dias === 1 ? '' : 's'} de atraso ·{' '}
                  <strong>total {formatCurrency(pagoModal.monto, pagoModal.moneda)}</strong>
                  <span className="block text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                    Si perdonás la mora, bajá el total al monto base.
                  </span>
                </p>
              )}
            </div>
            <div className="p-6 space-y-4">
              <IvaCalculator
                montoNeto={pagoNeto} iva={pagoIva} monto={pagoMonto}
                onChangeMontoNeto={setPagoNeto} onChangeIva={setPagoIva} onChangeMonto={setPagoMonto}
              />
              <p className="text-[10px] text-slate-400 dark:text-slate-500 -mt-2">El total es el &quot;Monto cobrado&quot; — modificalo si se cobró un monto diferente al base.</p>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Percepciones</label>
                <input type="number" min="0" step="0.01" value={pagoPercepciones}
                  onChange={e => setPagoPercepciones(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">N° comprobante</label>
                <input value={pagoComprobante}
                  onChange={e => setPagoComprobante(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Cuenta donde se recibió</label>
                <CuentaPropiaSelect
                  cuentas={[...cuentasPropias.filter(c => c.activa), ...cuentasNuevas]}
                  onCreated={c => setCuentasNuevas(prev => [...prev, c])}
                  value={pagoCuenta}
                  onChange={setPagoCuenta}
                  constructoraId={constructoraId}
                  obraId={obraId}
                  puedeCrear={puedeCrearCuenta}
                  moneda={pagoModal.moneda}
                  emptyLabel="Sin asignar" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Fecha de cobro *</label>
                <input type="date" value={pagoFecha}
                  onChange={e => setPagoFecha(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setPagoModal(null)}
                  className="flex-1 py-2.5 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
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
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="font-bold text-slate-900 dark:text-white">Nueva venta</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {unidadesDisponibles.length} unidad{unidadesDisponibles.length !== 1 ? 'es' : ''} disponible{unidadesDisponibles.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button onClick={() => setShowUnitPicker(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-3">
              {unidadesDisponibles.map(u => (
                <button
                  key={u.id}
                  onClick={() => { setShowUnitPicker(false); setUnidadSeleccionada(u) }}
                  className="text-left p-4 border border-slate-200 dark:border-slate-800 rounded-xl
                             hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                >
                  <p className="font-semibold text-slate-900 dark:text-white">P{u.piso} · {u.numero}{u.letra ?? ''}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{u.tipologias.nombre}</p>
                  <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400 mt-2">{formatCurrency(u.precio_lista)}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: editar venta ──────────────────────────────── */}
      {editState && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800">
              <h2 className="font-bold text-slate-900 dark:text-white">Editar venta</h2>
              <button onClick={() => setEditState(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleEdit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Precio final (USD) *</label>
                  <input
                    required type="number" min="0" step="0.01"
                    value={editState.precioFinal}
                    onChange={e => setEditState(s => s && { ...s, precioFinal: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Entrega efectiva (USD) *</label>
                  <input
                    required type="number" min="0" step="0.01"
                    value={editState.entregaEfectiva}
                    onChange={e => setEditState(s => s && { ...s, entregaEfectiva: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Fecha de firma *</label>
                  <input
                    required type="date"
                    value={editState.fechaFirma}
                    onChange={e => setEditState(s => s && { ...s, fechaFirma: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 flex flex-col justify-center">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Saldo financiado</p>
                  <p className="font-bold text-slate-900 dark:text-white mt-0.5">{formatCurrency(saldoEdicion)}</p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Notas</label>
                <textarea
                  rows={2}
                  value={editState.notas}
                  onChange={e => setEditState(s => s && { ...s, notas: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Los cambios de precio no actualizan solos el plan de cuotas — después de guardar, usá &quot;Recalcular cuotas pendientes&quot; en el panel de cuotas de este contrato si hace falta.
              </p>
              {editError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 rounded-lg text-red-700 dark:text-red-400 text-sm">
                  {editError}
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  type="button" onClick={() => setEditState(null)}
                  className="flex-1 py-2.5 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-medium
                             text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
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
          constructoraId={constructoraId}
          puedeCrearCuenta={puedeCrearCuenta}
          compradores={compradores}
        />
      )}

      {/* Confirmar eliminación */}
      {deleteTarget && (
        <ConfirmModal
          title="Eliminar venta"
          message={`¿Eliminar la venta de ${deleteTarget.compradorNombre}? Se borrarán todas las cuotas asociadas y la unidad volverá a estar disponible. Si ya hubo cobros reales, mejor usá "Rescindir" para conservar el historial.`}
          confirmLabel="Eliminar venta"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Confirmar rescisión */}
      {rescindirTarget && (
        <ConfirmModal
          title="Rescindir contrato"
          message={`¿Rescindir la venta de ${rescindirTarget.compradorNombre}? La unidad vuelve a estar disponible, pero las cuotas no se borran — quedan como historial.`}
          confirmLabel="Rescindir"
          danger={false}
          onConfirm={handleRescindir}
          onCancel={() => setRescindirTarget(null)}
        />
      )}

      {/* Confirmar recalcular cuotas pendientes */}
      {confirmRecalcular && cuotaPanel && (
        <ConfirmModal
          title="Recalcular cuotas pendientes"
          message="Se va a redistribuir el saldo pendiente actual (precio del contrato menos entrega y lo ya cobrado) en partes iguales entre las cuotas que todavía están Pendientes. Las cuotas ya Pagadas no se modifican."
          confirmLabel="Recalcular"
          danger={false}
          onConfirm={recalcularCuotasPendientes}
          onCancel={() => setConfirmRecalcular(false)}
        />
      )}
    </div>
  )
}
