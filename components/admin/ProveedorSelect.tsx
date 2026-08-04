'use client'

import { useState } from 'react'
import { crearProveedorRapido } from '@/lib/proveedores'
import type { Proveedor } from '@/types/database'

interface Props {
  // Algunos llamadores (ComprasManager) solo traen id+razon_social del
  // servidor — no hace falta el resto de los campos para renderizar el
  // select, solo para la respuesta del alta rápida (onCreated).
  proveedores: Pick<Proveedor, 'id' | 'razon_social'>[]
  value: string
  onChange: (id: string) => void
  // El padre mantiene la lista de proveedores (viene de props del servidor)
  // — esto le avisa que sume el recién creado, mismo criterio que
  // CuentaPropiaSelect/productosNuevos.
  onCreated?: (proveedor: Proveedor) => void
  constructoraId: string
  required?: boolean
  emptyLabel?: string
  className?: string
}

const EMPTY_FORM = { razon_social: '', cuit: '', telefono: '', email: '', direccion: '', notas: '' }

// Mismos campos que el alta completa en ProveedoresManager.tsx — para no
// dejar un proveedor "a medias" solo por haberlo creado desde acá en vez
// de la sección Proveedores.
export default function ProveedorSelect({
  proveedores, value, onChange, onCreated, constructoraId, required, emptyLabel = 'Sin proveedor', className,
}: Props) {
  const [creando, setCreando] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function cancelar() {
    setCreando(false)
    setForm(EMPTY_FORM)
    setError(null)
  }

  async function crear() {
    if (!form.razon_social.trim()) return
    setLoading(true)
    setError(null)
    const nuevo = await crearProveedorRapido(constructoraId, form)
    setLoading(false)
    if (!nuevo) { setError('Error al crear el proveedor'); return }
    onCreated?.(nuevo)
    onChange(nuevo.id)
    cancelar()
  }

  if (creando) {
    return (
      <div className="space-y-2 border border-indigo-200 rounded-lg p-3 bg-indigo-50/40">
        <input autoFocus value={form.razon_social} onChange={e => setForm(f => ({ ...f, razon_social: e.target.value }))}
          placeholder="Razón social *"
          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <div className="grid grid-cols-2 gap-2">
          <input value={form.cuit} onChange={e => setForm(f => ({ ...f, cuit: e.target.value }))}
            placeholder="CUIT"
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
            placeholder="Teléfono"
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          placeholder="Email"
          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <input value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))}
          placeholder="Dirección"
          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <textarea rows={2} value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
          placeholder="Notas"
          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <div className="flex gap-2">
          <button type="button" onClick={crear} disabled={loading || !form.razon_social.trim()}
            className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:opacity-50">
            {loading ? '...' : 'Crear proveedor'}
          </button>
          <button type="button" onClick={cancelar}
            className="px-3 py-1 border border-slate-300 rounded-lg text-xs text-slate-600">Cancelar</button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    )
  }

  return (
    <select required={required} value={value}
      onChange={e => e.target.value === '__nuevo__' ? setCreando(true) : onChange(e.target.value)}
      className={className ?? 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500'}>
      <option value="">{emptyLabel}</option>
      {proveedores.map(p => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
      <option value="__nuevo__">+ Agregar proveedor nuevo</option>
    </select>
  )
}
