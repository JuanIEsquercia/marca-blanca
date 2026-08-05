'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { uploadToCloudinary } from '@/lib/cloudinary'
import { cn, formatCurrency, formatDate, redondear2, sumarMontos } from '@/lib/utils'
import type { Gasto, Proveedor, CuentaProveedor, CategoriaCosto, CuentaPropia, ModoCuentas } from '@/types/database'
import ConfirmModal from './ConfirmModal'
import PlanDePagoModal from './PlanDePagoModal'
import CuotasList from './CuotasList'
import IvaCalculator from './IvaCalculator'
import CuentaPropiaSelect from './CuentaPropiaSelect'
import ProveedorSelect from './ProveedorSelect'

type ConfirmModalState = { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> }

interface ContratoSubcontratistaRef {
  id: string
  proveedor_id: string
  descripcion: string | null
  certificados_avance: { id: string; numero: number; periodo: string }[]
}

interface Props {
  gastos: Gasto[]
  proveedores: Proveedor[]
  categorias: CategoriaCosto[]
  cuentasPropias: CuentaPropia[]
  // Modo de cada obra (empresa = pool compartido, específicas = cuentas
  // propias de ese proyecto) — solo lo pasa la vista de empresa
  // (app/admin/gastos/page.tsx), que mezcla gastos de todos los proyectos y
  // por eso necesita filtrar qué cuentas corresponden a CADA gasto puntual
  // al pagarlo. La vista por proyecto ya viene con cuentasPropias
  // pre-filtrada a un solo proyecto (ver su página), así que no lo pasa —
  // el default {} hace que cuentasPermitidasParaObra() no restrinja nada.
  obrasModoCuentas?: Record<string, ModoCuentas>
  constructoraId: string
  obraId?: string
  readOnly?: boolean
  // 'proveedores'/'cuentas' son módulos aparte de 'gastos' (lib/permisos.ts)
  // — tener acceso a Gastos no implica tenerlos. Gatean el "+ Agregar nuevo"
  // de los selectores inline (la RLS ya lo bloquea si no corresponde; esto
  // es para no mostrar una acción que va a fallar).
  puedeCrearProveedor: boolean
  puedeCrearCuenta: boolean
  // Si la página aplicó la ventana de "últimos 12 meses" a los Pagados
  // (default, para no traer todo el historial de la constructora en cada
  // carga — ver app/admin/gastos/page.tsx). Los Pendientes SIEMPRE vienen
  // completos sin importar este flag.
  historialAcotado?: boolean
  // Contratos de subcontratista de ESTE proyecto, con sus certificados —
  // permite imputar un gasto a un certificado puntual sin tener que
  // cargarlo desde "Agregar pago" en Contratos. Solo se pasa en la vista
  // por proyecto (acá no tiene sentido en la vista de empresa, no hay
  // una obra en contexto).
  contratosSubcontratista?: ContratoSubcontratistaRef[]
}

const EMPTY_FORM = {
  proveedor_id: '',
  cuenta_proveedor_id: '',
  categoria_id: '',
  certificado_id: '',
  descripcion: '',
  monto: '',
  moneda: 'ARS',
  fecha_vencimiento: '',
  numero_comprobante: '',
  notas: '',
  monto_neto: '',
  iva: '',
  percepciones: '',
}

// IvaCalculator solo lee su prop pctInicial al montar (useState inicial) —
// como el modal se remonta cada vez que showForm pasa a true, alcanza con
// dejar este valor bien calculado ANTES de abrir el modal (editar/duplicar/
// escaneo), para no pisar un IVA ya cargado con el 0% por defecto.
function pctDesdeNetoEIva(neto: number | null | undefined, iva: number | null | undefined): number | null {
  if (!neto || iva == null) return null
  return redondear2((iva / neto) * 100)
}

