'use client'

import { useState } from 'react'
import type { Comprador } from '@/types/database'

export interface ClienteValue {
  // id del comprador elegido de la búsqueda — null si es uno nuevo (o si se
  // tipeó a mano sin buscar, mismo caso que antes).
  compradorId: string | null
  nombre: string
  cuit: string
  email: string
  telefono: string
  // Si compradorId no es null Y esto está en true, el submit del formulario
  // que use este componente tiene que hacer UPDATE sobre ese comprador con
  // los datos de acá — si está en false, se reusa tal cual está guardado.
  actualizarExistente: boolean
}

export const EMPTY_CLIENTE: ClienteValue = {
  compradorId: null, nombre: '', cuit: '', email: '', telefono: '', actualizarExistente: false,
}

interface Props {
  // Toda la lista de compradores de la constructora — la búsqueda es
  // client-side (ya está en memoria, no hace falta ida y vuelta al server
  // por cada letra tipeada).
  compradores: Pick<Comprador, 'id' | 'nombre_completo' | 'dni_cuit' | 'email' | 'telefono'>[]
  value: ClienteValue
  onChange: (value: ClienteValue) => void
}

// Reemplaza el tipeo ciego de nombre/CUIT/email/teléfono que había en
// ReservaForm/SaleForm/CertificadosManager (y, con esto, también en
// Presupuestos): permite buscar y reusar un cliente ya cargado, o cargar
// uno nuevo. Si el CUIT tipeado a mano coincide con uno existente sin
// haberlo buscado, antes se pisaba en silencio — acá se avisa y se puede
// elegir usarlo en vez de perder el dato sin darse cuenta.
export default function ClienteSelect({ compradores, value, onChange }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [mostrarResultados, setMostrarResultados] = useState(false)

  const resultados = busqueda.trim().length >= 2
    ? compradores.filter(c =>
        c.nombre_completo.toLowerCase().includes(busqueda.toLowerCase()) ||
        (c.dni_cuit ?? '').includes(busqueda.trim())
      ).slice(0, 8)
    : []

  const colision = !value.compradorId && value.cuit.trim().length > 0
    ? compradores.find(c => c.dni_cuit && c.dni_cuit === value.cuit.trim())
    : undefined

  function elegir(c: Pick<Comprador, 'id' | 'nombre_completo' | 'dni_cuit' | 'email' | 'telefono'>) {
    onChange({
      compradorId: c.id,
      nombre: c.nombre_completo,
      cuit: c.dni_cuit ?? '',
      email: c.email ?? '',
      telefono: c.telefono ?? '',
      actualizarExistente: false,
    })
    setBusqueda('')
    setMostrarResultados(false)
  }

  function cambiar() {
    onChange({ ...EMPTY_CLIENTE })
    setBusqueda('')
  }

  return (
    <div className="space-y-2">
      {value.compradorId ? (
        <div className="flex items-center justify-between gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
          <p className="text-xs text-indigo-700">Cliente existente: <strong>{value.nombre}</strong></p>
          <button type="button" onClick={cambiar} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium shrink-0">Cambiar</button>
        </div>
      ) : (
        <div className="relative">
          <input value={busqueda}
            onChange={e => { setBusqueda(e.target.value); setMostrarResultados(true) }}
            onFocus={() => setMostrarResultados(true)}
            onBlur={() => setTimeout(() => setMostrarResultados(false), 150)}
            placeholder="Buscar cliente existente por nombre o CUIT..."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          {mostrarResultados && resultados.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {resultados.map(c => (
                <button key={c.id} type="button" onMouseDown={() => elegir(c)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0">
                  <p className="font-medium text-slate-800">{c.nombre_completo}</p>
                  {c.dni_cuit && <p className="text-xs text-slate-400">{c.dni_cuit}</p>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {colision && (
        <div className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <p className="text-xs text-amber-700">Ya existe un cliente con este CUIT: <strong>{colision.nombre_completo}</strong></p>
          <button type="button" onClick={() => elegir(colision)} className="text-xs text-amber-800 font-medium hover:underline shrink-0">Usar sus datos</button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Nombre completo *</label>
          <input required value={value.nombre} onChange={e => onChange({ ...value, nombre: e.target.value })}
            placeholder="Razón social o nombre"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">CUIT/DNI</label>
          <input value={value.cuit} onChange={e => onChange({ ...value, cuit: e.target.value })}
            placeholder="20-12345678-9"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
          <input value={value.telefono} onChange={e => onChange({ ...value, telefono: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
          <input type="email" value={value.email} onChange={e => onChange({ ...value, email: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
      </div>

      {value.compradorId && (
        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={value.actualizarExistente}
            onChange={e => onChange({ ...value, actualizarExistente: e.target.checked })} />
          Actualizar los datos de este cliente con lo que edite arriba
        </label>
      )}
    </div>
  )
}
