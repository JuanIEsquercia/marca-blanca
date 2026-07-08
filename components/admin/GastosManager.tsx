'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { uploadToCloudinary } from '@/lib/cloudinary'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import type { Gasto, Proveedor, CuentaProveedor, CategoriaCosto, CuentaPropia } from '@/types/database'
import ConfirmModal from './ConfirmModal'

type ConfirmModalState = { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> }

interface Props {
  gastos: Gasto[]
  proveedores: Proveedor[]
  categorias: CategoriaCosto[]
  cuentasPropias: CuentaPropia[]
  constructoraId: string
  obraId?: string
  readOnly?: boolean
}

const EMPTY_FORM = {
  proveedor_id: '',
  cuenta_proveedor_id: '',
  categoria_id: '',
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

export default function GastosManager({ gastos, proveedores, categorias, cuentasPropias, constructoraId, obraId, readOnly }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
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

  // Pago modal
  const [pagandoGasto, setPagandoGasto] = useState<Gasto | null>(null)
  const [pagoForm, setPagoForm] = useState({ cuenta_propia_id: '', fecha_pago: new Date().toISOString().split('T')[0] })
  const [loadingPago, setLoadingPago] = useState(false)

  function refresh() { startTransition(() => router.refresh()) }

  // Cuentas del proveedor seleccionado
  const ctasProveedor: CuentaProveedor[] = form.proveedor_id
    ? (proveedores.find(p => p.id === form.proveedor_id)?.cuentas_proveedor ?? [])
    : []

  const gastosFiltrados = gastos
    .filter(g => filtroEstado === 'todos' || g.estado === filtroEstado)
    .filter(g => !busqueda || g.descripcion.toLowerCase().includes(busqueda.toLowerCase()) ||
      g.proveedores?.razon_social.toLowerCase().includes(busqueda.toLowerCase()))

  function openNew() {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, fecha_vencimiento: new Date().toISOString().split('T')[0] })
    setComprobanteUrl('')
    setError(null)
    setAvisoEscaneo(null)
    setShowForm(true)
  }

  function openEdit(g: Gasto) {
    setEditingId(g.id)
    setForm({
      proveedor_id: g.proveedor_id ?? '',
      cuenta_proveedor_id: g.cuenta_proveedor_id ?? '',
      categoria_id: g.categoria_id ?? '',
      descripcion: g.descripcion,
      monto: String(g.monto),
      moneda: g.moneda,
      fecha_vencimiento: g.fecha_vencimiento,
      numero_comprobante: g.numero_comprobante ?? '',
      notas: g.notas ?? '',
      monto_neto: g.monto_neto != null ? String(g.monto_neto) : '',
      iva: g.iva != null ? String(g.iva) : '',
      percepciones: g.percepciones != null ? String(g.percepciones) : '',
    })
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
      descripcion: form.descripcion.trim(),
      monto: parseFloat(form.monto),
      moneda: form.moneda,
      fecha_vencimiento: form.fecha_vencimiento,
      numero_comprobante: form.numero_comprobante.trim() || null,
      notas: form.notas.trim() || null,
      comprobante_url: comprobanteUrl || null,
      monto_neto: form.monto_neto ? parseFloat(form.monto_neto) : null,
      iva: form.iva ? parseFloat(form.iva) : null,
      percepciones: form.percepciones ? parseFloat(form.percepciones) : null,
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
        await supabase.from('gastos').delete().eq('id', g.id)
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

      setForm({
        ...EMPTY_FORM,
        descripcion: d.descripcion ?? '',
        monto: d.monto != null ? String(d.monto) : '',
        moneda: d.moneda === 'USD' ? 'USD' : 'ARS',
        fecha_vencimiento: d.fecha ?? new Date().toISOString().split('T')[0],
        numero_comprobante: d.numero_comprobante ?? '',
        proveedor_id: proveedorMatch?.id ?? '',
        monto_neto: d.monto_neto != null ? String(d.monto_neto) : '',
        iva: d.iva != null ? String(d.iva) : '',
        percepciones: d.percepciones != null ? String(d.percepciones) : '',
      })
      setAvisoEscaneo({ tipo: 'ok', mensaje: 'Datos completados automáticamente — revisá antes de guardar.' })
    } catch {
      setForm({ ...EMPTY_FORM, fecha_vencimiento: new Date().toISOString().split('T')[0] })
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
    await supabase.from('categorias_costo').delete().eq('id', id)
    refresh()
  }

  async function confirmarPago() {
    if (!pagandoGasto) return
    if (!pagoForm.cuenta_propia_id) { return }
    setLoadingPago(true)
    const supabase = createClient()
    await supabase.from('gastos').update({
      estado: 'Pagado',
      fecha_pago: pagoForm.fecha_pago,
      cuenta_propia_id: pagoForm.cuenta_propia_id,
    }).eq('id', pagandoGasto.id)
    setLoadingPago(false)
    setPagandoGasto(null)
    refresh()
  }

  const totalPendienteARS = gastos.filter(g => g.estado === 'Pendiente' && g.moneda === 'ARS').reduce((s, g) => s + g.monto, 0)
  const totalPendienteUSD = gastos.filter(g => g.estado === 'Pendiente' && g.moneda === 'USD').reduce((s, g) => s + g.monto, 0)

  return (
    <div>
      {/* Resumen comprometido */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <p className="text-xs text-orange-600 font-medium mb-1">Comprometido ARS</p>
          <p className="text-2xl font-bold text-orange-700">
            ${totalPendienteARS.toLocaleString('es-AR', { minimumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-orange-500 mt-0.5">
            {gastos.filter(g => g.estado === 'Pendiente' && g.moneda === 'ARS').length} pago(s) pendiente(s)
          </p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-xs text-blue-600 font-medium mb-1">Comprometido USD</p>
          <p className="text-2xl font-bold text-blue-700">
            U$D {totalPendienteUSD.toLocaleString('es-AR', { minimumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-blue-500 mt-0.5">
            {gastos.filter(g => g.estado === 'Pendiente' && g.moneda === 'USD').length} pago(s) pendiente(s)
          </p>
        </div>
      </div>

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
          <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm bg-white">
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

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Descripción</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Proveedor</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Categoría</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">Monto</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Vencimiento</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gastosFiltrados.map(g => (
                <tr key={g.id} className="hover:bg-slate-50">
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
                    {g.moneda === 'USD' ? 'U$D' : '$'} {g.monto.toLocaleString('es-AR')}
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
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {!readOnly && g.estado === 'Pendiente' && (
                        <button
                          onClick={() => {
                            setPagandoGasto(g)
                            setPagoForm({ cuenta_propia_id: '', fecha_pago: new Date().toISOString().split('T')[0] })
                          }}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors">
                          Registrar pago
                        </button>
                      )}
                      {g.estado === 'Pagado' && g.fecha_pago && (
                        <span className="text-xs text-slate-400">{formatDate(g.fecha_pago)}</span>
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
              ))}
            </tbody>
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
                <strong>{pagandoGasto.moneda === 'USD' ? 'U$D' : '$'} {pagandoGasto.monto.toLocaleString('es-AR')}</strong>
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Cuenta desde la que se pagó *</label>
                <select
                  value={pagoForm.cuenta_propia_id}
                  onChange={e => setPagoForm(f => ({ ...f, cuenta_propia_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">Seleccionar cuenta...</option>
                  {cuentasPropias
                    .filter(c => c.activa && c.moneda === pagandoGasto.moneda)
                    .map(c => (
                      <option key={c.id} value={c.id}>{c.nombre} ({c.moneda})</option>
                    ))}
                  {cuentasPropias.filter(c => c.activa && c.moneda !== pagandoGasto.moneda).length > 0 && (
                    <>
                      <option disabled>── Otra moneda ──</option>
                      {cuentasPropias.filter(c => c.activa && c.moneda !== pagandoGasto.moneda).map(c => (
                        <option key={c.id} value={c.id}>{c.nombre} ({c.moneda})</option>
                      ))}
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de pago *</label>
                <input type="date" value={pagoForm.fecha_pago}
                  onChange={e => setPagoForm(f => ({ ...f, fecha_pago: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setPagandoGasto(null)}
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Monto *</label>
                  <input required type="number" min="0" step="0.01" value={form.monto}
                    onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
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
                <select value={form.proveedor_id}
                  onChange={e => setForm(f => ({ ...f, proveedor_id: e.target.value, cuenta_proveedor_id: '' }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">Sin proveedor</option>
                  {proveedores.filter(p => p.activo).map(p => (
                    <option key={p.id} value={p.id}>{p.razon_social}</option>
                  ))}
                </select>
              </div>

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

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Desglose (opcional)</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input type="number" min="0" step="0.01" value={form.monto_neto} placeholder="Neto"
                    onChange={e => setForm(f => ({ ...f, monto_neto: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <input type="number" min="0" step="0.01" value={form.iva} placeholder="IVA"
                    onChange={e => setForm(f => ({ ...f, iva: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <input type="number" min="0" step="0.01" value={form.percepciones} placeholder="Percepciones"
                    onChange={e => setForm(f => ({ ...f, percepciones: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
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
