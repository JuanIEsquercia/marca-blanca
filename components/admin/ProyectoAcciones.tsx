'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { EstadoObra } from '@/types/database'

interface Props {
  obraId: string
  nombre: string
  estadoActual: EstadoObra
}

const PUEDE_REACTIVAR: EstadoObra[] = ['finalizada', 'pausada']

export default function ProyectoAcciones({ obraId, nombre, estadoActual }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmCierre, setConfirmCierre] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  function refresh() { startTransition(() => router.refresh()) }

  async function cambiarEstado(nuevoEstado: EstadoObra) {
    setLoading(true)
    const supabase = createClient()
    await supabase.from('obras').update({ estado: nuevoEstado }).eq('id', obraId)
    setLoading(false)
    setOpen(false)
    setConfirmCierre(false)
    refresh()
  }

  async function eliminar() {
    setLoading(true)
    const supabase = createClient()
    await supabase.from('obras').delete().eq('id', obraId)
    setLoading(false)
    setConfirmDelete(false)
    refresh()
  }

  return (
    <>
      {/* Botón de 3 puntos — stop propagation para no activar el Link padre */}
      <div ref={ref} className="relative" onClick={e => e.preventDefault()}>
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(v => !v) }}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          title="Acciones del proyecto">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 top-8 z-30 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-44 text-sm">
            {estadoActual === 'activa' && (
              <button
                onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(false); setConfirmCierre(true) }}
                className="w-full text-left px-4 py-2 hover:bg-slate-50 text-slate-700">
                Cerrar proyecto
              </button>
            )}
            {PUEDE_REACTIVAR.includes(estadoActual) && (
              <button
                onClick={e => { e.preventDefault(); e.stopPropagation(); cambiarEstado('activa') }}
                className="w-full text-left px-4 py-2 hover:bg-emerald-50 text-emerald-700">
                Reactivar
              </button>
            )}
            <div className="border-t border-slate-100 my-1" />
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(false); setConfirmDelete(true) }}
              className="w-full text-left px-4 py-2 hover:bg-red-50 text-red-600">
              Eliminar
            </button>
          </div>
        )}
      </div>

      {/* Modal: confirmar cierre */}
      {confirmCierre && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={e => e.preventDefault()}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Cerrar proyecto</h2>
            <p className="text-sm text-slate-600 mb-6">
              ¿Marcar <strong>{nombre}</strong> como finalizado? El proyecto quedará de solo lectura.
              Podés reactivarlo en cualquier momento.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmCierre(false)}
                className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={() => cambiarEstado('finalizada')} disabled={loading}
                className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                {loading ? 'Cerrando...' : 'Cerrar proyecto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: confirmar eliminación */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={e => e.preventDefault()}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Eliminar proyecto</h2>
            <p className="text-sm text-slate-600 mb-1">
              ¿Eliminar <strong>{nombre}</strong>? Esta acción eliminará todos sus datos:
            </p>
            <ul className="text-xs text-slate-500 mb-6 list-disc list-inside space-y-0.5">
              <li>Contratos, certificados y cobros</li>
              <li>Unidades, tipologías y ventas</li>
              <li>Gastos y cuentas propias del proyecto</li>
            </ul>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(false)}
                className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={eliminar} disabled={loading}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                {loading ? 'Eliminando...' : 'Eliminar definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
