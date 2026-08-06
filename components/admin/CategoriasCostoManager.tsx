'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { CategoriaCosto } from '@/types/database'

interface Props {
  categorias: Pick<CategoriaCosto, 'id' | 'nombre' | 'color'>[]
  constructoraId: string
  onChanged: () => void
}

const PRESET_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444',
  '#3b82f6', '#8b5cf6', '#f97316', '#14b8a6',
]

// Botón + modal autocontenidos — antes solo existía en Gastos, y Compras
// (categoría de un producto) no tenía forma de crear una categoría nueva
// sin salir a Gastos. Mismo CRUD, ahora compartido entre los dos módulos.
export default function CategoriasCostoManager({ categorias, constructoraId, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ nombre: '', color: PRESET_COLORS[0] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nombre.trim()) return
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.from('categorias_costo').insert({
      nombre: form.nombre.trim(),
      color: form.color,
      constructora_id: constructoraId,
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setForm({ nombre: '', color: PRESET_COLORS[0] })
    onChanged()
  }

  async function eliminar(id: string) {
    const supabase = createClient()
    const { error: err } = await supabase.from('categorias_costo').delete().eq('id', id)
    if (err) { setError(err.message); return }
    onChanged()
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50
                   text-slate-700 rounded-lg text-sm font-medium transition-colors whitespace-nowrap">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
        Categorías
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="font-bold text-slate-900">Administrar categorías</h2>
                <p className="text-xs text-slate-500 mt-0.5">Tipos de gasto para clasificar egresos</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

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
                    onClick={() => eliminar(cat.id)}
                    className="text-xs text-red-400 hover:text-red-600 transition-colors px-1"
                    title="Eliminar categoría"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
              <form onSubmit={crear} className="space-y-3">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Nueva categoría</p>
                <div className="flex gap-2">
                  <input
                    required
                    placeholder="Ej: Materiales, Honorarios, Servicios..."
                    value={form.nombre}
                    onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
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
                        onClick={() => setForm(f => ({ ...f, color: c }))}
                        className={cn(
                          'w-6 h-6 rounded-full border-2 transition-transform',
                          form.color === c ? 'border-slate-900 scale-110' : 'border-transparent'
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || !form.nombre.trim()}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                             text-white rounded-lg text-sm font-semibold transition-colors"
                >
                  {loading ? 'Creando...' : 'Crear categoría'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
