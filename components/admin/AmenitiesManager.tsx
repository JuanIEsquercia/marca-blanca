'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { uploadToCloudinary, cloudinaryUrl } from '@/lib/cloudinary'
import { cn } from '@/lib/utils'
import type { Amenity } from '@/types/database'
import ConfirmModal from './ConfirmModal'

type ConfirmModalState = { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> }

interface Props {
  amenities: Amenity[]
  obraId: string
  constructoraId: string
  readOnly?: boolean
}

const MAX_IMAGENES = 5
const EMPTY_FORM = { nombre: '', descripcion: '', orden: '0' }

export default function AmenitiesManager({ amenities, obraId, constructoraId, readOnly = false }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Amenity | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadTarget, setUploadTarget] = useState<string | null>(null)
  const [draggingOver, setDraggingOver] = useState<string | null>(null)

  function refresh() { startTransition(() => router.refresh()) }

  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, orden: String(amenities.length) })
    setError(null)
    setShowForm(true)
  }

  function openEdit(a: Amenity) {
    setEditing(a)
    setForm({ nombre: a.nombre, descripcion: a.descripcion ?? '', orden: String(a.orden) })
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
      orden: parseInt(form.orden || '0'),
    }
    const { error: err } = editing
      ? await supabase.from('amenities').update(payload).eq('id', editing.id)
      : await supabase.from('amenities').insert({ ...payload, obra_id: obraId, constructora_id: constructoraId })
    setLoading(false)
    if (err) { setError(err.message); return }
    setShowForm(false)
    refresh()
  }

  function handleDelete(id: string, nombre: string) {
    setConfirmModal({
      title: 'Eliminar amenity',
      message: `¿Eliminar "${nombre}"? Se eliminarán sus registros de imágenes.`,
      confirmLabel: 'Eliminar',
      onConfirm: async () => {
        const supabase = createClient()
        await supabase.from('amenities').delete().eq('id', id)
        setConfirmModal(null)
        refresh()
      },
    })
  }

  async function handleToggleActivo(id: string, activo: boolean) {
    const supabase = createClient()
    await supabase.from('amenities').update({ activo: !activo }).eq('id', id)
    refresh()
  }

  async function uploadImagen(amenityId: string, file: File) {
    const amenity = amenities.find(a => a.id === amenityId)
    const count = amenity?.amenity_imagenes?.length ?? 0
    if (count >= MAX_IMAGENES) return

    setUploadingId(amenityId)
    try {
      const result = await uploadToCloudinary(file, 'amenities')
      const supabase = createClient()
      await supabase.from('amenity_imagenes').insert({
        amenity_id: amenityId,
        url: result.secure_url,
        alt: null,
        orden: count,
      })
      refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al subir imagen')
    } finally {
      setUploadingId(null)
    }
  }

  function handleDeleteImagen(imagenId: string) {
    setConfirmModal({
      title: 'Eliminar imagen',
      message: '¿Eliminar esta imagen?',
      confirmLabel: 'Eliminar',
      onConfirm: async () => {
        const supabase = createClient()
        await supabase.from('amenity_imagenes').delete().eq('id', imagenId)
        setConfirmModal(null)
        refresh()
      },
    })
  }

  function triggerUpload(amenityId: string) {
    setUploadTarget(amenityId)
    fileInputRef.current?.click()
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <p className="text-slate-500 text-sm">
          {amenities.length} amenity(s) · cada uno soporta hasta {MAX_IMAGENES} fotos
        </p>
        {!readOnly && (
          <button onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500
                       text-white rounded-lg text-sm font-medium transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nuevo amenity
          </button>
        )}
      </div>

      <div className="space-y-3">
        {amenities.map(a => {
          const imagenes = [...(a.amenity_imagenes ?? [])].sort((x, y) => x.orden - y.orden)
          const imageCount = imagenes.length
          const atLimit = imageCount >= MAX_IMAGENES
          const isUploading = uploadingId === a.id
          const portada = imagenes[0]

          return (
            <div key={a.id} className={cn(
              'bg-white border border-slate-200 rounded-xl overflow-hidden',
              !a.activo && 'opacity-60'
            )}>
              {/* Cabecera */}
              <div className="flex items-center gap-4 p-4">
                {/* Thumbnail portada */}
                <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 bg-slate-100 border border-slate-200">
                  {portada ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={cloudinaryUrl(portada.url, 80)}
                      alt={a.nombre}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900">{a.nombre}</p>
                    {!a.activo && (
                      <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Oculto</span>
                    )}
                  </div>
                  {a.descripcion && <p className="text-sm text-slate-500 truncate">{a.descripcion}</p>}
                  <p className="text-xs mt-0.5">
                    <span className={cn(
                      'font-medium',
                      atLimit ? 'text-amber-600' : 'text-slate-400'
                    )}>
                      {imageCount}/{MAX_IMAGENES} fotos
                    </span>
                    <span className="text-slate-300 mx-1">·</span>
                    <span className="text-slate-400">Orden: {a.orden}</span>
                  </p>
                </div>

                {!readOnly && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => triggerUpload(a.id)}
                      disabled={isUploading || atLimit}
                      title={atLimit ? `Máximo ${MAX_IMAGENES} fotos por amenity` : 'Agregar foto'}
                      className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-600
                                 hover:border-indigo-300 hover:text-indigo-600 transition-colors
                                 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isUploading ? (
                        <span className="flex items-center gap-1">
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                          Subiendo...
                        </span>
                      ) : atLimit ? `${MAX_IMAGENES}/${MAX_IMAGENES}` : '+ Foto'}
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
                )}
              </div>

              {/* Galería de fotos */}
              {imageCount > 0 ? (
                <div className="flex gap-2 px-4 pb-4 overflow-x-auto">
                  {imagenes.map((img, idx) => (
                    <div key={img.id} className="relative shrink-0 group">
                      {idx === 0 && (
                        <span className="absolute top-1.5 left-1.5 z-10 text-[10px] font-bold
                                         bg-black/50 text-white px-1.5 py-0.5 rounded">
                          Portada
                        </span>
                      )}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={cloudinaryUrl(img.url, 240)}
                        alt={img.alt ?? a.nombre}
                        className="w-36 h-24 object-cover rounded-lg border border-slate-200"
                      />
                      {!readOnly && (
                        <button
                          onClick={() => handleDeleteImagen(img.id)}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white
                                     text-xs hidden group-hover:flex items-center justify-center shadow"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Slot vacío para subir si no está al límite */}
                  {!atLimit && !readOnly && (
                    <button
                      onClick={() => triggerUpload(a.id)}
                      disabled={isUploading}
                      onDragOver={e => { e.preventDefault(); setDraggingOver(a.id) }}
                      onDragLeave={() => setDraggingOver(null)}
                      onDrop={e => {
                        e.preventDefault()
                        setDraggingOver(null)
                        const file = e.dataTransfer.files[0]
                        if (file) uploadImagen(a.id, file)
                      }}
                      className={cn(
                        'w-36 h-24 shrink-0 rounded-lg border-2 border-dashed flex flex-col items-center justify-center',
                        'text-slate-400 text-xs gap-1 transition-colors',
                        draggingOver === a.id
                          ? 'border-indigo-400 bg-indigo-50 text-indigo-500'
                          : 'border-slate-200 hover:border-indigo-300 hover:text-indigo-500'
                      )}
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                      </svg>
                      Agregar foto
                    </button>
                  )}
                </div>
              ) : !readOnly ? (
                /* Drop zone vacío */
                <button
                  onClick={() => triggerUpload(a.id)}
                  disabled={isUploading}
                  onDragOver={e => { e.preventDefault(); setDraggingOver(a.id) }}
                  onDragLeave={() => setDraggingOver(null)}
                  onDrop={e => {
                    e.preventDefault()
                    setDraggingOver(null)
                    const file = e.dataTransfer.files[0]
                    if (file) uploadImagen(a.id, file)
                  }}
                  className={cn(
                    'w-full px-4 pb-4',
                    'block'
                  )}
                >
                  <div className={cn(
                    'h-20 rounded-xl border-2 border-dashed flex items-center justify-center gap-2',
                    'text-sm transition-colors',
                    draggingOver === a.id
                      ? 'border-indigo-400 bg-indigo-50 text-indigo-600'
                      : 'border-slate-200 text-slate-400 hover:border-indigo-300 hover:text-indigo-500'
                  )}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Arrastrá o hacé clic para subir fotos (máx. {MAX_IMAGENES})
                  </div>
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      {amenities.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <p className="mb-2">No hay amenities cargados aún.</p>
          {!readOnly && (
            <button onClick={openNew} className="text-indigo-500 text-sm hover:text-indigo-700">
              Crear el primero
            </button>
          )}
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
          if (file && uploadTarget) uploadImagen(uploadTarget, file)
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
                <p className="text-xs text-slate-400 mt-1">Número menor = aparece primero en la landing</p>
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
