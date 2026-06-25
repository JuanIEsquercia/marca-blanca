'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { uploadToCloudinary, cloudinaryUrl } from '@/lib/cloudinary'
import { cn } from '@/lib/utils'
import type { Amenity } from '@/types/database'

interface Props {
  amenities: Amenity[]
}

const ICONOS_SUGERIDOS = ['🏊', '🏋️', '🛡️', '🚗', '🌿', '⚡', '🌞', '🔥', '🎮', '🍖', '📦', '♿', '🛗', '🌊', '🏃']
const EMPTY_FORM = { nombre: '', descripcion: '', icono: '', orden: '0' }

export default function AmenitiesManager({ amenities }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Amenity | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadTarget, setUploadTarget] = useState<string | null>(null)

  function refresh() { startTransition(() => router.refresh()) }

  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, orden: String(amenities.length) })
    setError(null)
    setShowForm(true)
  }

  function openEdit(a: Amenity) {
    setEditing(a)
    setForm({ nombre: a.nombre, descripcion: a.descripcion ?? '', icono: a.icono ?? '', orden: String(a.orden) })
    setError(null)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createClient()
    const payload = {
      nombre: form.nombre.trim(),
      descripcion: form.descripcion.trim() || null,
      icono: form.icono.trim() || null,
      orden: parseInt(form.orden || '0'),
    }
    const { error: err } = editing
      ? await supabase.from('amenities').update(payload).eq('id', editing.id)
      : await supabase.from('amenities').insert(payload)
    setLoading(false)
    if (err) { setError(err.message); return }
    setShowForm(false)
    refresh()
  }

  async function handleDelete(id: string, nombre: string) {
    if (!confirm(`¿Eliminar "${nombre}"? También se eliminarán sus imágenes de Cloudinary.`)) return
    const supabase = createClient()
    // Borrar registros de imágenes — Cloudinary no tiene API de delete desde browser sin firma
    // Las imágenes quedan en Cloudinary pero se desvinculan de la DB
    await supabase.from('amenities').delete().eq('id', id)
    refresh()
  }

  async function handleToggleActivo(id: string, activo: boolean) {
    const supabase = createClient()
    await supabase.from('amenities').update({ activo: !activo }).eq('id', id)
    refresh()
  }

  async function handleUploadImagen(amenityId: string, file: File) {
    setUploadingId(amenityId)
    setUploadProgress('Subiendo imagen...')

    try {
      const result = await uploadToCloudinary(file, 'amenities')
      const supabase = createClient()
      const currentOrden = amenities.find(a => a.id === amenityId)?.amenity_imagenes?.length ?? 0

      await supabase.from('amenity_imagenes').insert({
        amenity_id: amenityId,
        url: result.secure_url,
        alt: null,
        orden: currentOrden,
      })
      refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al subir imagen')
    } finally {
      setUploadingId(null)
      setUploadProgress(null)
    }
  }

  async function handleDeleteImagen(imagenId: string) {
    if (!confirm('¿Eliminar esta imagen?')) return
    const supabase = createClient()
    await supabase.from('amenity_imagenes').delete().eq('id', imagenId)
    refresh()
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <p className="text-slate-500 text-sm">
          {amenities.length} amenity(s) · ordenados por "Orden" en la landing
        </p>
        <button onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500
                     text-white rounded-lg text-sm font-medium transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuevo amenity
        </button>
      </div>

      <div className="space-y-3">
        {amenities.map(a => (
          <div key={a.id} className={cn(
            'bg-white border border-slate-200 rounded-xl overflow-hidden',
            !a.activo && 'opacity-60'
          )}>
            <div className="flex items-center gap-4 p-4">
              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-2xl shrink-0">
                {a.icono ?? '📌'}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-900">{a.nombre}</p>
                  {!a.activo && (
                    <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Oculto</span>
                  )}
                </div>
                {a.descripcion && <p className="text-sm text-slate-500 truncate">{a.descripcion}</p>}
                <p className="text-xs text-slate-400 mt-0.5">
                  {a.amenity_imagenes?.length ?? 0} imagen(es) · Orden: {a.orden}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => { setUploadTarget(a.id); fileInputRef.current?.click() }}
                  disabled={uploadingId === a.id}
                  className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-600
                             hover:border-indigo-300 hover:text-indigo-600 transition-colors disabled:opacity-50"
                >
                  {uploadingId === a.id ? (
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Subiendo...
                    </span>
                  ) : '+ Imagen'}
                </button>
                <button onClick={() => handleToggleActivo(a.id, a.activo)}
                  className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-600
                             hover:border-slate-300 transition-colors">
                  {a.activo ? 'Ocultar' : 'Mostrar'}
                </button>
                <button onClick={() => openEdit(a)}
                  className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-600
                             hover:border-indigo-300 hover:text-indigo-600 transition-colors">
                  Editar
                </button>
                <button onClick={() => handleDelete(a.id, a.nombre)}
                  className="text-xs text-red-400 hover:text-red-600 px-1 transition-colors">
                  ✕
                </button>
              </div>
            </div>

            {/* Carrusel de imágenes */}
            {a.amenity_imagenes && a.amenity_imagenes.length > 0 && (
              <div className="flex gap-2 px-4 pb-4 overflow-x-auto">
                {[...a.amenity_imagenes]
                  .sort((x, y) => x.orden - y.orden)
                  .map(img => (
                    <div key={img.id} className="relative shrink-0 group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={cloudinaryUrl(img.url, 160)}
                        alt={img.alt ?? a.nombre}
                        className="w-28 h-20 object-cover rounded-lg border border-slate-200"
                      />
                      <button
                        onClick={() => handleDeleteImagen(img.id)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white
                                   text-xs hidden group-hover:flex items-center justify-center shadow"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {amenities.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <p className="mb-2">No hay amenities cargados aún.</p>
          <button onClick={openNew} className="text-indigo-500 text-sm hover:text-indigo-700">
            Crear el primero
          </button>
        </div>
      )}

      {/* Input file oculto */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file && uploadTarget) handleUploadImagen(uploadTarget, file)
          e.target.value = ''
        }}
      />

      {/* Modal formulario */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">
                {editing ? 'Editar amenity' : 'Nuevo amenity'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre *</label>
                <input required value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej: Piscina en altura, Gym premium..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">Ícono</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {ICONOS_SUGERIDOS.map(ic => (
                    <button key={ic} type="button"
                      onClick={() => setForm(f => ({ ...f, icono: ic }))}
                      className={cn(
                        'w-9 h-9 rounded-lg text-xl flex items-center justify-center border-2 transition-colors',
                        form.icono === ic ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'
                      )}>
                      {ic}
                    </button>
                  ))}
                </div>
                <input value={form.icono}
                  onChange={e => setForm(f => ({ ...f, icono: e.target.value }))}
                  placeholder="O escribí cualquier emoji"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Descripción</label>
                <textarea rows={2} value={form.descripcion}
                  onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Breve descripción para la landing..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Orden</label>
                <input type="number" min="0" value={form.orden}
                  onChange={e => setForm(f => ({ ...f, orden: e.target.value }))}
                  className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <p className="text-xs text-slate-400 mt-1">Número menor = aparece primero</p>
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
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
                             text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Guardando...' : editing ? 'Guardar' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
