'use client'

import { useState, useMemo } from 'react'
import UnitCard from './UnitCard'
import type { StockPublico } from '@/types/database'

interface Props {
  unidades: StockPublico[]
}

export default function StockCatalog({ unidades }: Props) {
  const [filtroPiso, setFiltroPiso] = useState<number | 'Todos'>('Todos')
  const [filtroTipologia, setFiltroTipologia] = useState<string>('Todas')
  const [filtroEstado, setFiltroEstado] = useState<string>('Todos')

  const pisos = useMemo(
    () => [...new Set(unidades.map(u => u.piso))].sort((a, b) => a - b),
    [unidades]
  )
  const tipologias = useMemo(
    () => [...new Set(unidades.map(u => u.tipologia_nombre))],
    [unidades]
  )

  const filtradas = useMemo(() => {
    return unidades.filter(u => {
      if (filtroPiso !== 'Todos' && u.piso !== filtroPiso) return false
      if (filtroTipologia !== 'Todas' && u.tipologia_nombre !== filtroTipologia) return false
      if (filtroEstado !== 'Todos' && u.estado_comercial !== filtroEstado) return false
      return true
    })
  }, [unidades, filtroPiso, filtroTipologia, filtroEstado])

  const disponibles = filtradas.filter(u => u.estado_comercial === 'Disponible').length
  const reservadas = filtradas.filter(u => u.estado_comercial === 'Reservado').length

  return (
    <section id="stock" className="bg-slate-950 py-24">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-px bg-indigo-400" />
              <span className="text-indigo-400 text-xs font-semibold uppercase tracking-[0.2em]">
                Stock disponible
              </span>
            </div>
            <h2 className="text-4xl font-bold text-white">
              Elegí tu unidad
            </h2>
            <p className="text-slate-500 text-sm mt-2">
              {disponibles} disponibles · {reservadas} reservadas · precios en USD
            </p>
          </div>

          {/* Filtros */}
          <div className="flex flex-wrap gap-2">
            {/* Filtro tipología */}
            <select
              value={filtroTipologia}
              onChange={e => setFiltroTipologia(e.target.value)}
              className="px-3 py-2 bg-slate-900 border border-slate-700 text-slate-300 rounded-lg
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="Todas">Todas las tipologías</option>
              {tipologias.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            {/* Filtro piso */}
            <select
              value={filtroPiso}
              onChange={e => setFiltroPiso(e.target.value === 'Todos' ? 'Todos' : parseInt(e.target.value))}
              className="px-3 py-2 bg-slate-900 border border-slate-700 text-slate-300 rounded-lg
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="Todos">Todos los pisos</option>
              {pisos.map(p => (
                <option key={p} value={p}>Piso {p}</option>
              ))}
            </select>

            {/* Filtro estado */}
            <select
              value={filtroEstado}
              onChange={e => setFiltroEstado(e.target.value)}
              className="px-3 py-2 bg-slate-900 border border-slate-700 text-slate-300 rounded-lg
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="Todos">Todos los estados</option>
              <option value="Disponible">Disponible</option>
              <option value="Reservado">Reservado</option>
            </select>

            {/* Reset */}
            {(filtroPiso !== 'Todos' || filtroTipologia !== 'Todas' || filtroEstado !== 'Todos') && (
              <button
                onClick={() => { setFiltroPiso('Todos'); setFiltroTipologia('Todas'); setFiltroEstado('Todos') }}
                className="px-3 py-2 text-slate-500 hover:text-white text-sm transition-colors"
              >
                Limpiar filtros ✕
              </button>
            )}
          </div>
        </div>

        {/* Grid de unidades */}
        {filtradas.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtradas.map(u => (
              <UnitCard key={u.id} unidad={u} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-slate-600">
            <p className="text-lg">No hay unidades con los filtros seleccionados.</p>
            <button
              onClick={() => { setFiltroPiso('Todos'); setFiltroTipologia('Todas'); setFiltroEstado('Todos') }}
              className="mt-3 text-indigo-400 hover:text-indigo-300 text-sm transition-colors"
            >
              Ver todo el stock
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