export default function GastosManager({ gastos, proveedores, categorias, cuentasPropias, obrasModoCuentas = {}, constructoraId, obraId, readOnly, historialAcotado, contratosSubcontratista = [], puedeCrearProveedor, puedeCrearCuenta }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [pctInicial, setPctInicial] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'Pendiente' | 'Pagado'>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [uploadingComp, setUploadingComp] = useState(false)
  const [comprobanteUrl, setComprobanteUrl] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [escaneando, setEscaneando] = useState(false)
  const [avisoEscaneo, setAvisoEscaneo] = useState<{ tipo: 'ok' | 'error'; mensaje: string } | null>(null)
  const scanFileRef = useRef<HTMLInputElement>(null)

  // "+ Agregar proveedor nuevo" en el selector: en vez de cortar la carga
  // del gasto para ir a Proveedores, el select se convierte en un mini-form
  // (ProveedorSelect, mismos campos que el alta completa) sin perder lo ya
  // completado — mismo criterio que "+ Agregar producto nuevo" en Compras.
  const [proveedoresNuevos, setProveedoresNuevos] = useState<Proveedor[]>([])
  const [cuentasNuevas, setCuentasNuevas] = useState<CuentaPropia[]>([])

  // Pago modal
  const [pagandoGasto, setPagandoGasto] = useState<Gasto | null>(null)
  const [pagoForm, setPagoForm] = useState({ cuenta_propia_id: '', fecha_pago: new Date().toISOString().split('T')[0] })
  const [loadingPago, setLoadingPago] = useState(false)
  const [pagoError, setPagoError] = useState<string | null>(null)

  // Plan de pago (cuotas/cheques) — alternativa al pago único de arriba.
  const [planDePagoTarget, setPlanDePagoTarget] = useState<Gasto | null>(null)
  const [expandedGastoId, setExpandedGastoId] = useState<string | null>(null)
  const tieneCuotas = (g: Gasto) => (g.gasto_pagos?.length ?? 0) > 0

  // Selección y pago en lote — antes pagar 10 gastos eran 10 modales
  // secuenciales, cada uno pidiendo cuenta y fecha de nuevo.
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [pagandoLote, setPagandoLote] = useState(false)
  const [pagoLoteForm, setPagoLoteForm] = useState({ cuenta_propia_id: '', fecha_pago: new Date().toISOString().split('T')[0] })
  const [loadingPagoLote, setLoadingPagoLote] = useState(false)
  const [pagoLoteError, setPagoLoteError] = useState<string | null>(null)

  function refresh() { startTransition(() => router.refresh()) }

  // Qué cuentas corresponden a un gasto puntual — en la vista de empresa
  // (obrasModoCuentas viene poblado) un gasto de una obra "específicas" solo
  // puede pagarse con SUS propias cuentas, nunca con las de otro proyecto ni
  // con el pool; un gasto sin obra (o de una obra "empresa") solo con el
  // pool. En la vista por proyecto (obrasModoCuentas = {}) no hay info para
  // decidir esto acá — cuentasPropias ya viene pre-filtrada por la página,
  // así que no se restringe de nuevo.
  function cuentasPermitidasParaObra(obraId: string | null): CuentaPropia[] {
    if (obraId === null) return cuentasPropias.filter(c => c.activa && c.obra_id === null)
    const modo = obrasModoCuentas[obraId]
    if (modo === undefined) return cuentasPropias.filter(c => c.activa)
    if (modo === 'especificas') return cuentasPropias.filter(c => c.activa && c.obra_id === obraId)
    return cuentasPropias.filter(c => c.activa && c.obra_id === null)
  }

  // Cuentas del proveedor seleccionado
  const ctasProveedor: CuentaProveedor[] = form.proveedor_id
    ? (proveedores.find(p => p.id === form.proveedor_id)?.cuentas_proveedor ?? [])
    : []

  // Certificados de los contratos de subcontratista que el proveedor
  // elegido tiene en ESTE proyecto (puede tener más de uno) — se listan
  // juntos, con el nombre del contrato para distinguirlos si hace falta.
  const contratosDelProveedor = form.proveedor_id
    ? contratosSubcontratista.filter(c => c.proveedor_id === form.proveedor_id)
    : []
  const certificadosDelProveedor = contratosDelProveedor.flatMap(c =>
    (c.certificados_avance ?? []).map(cert => ({ ...cert, contratoDescripcion: c.descripcion }))
  )

  const gastosFiltrados = gastos
    .filter(g => filtroEstado === 'todos' || g.estado === filtroEstado)
    .filter(g => !busqueda || g.descripcion.toLowerCase().includes(busqueda.toLowerCase()) ||
      g.proveedores?.razon_social.toLowerCase().includes(busqueda.toLowerCase()))

  function openNew() {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, fecha_vencimiento: new Date().toISOString().split('T')[0] })
    setPctInicial(null)
    setComprobanteUrl('')
    setError(null)
    setAvisoEscaneo(null)
    setShowForm(true)
  }

  function openEdit(g: Gasto) {
    setEditingId(g.id)
    // Un gasto viejo sin desglose (monto_neto null, de antes de que
    // existiera la calculadora de IVA) precarga el neto = total con
    // "Sin IVA" — si no, el campo Monto neto (ahora requerido, igual que
    // en Cobros) quedaría vacío y bloquearía el guardado hasta completarlo.
    const montoNeto = g.monto_neto ?? g.monto
    const iva = g.iva ?? 0
    setForm({
      proveedor_id: g.proveedor_id ?? '',
      cuenta_proveedor_id: g.cuenta_proveedor_id ?? '',
      categoria_id: g.categoria_id ?? '',
      certificado_id: g.certificado_id ?? '',
      descripcion: g.descripcion,
      monto: String(g.monto),
      moneda: g.moneda,
      fecha_vencimiento: g.fecha_vencimiento,
      numero_comprobante: g.numero_comprobante ?? '',
      notas: g.notas ?? '',
      monto_neto: String(montoNeto),
      iva: String(iva),
      percepciones: g.percepciones != null ? String(g.percepciones) : '',
    })
    setPctInicial(pctDesdeNetoEIva(montoNeto, iva))
    setComprobanteUrl(g.comprobante_url ?? '')
    setError(null)
    setAvisoEscaneo(null)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createClient()
    const payload = {
      proveedor_id: form.proveedor_id || null,
      cuenta_proveedor_id: form.cuenta_proveedor_id || null,
      categoria_id: form.categoria_id || null,
      certificado_id: form.certificado_id || null,
      descripcion: form.descripcion.trim(),
      monto: redondear2(parseFloat(form.monto)),
      moneda: form.moneda,
      fecha_vencimiento: form.fecha_vencimiento,
      numero_comprobante: form.numero_comprobante.trim() || null,
      notas: form.notas.trim() || null,
      comprobante_url: comprobanteUrl || null,
      monto_neto: form.monto_neto ? redondear2(parseFloat(form.monto_neto)) : null,
      iva: form.iva ? redondear2(parseFloat(form.iva)) : null,
      percepciones: form.percepciones ? redondear2(parseFloat(form.percepciones)) : null,
    }
    const { error: err } = editingId
      ? await supabase.from('gastos').update(payload).eq('id', editingId)
      : await supabase.from('gastos').insert({ ...payload, constructora_id: constructoraId, ...(obraId ? { obra_id: obraId } : {}) })
    setLoading(false)
    if (err) { setError(err.message); return }
    setShowForm(false)
    refresh()
  }

  function handleDelete(g: Gasto) {
    setConfirmModal({
      title: 'Eliminar gasto',
      message: `¿Eliminar "${g.descripcion}"? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      onConfirm: async () => {
        const supabase = createClient()
        const { error } = await supabase.from('gastos').delete().eq('id', g.id)
        if (error) throw new Error(error.message)
        setConfirmModal(null)
        refresh()
      },
    })
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

  async function handleEscanear(file: File) {
    setEscaneando(true)
    setAvisoEscaneo(null)
    setEditingId(null)
    setError(null)

    let secureUrl = ''
    try {
      const result = await uploadToCloudinary(file, 'renders')
      secureUrl = result.secure_url
      setComprobanteUrl(secureUrl)
    } catch {
      setError('Error al subir el comprobante')
      setEscaneando(false)
      return
    }

    try {
      const res = await fetch('/api/admin/gastos/extraer-factura', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: secureUrl }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Error al leer la factura')

      const d = json.data as {
        descripcion: string | null; monto: number | null; moneda: string | null
        fecha: string | null; numero_comprobante: string | null
        proveedor_razon_social: string | null; proveedor_cuit: string | null
        monto_neto: number | null; iva: number | null; percepciones: number | null
      }

      const cuitNormalizado = d.proveedor_cuit?.replace(/\D/g, '')
      const proveedorMatch = cuitNormalizado
        ? proveedores.find(p => p.cuit?.replace(/\D/g, '') === cuitNormalizado)
        : undefined

      // Si la extracción no encontró el neto (factura sin ese desglose, OCR
      // incompleto), se precarga neto = total con "Sin IVA" — igual criterio
      // que abrir un gasto viejo sin desglose, para no bloquear el guardado.
      const montoNeto = d.monto_neto ?? d.monto ?? null
      const iva = d.iva ?? 0
      setForm({
        ...EMPTY_FORM,
        descripcion: d.descripcion ?? '',
        monto: d.monto != null ? String(d.monto) : '',
        moneda: d.moneda === 'USD' ? 'USD' : 'ARS',
        fecha_vencimiento: d.fecha ?? new Date().toISOString().split('T')[0],
        numero_comprobante: d.numero_comprobante ?? '',
        proveedor_id: proveedorMatch?.id ?? '',
        monto_neto: montoNeto != null ? String(montoNeto) : '',
        iva: String(iva),
        percepciones: d.percepciones != null ? String(d.percepciones) : '',
      })
      setPctInicial(pctDesdeNetoEIva(montoNeto, iva))
      setAvisoEscaneo({ tipo: 'ok', mensaje: 'Datos completados automáticamente — revisá antes de guardar.' })
    } catch {
      setForm({ ...EMPTY_FORM, fecha_vencimiento: new Date().toISOString().split('T')[0] })
      setPctInicial(null)
      setAvisoEscaneo({ tipo: 'error', mensaje: 'No pudimos leer los datos de la factura automáticamente — completá el formulario a mano.' })
    } finally {
      setShowForm(true)
      setEscaneando(false)
    }
  }

  // ── Categorías ───────────────────────────────────────────
  const [showCatManager, setShowCatManager] = useState(false)
  const [catForm, setCatForm] = useState({ nombre: '', color: '#6366f1' })
  const [catLoading, setCatLoading] = useState(false)
  const [catError, setCatError] = useState<string | null>(null)

  const PRESET_COLORS = [
    '#6366f1', '#f59e0b', '#10b981', '#ef4444',
    '#3b82f6', '#8b5cf6', '#f97316', '#14b8a6',
  ]

  async function handleCreateCat(e: React.FormEvent) {
    e.preventDefault()
    if (!catForm.nombre.trim()) return
    setCatLoading(true)
    setCatError(null)
    const supabase = createClient()
    const { error } = await supabase.from('categorias_costo').insert({
      nombre: catForm.nombre.trim(),
      color: catForm.color,
      constructora_id: constructoraId,
    })
    setCatLoading(false)
    if (error) { setCatError(error.message); return }
    setCatForm({ nombre: '', color: '#6366f1' })
    refresh()
  }

  async function handleDeleteCat(id: string) {
    const supabase = createClient()
    const { error } = await supabase.from('categorias_costo').delete().eq('id', id)
    if (error) { setCatError(error.message); return }
    refresh()
  }

  async function confirmarPago() {
    if (!pagandoGasto) return
    if (!pagoForm.cuenta_propia_id) { return }
    setLoadingPago(true)
    setPagoError(null)
    const supabase = createClient()
    const { error } = await supabase.from('gastos').update({
      estado: 'Pagado',
      fecha_pago: pagoForm.fecha_pago,
      cuenta_propia_id: pagoForm.cuenta_propia_id,
    }).eq('id', pagandoGasto.id)
    setLoadingPago(false)
    if (error) { setPagoError(error.message); return }
    setPagandoGasto(null)
    refresh()
  }

  // Precarga el form con todo menos vencimiento/comprobante — pensado para
  // gastos recurrentes (alquiler, seguros) que hoy había que tipear de cero
  // cada mes.
  function duplicar(g: Gasto) {
    setEditingId(null)
    const montoNeto = g.monto_neto ?? g.monto
    const iva = g.iva ?? 0
    setForm({
      proveedor_id: g.proveedor_id ?? '',
      cuenta_proveedor_id: g.cuenta_proveedor_id ?? '',
      categoria_id: g.categoria_id ?? '',
      certificado_id: '',
      descripcion: g.descripcion,
      monto: String(g.monto),
      moneda: g.moneda,
      fecha_vencimiento: new Date().toISOString().split('T')[0],
      numero_comprobante: '',
      notas: g.notas ?? '',
      monto_neto: String(montoNeto),
      iva: String(iva),
      percepciones: g.percepciones != null ? String(g.percepciones) : '',
    })
    setPctInicial(pctDesdeNetoEIva(montoNeto, iva))
    setComprobanteUrl('')
    setError(null)
    setAvisoEscaneo(null)
    setShowForm(true)
  }

  function toggleSeleccionado(id: string) {
    setSeleccionados(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Un gasto con plan de pago activo se paga cuota por cuota (ver
  // CuotasList) — no participa del pago único ni del pago en lote, para
  // no pisar con un solo UPDATE lo que las cuotas individuales ya vienen
  // trackeando (ver lib/tesoreria.ts).
  const pendientesVisibles = gastosFiltrados.filter(g => g.estado === 'Pendiente' && !tieneCuotas(g))
  const todosPendientesSeleccionados = pendientesVisibles.length > 0 && pendientesVisibles.every(g => seleccionados.has(g.id))

  function toggleSeleccionarTodosPendientes() {
    const idsPendientes = pendientesVisibles.map(g => g.id)
    setSeleccionados(prev => todosPendientesSeleccionados
      ? new Set([...prev].filter(id => !idsPendientes.includes(id)))
      : new Set([...prev, ...idsPendientes]))
  }

  const gastosSeleccionados = gastos.filter(g => seleccionados.has(g.id))
  const monedasSeleccionadas = [...new Set(gastosSeleccionados.map(g => g.moneda))]
  // Si el lote mezcla obras (o hay algún gasto de empresa sin obra), no hay
  // un obra_id único al que anclar una cuenta creada al vuelo — se cae al
  // pool de empresa (obraId null), que la RLS solo deja crear a un admin.
  const obrasSeleccionadas = [...new Set(gastosSeleccionados.map(g => g.obra_id))]
  const obraIdLote = obrasSeleccionadas.length === 1 ? obrasSeleccionadas[0] : null
  const monedaLote = monedasSeleccionadas.length === 1 ? monedasSeleccionadas[0] : null

  // Cuentas válidas para TODOS los gastos del lote a la vez — intersección
  // de lo permitido por cada obra involucrada (mismo criterio que
  // cuentasPermitidasParaObra). Si el lote mezcla proyectos con cuentas
  // específicas distintas, la intersección da vacío — correcto: no existe
  // una única cuenta válida para pagarlos juntos.
  function cuentasPermitidasParaLote(): CuentaPropia[] {
    if (obrasSeleccionadas.length === 0) return []
    const idsPorObra = obrasSeleccionadas.map(o => new Set(cuentasPermitidasParaObra(o).map(c => c.id)))
    const idsComunes = idsPorObra.reduce((acc, ids) => new Set([...acc].filter(id => ids.has(id))))
    return cuentasPropias.filter(c => idsComunes.has(c.id))
  }

  function abrirPagoLote() {
    setPagoLoteForm({ cuenta_propia_id: '', fecha_pago: new Date().toISOString().split('T')[0] })
    setPagoLoteError(null)
    setPagandoLote(true)
  }

  async function confirmarPagoLote() {
    if (!pagoLoteForm.cuenta_propia_id || gastosSeleccionados.length === 0) return
    setLoadingPagoLote(true)
    setPagoLoteError(null)
    const supabase = createClient()
    const { error } = await supabase.from('gastos').update({
      estado: 'Pagado',
      fecha_pago: pagoLoteForm.fecha_pago,
      cuenta_propia_id: pagoLoteForm.cuenta_propia_id,
    }).in('id', gastosSeleccionados.map(g => g.id))
    setLoadingPagoLote(false)
    if (error) { setPagoLoteError(error.message); return }
    setPagandoLote(false)
    setSeleccionados(new Set())
    refresh()
  }

  const totalPendienteARS = sumarMontos(gastos.filter(g => g.estado === 'Pendiente' && g.moneda === 'ARS').map(g => g.monto))
  const totalPendienteUSD = sumarMontos(gastos.filter(g => g.estado === 'Pendiente' && g.moneda === 'USD').map(g => g.monto))

  return (
    <div>
      {/* Resumen comprometido */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <p className="text-xs text-orange-600 font-medium mb-1">Comprometido ARS</p>
          <p className="text-2xl font-bold text-orange-700">
            {formatCurrency(totalPendienteARS, 'ARS')}
          </p>
          <p className="text-xs text-orange-500 mt-0.5">
            {gastos.filter(g => g.estado === 'Pendiente' && g.moneda === 'ARS').length} pago(s) pendiente(s)
          </p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-xs text-blue-600 font-medium mb-1">Comprometido USD</p>
          <p className="text-2xl font-bold text-blue-700">
            {formatCurrency(totalPendienteUSD, 'USD')}
          </p>
          <p className="text-xs text-blue-500 mt-0.5">
            {gastos.filter(g => g.estado === 'Pendiente' && g.moneda === 'USD').length} pago(s) pendiente(s)
          </p>
        </div>
      </div>

      {historialAcotado && (
        <div className="mb-4 flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-xs text-slate-500">
          <span>Mostrando pagados de los últimos 12 meses (los pendientes se ven todos, sin importar la fecha).</span>
          <Link href={`${pathname}?historial=todo`} className="shrink-0 font-medium text-indigo-600 hover:text-indigo-700">
            Ver historial completo
          </Link>
        </div>
      )}

      {/* Filtros + botón */}
      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <input
          placeholder="Buscar por descripción o proveedor..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          className="w-full md:flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="flex flex-wrap gap-2 shrink-0">
          <div className="flex rounded-lg border border-slate-300 overflow-x-auto max-w-full text-sm bg-white no-scrollbar">
            {(['todos', 'Pendiente', 'Pagado'] as const).map(e => (
              <button key={e}
                onClick={() => setFiltroEstado(e)}
                className={cn(
                  'px-3 py-2 transition-colors',
                  filtroEstado === e ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                )}>
                {e === 'todos' ? 'Todos' : e}
              </button>
            ))}
          </div>
          <button onClick={() => setShowCatManager(true)}
            className="flex items-center gap-2 px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50
                       text-slate-700 rounded-lg text-sm font-medium transition-colors whitespace-nowrap">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            Categorías
          </button>
          {!readOnly && (
            <button onClick={() => scanFileRef.current?.click()}
              disabled={escaneando}
              className="flex items-center gap-2 px-3 py-2 border border-indigo-300 bg-indigo-50 hover:bg-indigo-100
                         text-indigo-700 rounded-lg text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-60">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {escaneando ? 'Leyendo factura...' : 'Escanear factura'}
            </button>
          )}
          {!readOnly && (
            <button onClick={openNew}
              className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500
                         text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Nuevo gasto
            </button>
          )}
        </div>
        <input ref={scanFileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
          capture="environment" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleEscanear(f); e.target.value = '' }} />
      </div>

      {!readOnly && seleccionados.size > 0 && (
        <div className="mb-4 flex items-center justify-between gap-3 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2.5">
          <span className="text-sm text-indigo-800">
            {seleccionados.size} gasto{seleccionados.size > 1 ? 's' : ''} seleccionado{seleccionados.size > 1 ? 's' : ''}
            {!monedaLote && ' — mezclás ARS y USD, seleccioná gastos de una sola moneda para pagarlos juntos'}
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <button onClick={() => setSeleccionados(new Set())} className="text-xs text-indigo-600 hover:text-indigo-800">
              Deseleccionar
            </button>
            <button
              onClick={abrirPagoLote}
              disabled={!monedaLote}
              className="text-xs font-medium px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors">
              Pagar seleccionados
            </button>
          </div>
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {!readOnly && (
                  <th className="px-4 py-3 w-8">
                    {pendientesVisibles.length > 0 && (
                      <input type="checkbox" checked={todosPendientesSeleccionados} onChange={toggleSeleccionarTodosPendientes}
                        title="Seleccionar todos los pendientes visibles" className="rounded border-slate-300" />
                    )}
                  </th>
                )}
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Descripción</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Proveedor</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Categoría</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">Monto</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Vencimiento</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            {gastosFiltrados.map(g => (
              <tbody key={g.id} className="divide-y divide-slate-100">
                <tr className="hover:bg-slate-50">
                  {!readOnly && (
                    <td className="px-4 py-3">
                      {g.estado === 'Pendiente' && !tieneCuotas(g) && (
                        <input type="checkbox" checked={seleccionados.has(g.id)} onChange={() => toggleSeleccionado(g.id)}
                          className="rounded border-slate-300" />
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{g.descripcion}</p>
                    {g.notas && <p className="text-xs text-slate-400 truncate max-w-xs">{g.notas}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {g.proveedores?.razon_social ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {g.categorias_costo ? (
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: g.categorias_costo.color }} />
                        {g.categorias_costo.nombre}
                      </span>
                    ) : <span className="text-slate-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {formatCurrency(g.monto, g.moneda)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(g.fecha_vencimiento)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn(
                      'inline-block text-xs font-medium px-2.5 py-0.5 rounded-full',
                      g.estado === 'Pagado'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-orange-100 text-orange-700'
                    )}>
                      {g.estado}
                    </span>
                    {tieneCuotas(g) && (
                      <button onClick={() => setExpandedGastoId(id => id === g.id ? null : g.id)}
                        className="block mx-auto mt-1 text-[11px] text-indigo-600 hover:text-indigo-800">
                        {(g.gasto_pagos ?? []).filter(c => c.estado === 'Pagado').length}/{(g.gasto_pagos ?? []).length} pagadas {expandedGastoId === g.id ? '▲' : '▼'}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {!readOnly && g.estado === 'Pendiente' && !tieneCuotas(g) && (
                        <button
                          onClick={() => {
                            setPagandoGasto(g)
                            setPagoForm({ cuenta_propia_id: '', fecha_pago: new Date().toISOString().split('T')[0] })
                          }}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors">
                          Registrar pago
                        </button>
                      )}
                      {!readOnly && g.estado === 'Pendiente' && (
                        <button onClick={() => setPlanDePagoTarget(g)}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors">
                          {tieneCuotas(g) ? 'Editar plan' : 'Plan de pago'}
                        </button>
                      )}
                      {g.estado === 'Pagado' && g.fecha_pago && (
                        <span className="text-xs text-slate-400">{formatDate(g.fecha_pago)}</span>
                      )}
                      {!readOnly && (
                        <button onClick={() => duplicar(g)}
                          className="text-xs text-slate-400 hover:text-slate-700 transition-colors">Duplicar</button>
                      )}
                      {!readOnly && (
                        <button onClick={() => openEdit(g)}
                          className="text-xs text-slate-400 hover:text-slate-700 transition-colors">Editar</button>
                      )}
                      {!readOnly && (
                        <button onClick={() => handleDelete(g)}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors">✕</button>
                      )}
                    </div>
                  </td>
                </tr>
                {expandedGastoId === g.id && (
                  <tr>
                    <td colSpan={readOnly ? 7 : 8} className="px-4 py-3 bg-slate-50/50">
                      <CuotasList entidad="gasto" cuotas={g.gasto_pagos ?? []} moneda={g.moneda}
                        cuentasPropias={cuentasPermitidasParaObra(g.obra_id)} constructoraId={constructoraId} obraId={g.obra_id}
                        puedeCrearCuenta={puedeCrearCuenta} readOnly={readOnly} onChanged={refresh} />
                    </td>
                  </tr>
                )}
              </tbody>
            ))}
          </table>
        </div>
        {gastosFiltrados.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <p className="text-sm">No hay gastos{filtroEstado !== 'todos' ? ` ${filtroEstado.toLowerCase()}s` : ''}.</p>
          </div>
        )}
      </div>

      {/* Modal Registrar Pago */}
      {pagandoGasto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="p-6 border-b border-slate-200">
              <h2 className="font-bold text-slate-900">Registrar pago</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {pagandoGasto.descripcion} ·{' '}
                <strong>{formatCurrency(pagandoGasto.monto, pagandoGasto.moneda)}</strong>
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Cuenta desde la que se pagó *</label>
                <CuentaPropiaSelect
                  cuentas={[...cuentasPermitidasParaObra(pagandoGasto.obra_id), ...cuentasNuevas]}
                  onCreated={c => setCuentasNuevas(prev => [...prev, c])}
                  value={pagoForm.cuenta_propia_id}
                  onChange={id => setPagoForm(f => ({ ...f, cuenta_propia_id: id }))}
                  constructoraId={constructoraId}
                  obraId={pagandoGasto.obra_id}
                  puedeCrear={puedeCrearCuenta}
                  moneda={pagandoGasto.moneda}
                  emptyLabel="Seleccionar cuenta..." />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de pago *</label>
                <input type="date" value={pagoForm.fecha_pago}
                  onChange={e => setPagoForm(f => ({ ...f, fecha_pago: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {pagoError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{pagoError}</div>
              )}
              <div className="flex gap-3 pt-2">
                <button onClick={() => { setPagandoGasto(null); setPagoError(null) }}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                  Cancelar
                </button>
                <button onClick={confirmarPago}
                  disabled={loadingPago || !pagoForm.cuenta_propia_id}
                  className="flex-1 py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loadingPago ? 'Guardando...' : 'Confirmar pago'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Pago en lote */}
      {pagandoLote && monedaLote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="p-6 border-b border-slate-200">
              <h2 className="font-bold text-slate-900">Pagar {gastosSeleccionados.length} gastos</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Total <strong>{formatCurrency(sumarMontos(gastosSeleccionados.map(g => g.monto)), monedaLote)}</strong> — se aplica la misma cuenta y fecha a todos.
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="max-h-32 overflow-y-auto bg-slate-50 border border-slate-100 rounded-lg divide-y divide-slate-100">
                {gastosSeleccionados.map(g => (
                  <div key={g.id} className="px-3 py-1.5 flex items-center justify-between text-xs">
                    <span className="text-slate-600 truncate">{g.descripcion}</span>
                    <span className="text-slate-800 font-medium shrink-0 ml-2">{formatCurrency(g.monto, g.moneda)}</span>
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Cuenta desde la que se pagó *</label>
                <CuentaPropiaSelect
                  cuentas={[...cuentasPermitidasParaLote(), ...cuentasNuevas]}
                  onCreated={c => setCuentasNuevas(prev => [...prev, c])}
                  value={pagoLoteForm.cuenta_propia_id}
                  onChange={id => setPagoLoteForm(f => ({ ...f, cuenta_propia_id: id }))}
                  constructoraId={constructoraId}
                  obraId={obraIdLote}
                  puedeCrear={puedeCrearCuenta}
                  moneda={monedaLote}
                  emptyLabel="Seleccionar cuenta..." />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de pago *</label>
                <input type="date" value={pagoLoteForm.fecha_pago}
                  onChange={e => setPagoLoteForm(f => ({ ...f, fecha_pago: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {pagoLoteError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{pagoLoteError}</div>
              )}
              <div className="flex gap-3 pt-2">
                <button onClick={() => { setPagandoLote(false); setPagoLoteError(null) }}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                  Cancelar
                </button>
                <button onClick={confirmarPagoLote}
                  disabled={loadingPagoLote || !pagoLoteForm.cuenta_propia_id}
                  className="flex-1 py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loadingPagoLote ? 'Guardando...' : 'Confirmar pago'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nuevo/Editar Gasto */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">
                {editingId ? 'Editar gasto' : 'Nuevo gasto'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {avisoEscaneo && (
                <div className={cn(
                  'p-3 rounded-lg text-sm border',
                  avisoEscaneo.tipo === 'ok'
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'bg-orange-50 border-orange-200 text-orange-700'
                )}>
                  {avisoEscaneo.mensaje}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Descripción *</label>
                <input required value={form.descripcion}
                  onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Ej: Compra de hierro ø12, Honorarios arq. mayo..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Moneda</label>
                <select value={form.moneda} onChange={e => setForm(f => ({ ...f, moneda: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option>ARS</option>
                  <option>USD</option>
                </select>
              </div>

              <IvaCalculator
                montoNeto={form.monto_neto} iva={form.iva} monto={form.monto}
                onChangeMontoNeto={v => setForm(f => ({ ...f, monto_neto: v }))}
                onChangeIva={v => setForm(f => ({ ...f, iva: v }))}
                onChangeMonto={v => setForm(f => ({ ...f, monto: v }))}
                pctInicial={pctInicial}
              />

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Percepciones</label>
                <input type="number" min="0" step="0.01" value={form.percepciones}
                  onChange={e => setForm(f => ({ ...f, percepciones: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Vencimiento *</label>
                  <input required type="date" value={form.fecha_vencimiento}
                    onChange={e => setForm(f => ({ ...f, fecha_vencimiento: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Categoría</label>
                  <select value={form.categoria_id}
                    onChange={e => setForm(f => ({ ...f, categoria_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">Sin categoría</option>
                    {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Proveedor</label>
                <ProveedorSelect
                  proveedores={[...proveedores.filter(p => p.activo), ...proveedoresNuevos]}
                  onCreated={p => setProveedoresNuevos(prev => [...prev, p])}
                  value={form.proveedor_id}
                  onChange={id => setForm(f => ({ ...f, proveedor_id: id, cuenta_proveedor_id: '', certificado_id: '' }))}
                  constructoraId={constructoraId}
                  puedeCrear={puedeCrearProveedor}
                  emptyLabel="Sin proveedor" />
              </div>

              {form.proveedor_id && certificadosDelProveedor.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Certificado de subcontratista (opcional)
                  </label>
                  <select value={form.certificado_id}
                    onChange={e => setForm(f => ({ ...f, certificado_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">Sin imputar a un certificado</option>
                    {certificadosDelProveedor.map(c => (
                      <option key={c.id} value={c.id}>
                        {contratosDelProveedor.length > 1 && c.contratoDescripcion ? `${c.contratoDescripcion} — ` : ''}
                        N°{c.numero} — {c.periodo}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">
                    Este proveedor tiene contrato de subcontratista en este proyecto — si este gasto corresponde a un certificado de avance suyo, elegilo acá.
                  </p>
                </div>
              )}

              {form.proveedor_id && ctasProveedor.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Cuenta de cobro del proveedor</label>
                  <select value={form.cuenta_proveedor_id}
                    onChange={e => setForm(f => ({ ...f, cuenta_proveedor_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">Sin especificar</option>
                    {ctasProveedor.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.tipo}{c.denominacion ? ` — ${c.denominacion}` : ''}{c.numero ? `: ${c.numero}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nº Comprobante</label>
                <input value={form.numero_comprobante}
                  onChange={e => setForm(f => ({ ...f, numero_comprobante: e.target.value }))}
                  placeholder="Factura A 0001-00012345"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              {/* Comprobante imagen */}
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

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notas</label>
                <textarea rows={2} value={form.notas}
                  onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
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
                  {loading ? 'Guardando...' : editingId ? 'Guardar' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Administrar Categorías */}
      {showCatManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="font-bold text-slate-900">Administrar categorías</h2>
                <p className="text-xs text-slate-500 mt-0.5">Tipos de gasto para clasificar egresos</p>
              </div>
              <button onClick={() => setShowCatManager(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Lista de categorías existentes */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {categorias.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No hay categorías creadas.</p>
              ) : categorias.map(cat => (
                <div key={cat.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-slate-100 hover:bg-slate-50">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="text-sm font-medium text-slate-800">{cat.nombre}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteCat(cat.id)}
                    className="text-xs text-red-400 hover:text-red-600 transition-colors px-1"
                    title="Eliminar categoría"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {/* Formulario nueva categoría */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
              <form onSubmit={handleCreateCat} className="space-y-3">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Nueva categoría</p>
                <div className="flex gap-2">
                  <input
                    required
                    placeholder="Ej: Materiales, Honorarios, Servicios..."
                    value={catForm.nombre}
                    onChange={e => setCatForm(f => ({ ...f, nombre: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-slate-500 shrink-0">Color:</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {PRESET_COLORS.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCatForm(f => ({ ...f, color: c }))}
                        className={cn(
                          'w-6 h-6 rounded-full border-2 transition-transform',
                          catForm.color === c ? 'border-slate-900 scale-110' : 'border-transparent'
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
                {catError && <p className="text-xs text-red-600">{catError}</p>}
                <button
                  type="submit"
                  disabled={catLoading || !catForm.nombre.trim()}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                             text-white rounded-lg text-sm font-semibold transition-colors"
                >
                  {catLoading ? 'Creando...' : 'Crear categoría'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {planDePagoTarget && (
        <PlanDePagoModal
          entidad="gasto"
          id={planDePagoTarget.id}
          montoTotal={planDePagoTarget.monto}
          moneda={planDePagoTarget.moneda}
          cuotasExistentes={planDePagoTarget.gasto_pagos ?? []}
          cuentasPropias={cuentasPermitidasParaObra(planDePagoTarget.obra_id)}
          constructoraId={constructoraId}
          obraId={planDePagoTarget.obra_id}
          puedeCrearCuenta={puedeCrearCuenta}
          onClose={() => setPlanDePagoTarget(null)}
          onSaved={() => { setPlanDePagoTarget(null); setExpandedGastoId(planDePagoTarget.id); refresh() }}
        />
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
