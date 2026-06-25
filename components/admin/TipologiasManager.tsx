'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { uploadToCloudinary, cloudinaryUrl } from '@/lib/cloudinary'
import type { Tipologia } from '@/types/database'

interface Props {
  tipologias: Tipologia[]
}

const EMPTY_FORM = {
  nombre: '',
  m2_propios: '',
  m2_comunes: '',
  descripcion: '',
  url_recorrido_360: '',
  imagen_portada: '',
}

export default function TipologiasManager({ tipologias }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Tipologia | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [uploadingPortada, setUploadingPortada] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewIframe, setPreviewIframe] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function refresh() { startTransition(() => router.refresh()) }

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
    setShowForm(true)
  }

  function openEdit(t: Tipologia) {
    setEditing(t)
    setForm({
      nombre: t.nombre,
      m2_propios: String(t.m2_propios),
      m2_comunes: String(t.m2_comunes),
      descripcion: t.descripcion ?? '',
      url_recorrido_360: t.url_recorrido_360 ?? '',
      imagen_portada: t.imagen_portada ?? '',
    })
    setError(null)
    setShowForm(true)
  }

  function handleChange(field: keyof typeof EMPTY_FORM, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleUploadPortada(file: File) {
    setUploadingPortada(true)
    try {
      const result = await uploadToCloudinary(file, 'tipologias')
      setForm(prev => ({ ...prev, imagen_portada: result.secure_url }))
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al subir imagen')
    } finally {
      setUploadingPortada(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const payload = {
      nombre: form.nombre.trim(),
      m2_propios: parseFloat(form.m2_propios),
      m2_comunes: parseFloat(form.m2_comunes || '0'),
      descripcion: form.descripcion.trim() || null,
      url_recorrido_360: form.url_recorrido_360.trim() || null,
      imagen_portada: form.imagen_portada.trim() || null,
    }

    const { error: err } = editing
      ? await supabase.from('tipologias').update(payload).eq('id', editing.id)
      : await supabase.from('tipologias').insert(payload)

    setLoading(false)
    if (err) { setError(err.message); return }
    setShowForm(false)
    refresh()
  }

  async function handleDelete(id: string, nombre: string) {
    if (!confirm(`¿Eliminar la tipología "${nombre}"? Solo se puede eliminar si no tiene unidades asociadas.`)) return
    const supabase = createClient()
    const { error: err } = await supabase.from('tipologias').delete().eq('id', id)
    if (err) alert(err.message)
    else refresh()
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <p className="text-slate-500 text-sm">{tipologias.length} tipología(s) cargadas</p>
        <button onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500
                     text-white rounded-lg text-sm font-medium transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nueva tipología
        </button>
      </div>

      {/* Grid de tarjetas */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {tipologias.map(t => (
          <div key={t.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {/* Imagen de portada o placeholder */}
            <div className="relative h-40 bg-slate-100 overflow-hidden">
              {t.imagen_portada ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cloudinaryUrl(t.imagen_portada, 400)}
                  alt={t.nombre}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <p className="text-xs text-slate-400">Sin imagen de portada</p>
                </div>
              )}
              {/* Overlay botón 360 */}
              {t.url_recorrido_360 && (
                <button
                  onClick={() => setPreviewIframe(t.url_recorrido_360)}
                  className="absolute bottom-2 right-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                             bg-black/60 text-white text-xs hover:bg-black/80 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  </svg>
                  360°
                </button>
              )}
            </div>

            <div className="p-4">
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-semibold text-slate-900">{t.nombre}</h3>
                <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                  {t.m2_totales} m² tot.
                </span>
              </div>
              <div className="flex gap-3 text-xs text-slate-500 mb-2">
                <span>{t.m2_propios} m² propios</span>
                <span>·</span>
                <span>{t.m2_comunes} m² comunes</span>
              </div>
              {t.descripcion && (
                <p className="text-xs text-slate-500 mb-3 line-clamp-2">{t.descripcion}</p>
              )}
              <div className="flex gap-2 pt-3 border-t border-slate-100">
                <button onClick={() => openEdit(t)}
                  className="flex-1 text-xs text-slate-600 hover:text-indigo-600 font-medium transition-colors">
                  Editar
                </button>
                <span className="text-slate-200">|</span>
                <button onClick={() => handleDelete(t.id, t.nombre)}
                  className="flex-1 text-xs text-red-400 hover:text-red-600 font-medium transition-colors">
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {tipologias.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <p className="mb-2">No hay tipologías cargadas.</p>
          <button onClick={openNew} className="text-indigo-500 text-sm hover:text-indigo-700">
            Crear la primera tipología
          </button>
        </div>
      )}

      {/* Modal formulario */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">
                {editing ? 'Editar tipología' : 'Nueva tipología'}
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
                <input required value={form.nombre} onChange={e => handleChange('nombre', e.target.value)}
                  placeholder="Ej: Monoambiente, 2 Ambientes, Loft..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">m² propios *</label>
                  <input required type="number" step="0.01" min="0" value={form.m2_propios}
                    onChange={e => handleChange('m2_propios', e.target.value)}
                    placeholder="48.50"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">m² comunes</label>
                  <input type="number" step="0.01" min="0" value={form.m2_comunes}
                    onChange={e => handleChange('m2_comunes', e.target.value)}
                    placeholder="12.00"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>

              {form.m2_propios && (
                <p className="text-xs text-slate-400 -mt-2">
                  Total: {(parseFloat(form.m2_propios || '0') + parseFloat(form.m2_comunes || '0')).toFixed(2)} m²
                </p>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Descripción</label>
                <textarea rows={2} value={form.descripcion} onChange={e => handleChange('descripcion', e.target.value)}
                  placeholder="Living comedor + 1 dormitorio en suite..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  URL recorrido 360°
                  <span className="ml-1 font-normal text-slate-400">(Kuula, Matterport, Panoee...)</span>
                </label>
                <input value={form.url_recorrido_360} onChange={e => handleChange('url_recorrido_360', e.target.value)}
                  placeholder="https://kuula.co/share/..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <p className="text-xs text-slate-400 mt-1">
                  URL de embed del recorrido virtual — se muestra como iframe en la landing.
                </p>
              </div>

              {/* Imagen de portada */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">Imagen de portada</label>
                {form.imagen_portada ? (
                  <div className="relative mb-2 rounded-xl overflow-hidden border border-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={cloudinaryUrl(form.imagen_portada, 480)}
                      alt="Portada" className="w-full h-36 object-cover" />
                    <button type="button"
                      onClick={() => handleChange('imagen_portada', '')}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
                      ✕
                    </button>
                  </div>
                ) : (
                  <button type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingPortada}
                    className="w-full h-24 border-2 border-dashed border-slate-300 rounded-xl text-slate-400
                               hover:border-indigo-400 hover:text-indigo-500 transition-colors text-sm
                               flex items-center justify-center gap-2 disabled:opacity-50">
                    {uploadingPortada ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        Subiendo...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Subir imagen de portada (render, foto...)
                      </>
                    )}
                  </button>
                )}
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) handleUploadPortada(file)
                    e.target.value = ''
                  }} />
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
                  {loading ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear tipología'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal preview iframe 360 */}
      {previewIframe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
          onClick={() => setPreviewIframe(null)}>
          <div className="w-full max-w-4xl aspect-video rounded-xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <iframe src={previewIframe} className="w-full h-full" allowFullScreen
              allow="xr-spatial-tracking; gyroscope; accelerometer" />
          </div>
          <button onClick={() => setPreviewIframe(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
