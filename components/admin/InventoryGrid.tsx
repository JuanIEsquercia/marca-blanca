'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency, ESTADO_COLORS } from '@/lib/utils'
import type { Unidad, Tipologia, EstadoComercial, Comprador, Reserva } from '@/types/database'
import SaleForm from './SaleForm'
import UnidadForm from './UnidadForm'
import ReservaForm from './ReservaForm'

type ReservaConComprador = Reserva & { compradores: Comprador }
type UnidadConRelaciones = Unidad & {
  tipologias: Tipologia
  reservas: ReservaConComprador[]
}

interface Props {
  unidades: UnidadConRelaciones[]
  tipologias: Tipologia[]
}

const ESTADOS: EstadoComercial[] = ['Disponible', 'Reservado', 'Vendido']

export default function InventoryGrid({ unidades, tipologias }: Props) {
  const router = useRouter()
  const [filtro, setFiltro] = useState<EstadoComercial | 'Todos'>('Todos')
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null)
  const [editPrice, setEditPrice] = useState('')
  const [saleUnit, setSaleUnit] = useState<UnidadConRelaciones | null>(null)
  const [reservaUnit, setReservaUnit] = useState<UnidadConRelaciones | null>(null)
  const [editUnit, setEditUnit] = useState<UnidadConRelaciones | null>(null)
  const [showNewUnit, setShowNewUnit] = useState(false)
  const [, startTransition] = useTransition()

  const filtered = filtro === 'Todos' ? unidades : unidades.filter(u => u.estado_comercial === filtro)

  function refresh() { startTransition(() => router.refresh()) }

  async function handlePriceUpdate(id: string) {
    const precio = parseFloat(editPrice)
    if (isNaN(precio) || precio <= 0) return
    const supabase = createClient()
    await supabase.from('unidades').update({ precio_lista: precio }).eq('id', id)
    setEditingPriceId(null)
    refresh()
  }

  async function handleEstadoChange(unidad: UnidadConRelaciones, estado: EstadoComercial) {
    if (estado === 'Vendido') {
      setSaleUnit(unidad)
      return
    }
    if (estado === 'Reservado') {
      setReservaUnit(unidad)
      return
    }
    // Volver a Disponible desde Reservado: marcar reserva vigente como caída
    if (unidad.estado_comercial === 'Reservado') {
      const reservaVigente = unidad.reservas?.find(r => r.estado === 'Vigente')
      const supabase = createClient()
      if (reservaVigente) {
        await supabase.from('reservas').update({ estado: 'Caída' }).eq('id', reservaVigente.id)
      }
    }
    const supabase = createClient()
    await supabase.from('unidades').update({ estado_comercial: estado }).eq('id', unidad.id)
    refresh()
  }

  async function handleDelete(id: string, label: string) {
    if (!confirm(`¿Eliminar la unidad "${label}"? Solo es posible si no tiene contrato de venta.`)) return
    const supabase = createClient()
    const { error } = await supabase.from('unidades').delete().eq('id', id)
    if (error) alert(error.message)
    else refresh()
  }

  return (
    <>
      {/* Barra de acciones */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {(['Todos', ...ESTADOS] as const).map(e => (
          <button key={e} onClick={() => setFiltro(e)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
              filtro === e
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            )}>
            {e}
            <span className="ml-1.5 text-xs opacity-70">
              ({e === 'Todos' ? unidades.length : unidades.filter(u => u.estado_comercial === e).length})
            </span>
          </button>
        ))}

        <div className="ml-auto flex gap-2">
          <button onClick={() => window.print()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
                       border border-slate-200 bg-white text-slate-600 hover:border-slate-300 transition-colors no-print">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Exportar lista
          </button>
          <button onClick={() => setShowNewUnit(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
                       bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nueva unidad
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Unidad</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Tipología</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Orientación</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">m²</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">Precio Lista</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">$/m²</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Estado</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Interesado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(u => {
                const m2 = u.m2 ?? u.tipologias.m2_totales
                const precioPorM2 = m2 > 0 ? u.precio_lista / m2 : 0
                const isEditing = editingPriceId === u.id
                const label = `P${u.piso} - ${u.numero}`
                const reservaVigente = u.reservas?.find(r => r.estado === 'Vigente')

                return (
                  <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">{label}</td>
                    <td className="px-4 py-3 text-slate-600">{u.tipologias.nombre}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{u.orientacion ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {m2} m²
                      {u.m2 && <span className="text-xs text-slate-400 ml-1">(unit.)</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <input type="number" value={editPrice} onChange={e => setEditPrice(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handlePriceUpdate(u.id)}
                            className="w-28 px-2 py-1 border border-indigo-400 rounded text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            autoFocus />
                          <button onClick={() => handlePriceUpdate(u.id)} className="text-indigo-600 hover:text-indigo-800 font-medium text-xs">OK</button>
                          <button onClick={() => setEditingPriceId(null)} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingPriceId(u.id); setEditPrice(String(u.precio_lista)) }}
                          className="font-semibold text-slate-900 hover:text-indigo-600 transition-colors"
                          title="Click para editar precio">
                          {formatCurrency(u.precio_lista)}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">{formatCurrency(precioPorM2)}</td>
                    <td className="px-4 py-3 text-center">
                      <select value={u.estado_comercial}
                        onChange={e => handleEstadoChange(u, e.target.value as EstadoComercial)}
                        disabled={u.estado_comercial === 'Vendido'}
                        className={cn(
                          'text-xs font-medium px-2 py-1 rounded-full border cursor-pointer focus:outline-none disabled:cursor-not-allowed',
                          ESTADO_COLORS[u.estado_comercial]
                        )}>
                        {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                      </select>
                    </td>
                    {/* Columna de interesado (comprador de reserva) */}
                    <td className="px-4 py-3">
                      {reservaVigente ? (
                        <div>
                          <p className="text-xs font-medium text-slate-700 truncate max-w-[140px]">
                            {reservaVigente.compradores.nombre_completo}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            Vence {new Date(reservaVigente.fecha_vencimiento).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
                          </p>
                        </div>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {u.estado_comercial === 'Disponible' && (
                          <>
                            <button onClick={() => setEditUnit(u)}
                              className="text-xs text-slate-500 hover:text-indigo-600 transition-colors">
                              Editar
                            </button>
                            <button onClick={() => setReservaUnit(u)}
                              className="text-xs text-amber-600 hover:text-amber-800 font-medium transition-colors">
                              Reservar
                            </button>
                            <button onClick={() => setSaleUnit(u)}
                              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors">
                              Cerrar venta
                            </button>
                            <button onClick={() => handleDelete(u.id, label)}
                              className="text-xs text-red-400 hover:text-red-600">
                              ✕
                            </button>
                          </>
                        )}
                        {u.estado_comercial === 'Reservado' && (
                          <>
                            <button onClick={() => setEditUnit(u)}
                              className="text-xs text-slate-500 hover:text-indigo-600 transition-colors">
                              Editar
                            </button>
                            <button
                              onClick={() => setSaleUnit(u)}
                              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors">
                              Convertir a venta
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              {unidades.length === 0
                ? <button onClick={() => setShowNewUnit(true)} className="text-indigo-500 hover:text-indigo-700">
                    No hay unidades. Crear la primera →
                  </button>
                : 'No hay unidades con este filtro.'}
            </div>
          )}
        </div>
      </div>

      {/* Modales */}
      {showNewUnit && (
        <UnidadForm tipologias={tipologias} onClose={() => setShowNewUnit(false)}
          onSuccess={() => { setShowNewUnit(false); refresh() }} />
      )}

      {editUnit && (
        <UnidadForm tipologias={tipologias} unidad={editUnit}
          onClose={() => setEditUnit(null)} onSuccess={() => { setEditUnit(null); refresh() }} />
      )}

      {reservaUnit && (
        <ReservaForm unidad={reservaUnit}
          onClose={() => setReservaUnit(null)}
          onSuccess={() => { setReservaUnit(null); refresh() }} />
      )}

      {saleUnit && (
        <SaleForm
          unidad={saleUnit}
          reservaId={saleUnit.reservas?.find(r => r.estado === 'Vigente')?.id}
          compradorPreFill={(() => {
            const r = saleUnit.reservas?.find(rv => rv.estado === 'Vigente')
            if (!r) return undefined
            return {
              nombre: r.compradores.nombre_completo,
              dni: r.compradores.dni_cuit,
              email: r.compradores.email ?? '',
              telefono: r.compradores.telefono ?? '',
            }
          })()}
          onClose={() => setSaleUnit(null)}
          onSuccess={() => { setSaleUnit(null); refresh() }}
        />
      )}
    </>
  )
}
