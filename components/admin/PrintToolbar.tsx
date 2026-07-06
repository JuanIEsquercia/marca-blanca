'use client'

import { useEffect } from 'react'

interface Props {
  title: string
  autoPrint?: boolean
}

export default function PrintToolbar({ title, autoPrint = true }: Props) {
  useEffect(() => {
    if (!autoPrint) return
    const t = setTimeout(() => window.print(), 600)
    return () => clearTimeout(t)
  }, [autoPrint])

  return (
    <div className="no-print bg-slate-800 text-white px-6 py-3 flex items-center justify-between">
      <span className="text-sm">{title}</span>
      <div className="flex gap-3">
        <button
          onClick={() => window.close()}
          className="text-xs px-3 py-1.5 border border-slate-500 rounded hover:bg-slate-700 transition-colors">
          Cerrar
        </button>
        <button
          onClick={() => window.print()}
          className="text-xs px-3 py-1.5 bg-white text-slate-900 rounded font-semibold hover:bg-slate-100 transition-colors">
          Imprimir / Guardar PDF
        </button>
      </div>
    </div>
  )
}
