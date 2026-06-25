'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { Proveedor, CuentaProveedor } from '@/types/database'

interface Props {
  proveedores: Proveedor[]
}

const EMPTY_PROV = { razon_social: '', cuit: '', email: '', telefono: '', direccion: '', notas: '' }
const EMPTY_CTA = { tipo: 'CBU', denominacion: '', numero: '', moneda: 'ARS' }
const TIPOS_CTA = ['CBU', 'Alias', 'Efectivo', 'Cheque', 'Otro']

export default function ProveedoresManager({ proveedores }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showProv, setShowProv] = useState(false)
  const [editingProv, setEditingProv] = useState<Proveedor | null>(null)
  const [formProv, setFormProv] = useState(EMPTY_PROV)
  const [loadingProv, setLoadingProv] = useState(false)
  const [errorProv, setErrorProv] = useState<string | null>(null)

  // Cuenta proveedor form
  const [showCta, setShowCta] = useState<string | null>(null) // proveedor_id
  const [editingCta, setEditingCta] = useState<CuentaProveedor | null>(null)
  const [formCta, setFormCta] = useState(EMPTY_CTA)
  const [loadingCta, setLoadingCta] = useState(false)

  function refresh() { startTransition(() => router.refresh()) }

  // ── Proveedores ───────────────────────────────────────────

  function openNewProv() {
    setEditingProv(null)
    setFormProv(EMPTY_PROV)
    setErrorProv(null)
    setShowProv(true)
  }

  function openEditProv(p: Proveedor) {
    setEditingProv(p)
    setFormProv({
      razon_social: p.razon_social,
      cuit: p.cuit ?? '',
      email: p.email ?? '',
      telefono: p.telefono ?? '',
      direccion: p.direccion ?? '',
      notas: p.notas ?? '',
    })
    setErrorProv(null)
    setShowProv(true)
  }

  async function handleSubmitProv(e: React.FormEvent) {
    e.preventDefault()
    setErrorProv(null)
    setLoadingProv(true)
    const supabase = createClient()
    const payload = {
      razon_social: formProv.razon_social.trim(),
      cuit: formProv.cuit.trim() || null,
      email: formProv.email.trim() || null,
      telefono: formProv.telefono.trim() || null,
      direccion: formProv.direccion.trim() || null,
      notas: formProv.notas.trim() || null,
    }
    const { error } = editingProv
      ? await supabase.from('proveedores').update(payload).eq('id', editingProv.id)
      : await supabase.from('proveedores').insert(payload)
    setLoadingProv(false)
    if (error) { setErrorProv(error.message); return }
    setShowProv(false)
    refresh()
  }

  async function handleToggleActivo(p: Proveedor) {
    const supabase = createClient()
    await supabase.from('proveedores').update({ activo: !p.activo }).eq('id', p.id)
    refresh()
  }

  async function handleDeleteProv(p: Proveedor) {
    if (!confirm(`¿Eliminar "${p.razon_social}"? Se eliminarán también sus cuentas.`)) return
    const supabase = createClient()
    await supabase.from('proveedores').delete().eq('id', p.id)
    if (expanded === p.id) setExpanded(null)
    refresh()
  }

  // ── Cuentas proveedor ─────────────────────────────────────

  function openNewCta(proveedorId: string) {
    setEditingCta(null)
    setFormCta(EMPTY_CTA)
    setShowCta(proveedorId)
  }

  function openEditCta(cta: CuentaProveedor) {
    setEditingCta(cta)
    setFormCta({
      tipo: cta.tipo,
      denominacion: cta.denominacion ?? '',
      numero: cta.numero ?? '',
      moneda: cta.moneda,
    })
    setShowCta(cta.proveedor_id)
  }

  async function handleSubmitCta(e: React.FormEvent) {
    e.preventDefault()
    setLoadingCta(true)
    const supabase = createClient()
    const payload = {
      proveedor_id: showCta!,
      tipo: formCta.tipo,
      denominacion: formCta.denominacion.trim() || null,
      numero: formCta.numero.trim() || null,
      moneda: formCta.moneda,
    }
    const { error } = editingCta
      ? await supabase.from('cuentas_proveedor').update(payload).eq('id', editingCta.id)
      : await supabase.from('cuentas_proveedor').insert(payload)
    setLoadingCta(false)
    if (error) return
    setShowCta(null)
    setEditingCta(null)
    refresh()
  }

  async function handleDeleteCta(id: string) {
    if (!confirm('¿Eliminar esta cuenta?')) return
    const supabase = createClient()
    await supabase.from('cuentas_proveedor').delete().eq('id', id)
    refresh()
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <p className="text-slate-500 text-sm">{proveedores.length} proveedor(es)</p>
        <button onClick={openNewProv}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500
                     text-white rounded-lg text-sm font-medium transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuevo proveedor
        </button>
      </div>

      <div className="space-y-2">
        {proveedores.map(p => (
          <div key={p.id} className={cn(
            'bg-white border border-slate-200 rounded-xl overflow-hidden',
            !p.activo && 'opacity-60'
          )}>
            {/* Fila principal */}
            <div className="flex items-center gap-4 px-5 py-4">
              <button
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                className="flex-1 text-left min-w-0"
              >
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-900">{p.razon_social}</p>
                  {!p.activo && (
                    <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Inactivo</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {[p.cuit, p.email, p.telefono].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {p.cuentas_proveedor?.length ?? 0} cuenta(s) de cobro
                </p>
              </button>

              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => openEditProv(p)}
                  className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-600
                             hover:border-indigo-300 hover:text-indigo-600 transition-colors">
                  Editar
                </button>
                <button onClick={() => handleToggleActivo(p)}
                  className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-600
                             hover:border-slate-300 transition-colors">
                  {p.activo ? 'Desactivar' : 'Activar'}
                </button>
                <button onClick={() => handleDeleteProv(p)}
                  className="text-xs text-red-400 hover:text-red-600 px-1 transition-colors">✕</button>
                <svg
                  className={cn('w-4 h-4 text-slate-400 transition-transform', expanded === p.id && 'rotate-180')}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Cuentas de cobro (expandible) */}
            {expanded === p.id && (
              <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
                <div className="flex justify-between items-center mb-3">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Cuentas de cobro</p>
                  <button onClick={() => openNewCta(p.id)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                    + Agregar cuenta
                  </button>
                </div>

                {p.cuentas_proveedor && p.cuentas_proveedor.length > 0 ? (
                  <div className="space-y-2">
                    {p.cuentas_proveedor.map(cta => (
                      <div key={cta.id}
                        className="flex items-center justify-between bg-white border border-slate-200
                                   rounded-lg px-4 py-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-indigo-600 bg-indigo-50
                                            px-2 py-0.5 rounded-full">
                              {cta.tipo}
                            </span>
                            <span className="text-xs text-slate-500">{cta.moneda}</span>
                            {cta.denominacion && (
                              <span className="text-sm text-slate-700">{cta.denominacion}</span>
                            )}
                          </div>
                          {cta.numero && (
                            <p className="text-xs text-slate-500 mt-1 font-mono">{cta.numero}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => openEditCta(cta)}
                            className="text-xs text-slate-500 hover:text-indigo-600 transition-colors">
                            Editar
                          </button>
                          <button onClick={() => handleDeleteCta(cta.id)}
                            className="text-xs text-red-400 hover:text-red-600 transition-colors">✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 text-center py-4">
                    Sin cuentas. <button onClick={() => openNewCta(p.id)} className="text-indigo-500 hover:underline">Agregar una</button>
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {proveedores.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <p className="mb-2">No hay proveedores cargados aún.</p>
          <button onClick={openNewProv} className="text-indigo-500 text-sm hover:text-indigo-700">
            Crear el primero
          </button>
        </div>
      )}

      {/* Modal Proveedor */}
      {showProv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">
                {editingProv ? 'Editar proveedor' : 'Nuevo proveedor'}
              </h2>
              <button onClick={() => setShowProv(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmitProv} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Razón social *</label>
                <input required value={formProv.razon_social}
                  onChange={e => setFormProv(f => ({ ...f, razon_social: e.target.value }))}
                  placeholder="Nombre o empresa..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">CUIT</label>
                  <input value={formProv.cuit} onChange={e => setFormProv(f => ({ ...f, cuit: e.target.value }))}
                    placeholder="20-12345678-9"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
                  <input value={formProv.telefono} onChange={e => setFormProv(f => ({ ...f, telefono: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input type="email" value={formProv.email}
                  onChange={e => setFormProv(f => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Dirección</label>
                <input value={formProv.direccion} onChange={e => setFormProv(f => ({ ...f, direccion: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notas</label>
                <textarea rows={2} value={formProv.notas}
                  onChange={e => setFormProv(f => ({ ...f, notas: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>

              {errorProv && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{errorProv}</div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowProv(false)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                  Cancelar
                </button>
                <button type="submit" disabled={loadingProv}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loadingProv ? 'Guardando...' : editingProv ? 'Guardar' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Cuenta Proveedor */}
      {showCta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">
                {editingCta ? 'Editar cuenta' : 'Nueva cuenta de cobro'}
              </h2>
              <button onClick={() => { setShowCta(null); setEditingCta(null) }}
                className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmitCta} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tipo *</label>
                  <select value={formCta.tipo} onChange={e => setFormCta(f => ({ ...f, tipo: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    {TIPOS_CTA.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Moneda</label>
                  <select value={formCta.moneda} onChange={e => setFormCta(f => ({ ...f, moneda: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option>ARS</option>
                    <option>USD</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Denominación</label>
                <input value={formCta.denominacion}
                  onChange={e => setFormCta(f => ({ ...f, denominacion: e.target.value }))}
                  placeholder="Ej: Banco Galicia cta. cte."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {formCta.tipo === 'CBU' ? 'CBU' : formCta.tipo === 'Alias' ? 'Alias' : 'Número / referencia'}
                </label>
                <input value={formCta.numero}
                  onChange={e => setFormCta(f => ({ ...f, numero: e.target.value }))}
                  placeholder={formCta.tipo === 'CBU' ? '22 dígitos...' : formCta.tipo === 'Alias' ? 'alias.banco.mp' : ''}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowCta(null); setEditingCta(null) }}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                  Cancelar
                </button>
                <button type="submit" disabled={loadingCta}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loadingCta ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
