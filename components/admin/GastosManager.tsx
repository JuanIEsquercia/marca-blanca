'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { uploadToCloudinary } from '@/lib/cloudinary'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import type { Gasto, Proveedor, CuentaProveedor, CategoriaCosto, CuentaPropia } from '@/types/database'

interface Props {
  gastos: Gasto[]
  proveedores: Proveedor[]
  categorias: CategoriaCosto[]
  cuentasPropias: CuentaPropia[]
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
}

export default function GastosManager({ gastos, proveedores, categorias, cuentasPropias }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
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
    })
    setComprobanteUrl(g.comprobante_url ?? '')
    setError(null)
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
    }
    const { error: err } = editingId
      ? await supabase.from('gastos').update(payload).eq('id', editingId)
      : await supabase.from('gastos').insert(payload)
    setLoading(false)
    if (err) { setError(err.message); return }
    setShowForm(false)
    refresh()
  }

  async function handleDelete(g: Gasto) {
    if (!confirm(`¿Eliminar "${g.descripcion}"?`)) return
    const supabase = createClient()
    await supabase.from('gastos').delete().eq('id', g.id)
    refresh()
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
      <div className="grid grid-cols-2 gap-4 mb-6">
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
      <div className="flex gap-3 mb-5">
        <input
          placeholder="Buscar por descripción o proveedor..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
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
        <button onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500
                     text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuevo gasto
        </button>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
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
                    {g.estado === 'Pendiente' && (
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
                    <button onClick={() => openEdit(g)}
                      className="text-xs text-slate-400 hover:text-slate-700 transition-colors">Editar</button>
                    <button onClick={() => handleDelete(g)}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors">✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Descripción *</label>
                <input required value={form.descripcion}
                  onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Ej: Compra de hierro ø12, Honorarios arq. mayo..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
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

              <div className="grid grid-cols-2 gap-3">
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
    </div>
  )
}
