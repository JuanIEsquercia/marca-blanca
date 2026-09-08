'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { crearRubroRapido, type Rubro, type RubroOpcion } from '@/lib/rubros'

interface Props {
  rubros: RubroOpcion[]
  value: string
  onChange: (id: string) => void
  onCreated?: (rubro: Rubro) => void
  constructoraId: string
  emptyLabel?: string
  className?: string
}

// Mismo idioma que ProveedorSelect/CuentaPropiaSelect: un <select> con una
// opción para dar de alta al vuelo, sin salir del formulario.
//
// La diferencia propia: los rubros que ya están en el contrato con el
// cliente de esta obra van arriba, en su propio grupo. Son los únicos que
// producen la comparación contra lo presupuestado en Control de obra, así
// que la lista empuja a elegir uno de esos antes que inventar uno nuevo
// que después quede huérfano en el análisis.
//
// No lleva `puedeCrear`: crear un rubro es solo sumar un nombre al
// catálogo de la constructora (tabla `rubros`), no da acceso a ningún dato
// — quien puede cargar el gasto o la orden ya puede hacerlo.
export default function RubroSelect({
  rubros, value, onChange, onCreated, constructoraId, emptyLabel = 'Sin rubro', className,
}: Props) {
  const [creando, setCreando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function cancelar() {
    setCreando(false)
    setNombre('')
    setError(null)
  }

  async function crear() {
    if (!nombre.trim()) return
    setLoading(true)
    setError(null)
    const nuevo = await crearRubroRapido(createClient(), constructoraId, nombre)
    setLoading(false)
    if (!nuevo) { setError('No se pudo crear el rubro'); return }
    onCreated?.(nuevo)
    onChange(nuevo.id)
    cancelar()
  }

  if (creando) {
    return (
      <div className="space-y-2 border border-indigo-200 rounded-lg p-3 bg-indigo-50/40">
        <input autoFocus value={nombre} onChange={e => setNombre(e.target.value)}
          placeholder="Nombre del rubro (ej. Hormigón, Instalación eléctrica)"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); crear() } }}
          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <div className="flex gap-2">
          <button type="button" onClick={crear} disabled={loading || !nombre.trim()}
            className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:opacity-50">
            {loading ? '...' : 'Crear rubro'}
          </button>
          <button type="button" onClick={cancelar}
            className="px-3 py-1 border border-slate-300 rounded-lg text-xs text-slate-600">Cancelar</button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    )
  }

  const delContrato = rubros.filter(r => r.enContrato)
  const otros = rubros.filter(r => !r.enContrato)
  const claseSelect = className ?? 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500'

  return (
    <select value={value}
      onChange={e => e.target.value === '__nuevo__' ? setCreando(true) : onChange(e.target.value)}
      className={claseSelect}>
      <option value="">{emptyLabel}</option>
      {delContrato.length > 0 ? (
        <>
          <optgroup label="Del contrato de esta obra">
            {delContrato.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </optgroup>
          {otros.length > 0 && (
            <optgroup label="Otros rubros">
              {otros.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            </optgroup>
          )}
        </>
      ) : (
        rubros.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)
      )}
      <option value="__nuevo__">+ Crear rubro nuevo</option>
    </select>
  )
}
