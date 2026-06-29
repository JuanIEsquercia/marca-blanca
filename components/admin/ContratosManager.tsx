'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import SaleForm from './SaleForm'
import ConfirmModal from './ConfirmModal'
import type { Unidad, Tipologia, Comprador, Cuota } from '@/types/database'

type UnidadConTipologia = Unidad & { tipologias: Tipologia }

type ContratoRow = {
  id: string
  unidad_id: string
  precio_final: number
  entrega_efectiva: number
  cantidad_cuotas: number
  fecha_firma: string
  notas: string | null
  compradores: Comprador | null
  unidades: (Unidad & { tipologias: { nombre: string } }) | null
  cuotas: Cuota[]
  pagadas: number
  vencidas: number
}

interface Props {
  contratos: ContratoRow[]
  unidadesDisponibles: UnidadConTipologia[]
}

interface DeleteTarget {
  contratoId: string
  compradorNombre: string
  unidadId: string
}

interface EditState {
  contratoId: string
  precioFinal: string
  entregaEfectiva: string
  fechaFirma: string
  notas: string
}

export default function ContratosManager({ contratos, unidadesDisponibles }: Props) {
  const router = useRouter()
  const today = new Date().toISOString().split('T')[0]
  const [, startTransition] = useTransition()

  const [showUnitPicker, setShowUnitPicker] = useState(false)
  const [unidadSeleccionada, setUnidadSeleccionada] = useState<UnidadConTipologia | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')

  const rows = contratos.map((c: ContratoRow) => {
    const cuotas = c.cuotas ?? []
    const pagadas = cuotas.filter((q: { estado_pago: string }) => q.estado_pago === 'Pagado').length
    const vencidas = cuotas.filter(
      (q: { estado_pago: string; fecha_vencimiento: string }) =>
        q.estado_pago === 'Pendiente' && q.fecha_vencimiento < today
    ).length
    return { ...c, cuotas, pagadas, vencidas }
  })

  const rowsFiltrados = busqueda
    ? rows.filter(c => {
        const q = busqueda.toLowerCase()
        return (
          c.compradores?.nombre_completo.toLowerCase().includes(q) ||
          c.compradores?.dni_cuit.toLowerCase().includes(q)
        )
      })
    : rows

  const totalIngresos = rows.reduce((acc: number, c: ContratoRow) => acc + Number(c.precio_final), 0)
  const totalVencidas = rows.reduce((acc: number, c: ContratoRow) => acc + c.vencidas, 0)

  function openEdit(c: ContratoRow) {
    setEditState({
      contratoId: c.id,
      precioFinal: String(c.precio_final),
      entregaEfectiva: String(c.entrega_efectiva),
      fechaFirma: c.fecha_firma,
      notas: c.notas ?? '',
    })
    setEditError(null)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editState) return
    setEditLoading(true)
    setEditError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('contratos_venta')
      .update({
        precio_final: parseFloat(editState.precioFinal),
        entrega_efectiva: parseFloat(editState.entregaEfectiva),
        fecha_firma: editState.fechaFirma,
        notas: editState.notas || null,
      })
      .eq('id', editState.contratoId)
    setEditLoading(false)
    if (error) { setEditError(error.message); return }
    setEditState(null)
    startTransition(() => router.refresh())
  }

  async function handleDelete() {
    if (!deleteTarget) return
    const supabase = createClient()
    await supabase.from('cuotas').delete().eq('contrato_id', deleteTarget.contratoId)
    await supabase.from('contratos_venta').delete().eq('id', deleteTarget.contratoId)
    await supabase.from('unidades').update({ estado_comercial: 'Disponible' }).eq('id', deleteTarget.unidadId)
    setDeleteTarget(null)
    startTransition(() => router.refresh())
  }

  function handleVentaSuccess() {
    setUnidadSeleccionada(null)
    startTransition(() => router.refresh())
  }

  const saldoEdicion = editState
    ? Math.max(0, parseFloat(editState.precioFinal || '0') - parseFloat(editState.entregaEfectiva || '0'))
    : 0

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Ventas</h1>
          <p className="text-slate-500 text-sm mt-1">Todos los contratos de venta del desarrollo</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar por nombre o DNI..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              className="pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64 bg-white"
            />
          </div>
          <button
          onClick={() => setShowUnitPicker(true)}
          disabled={unidadesDisponibles.length === 0}
          title={unidadesDisponibles.length === 0 ? 'No hay unidades disponibles' : undefined}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500
                     disabled:opacity-40 disabled:cursor-not-allowed
                     text-white rounded-xl text-sm font-semibold transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nueva venta
        </button>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 mb-1">Ventas registradas</p>
          <p className="text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 mb-1">Ingresos totales</p>
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(totalIngresos)}</p>
        </div>
        <div className={`border rounded-xl p-4 ${totalVencidas > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
          <p className={`text-xs font-medium mb-1 ${totalVencidas > 0 ? 'text-red-600' : 'text-slate-500'}`}>
            Cuotas vencidas sin cobrar
          </p>
          <p className={`text-2xl font-bold ${totalVencidas > 0 ? 'text-red-700' : 'text-slate-900'}`}>
            {totalVencidas}
          </p>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Comprador</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Unidad</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">Precio final</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">Entrega</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Cuotas</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Firma</th>
                <th className="px-4 py-3 w-44" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rowsFiltrados.map((c: ContratoRow) => {
                const unidad = c.unidades
                const comprador = c.compradores
                return (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{comprador?.nombre_completo}</p>
                      <p className="text-xs text-slate-400 font-mono">{comprador?.dni_cuit}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {unidad ? `P${unidad.piso} - ${unidad.numero}${unidad.letra ?? ''}` : '—'}
                      <p className="text-xs text-slate-400">{unidad?.tipologias?.nombre}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {formatCurrency(c.precio_final)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {formatCurrency(c.entrega_efectiva)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-xs text-slate-500">{c.pagadas}/{c.cuotas.length} pagadas</span>
                        {c.vencidas > 0 && (
                          <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
                            {c.vencidas} vencida{c.vencidas > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(c.fecha_firma)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/admin/cuenta-corriente?contrato=${c.id}`}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors px-2 py-1"
                        >
                          Cuotas →
                        </Link>
                        <button
                          onClick={() => openEdit(c)}
                          title="Editar"
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setDeleteTarget({
                            contratoId: c.id,
                            compradorNombre: comprador?.nombre_completo ?? '',
                            unidadId: c.unidad_id,
                          })}
                          title="Eliminar"
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {rowsFiltrados.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              {busqueda ? (
                <p className="text-sm">Sin resultados para &quot;{busqueda}&quot;</p>
              ) : (
                <>
                  <p className="text-sm">No hay ventas registradas aún.</p>
                  <button
                    onClick={() => setShowUnitPicker(true)}
                    disabled={unidadesDisponibles.length === 0}
                    className="mt-2 text-xs text-indigo-500 hover:text-indigo-700 disabled:opacity-40"
                  >
                    {unidadesDisponibles.length > 0 ? 'Registrar primera venta →' : 'No hay unidades disponibles'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal: selector de unidad */}
      {showUnitPicker && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="font-bold text-slate-900">Nueva venta</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {unidadesDisponibles.length} unidad{unidadesDisponibles.length !== 1 ? 'es' : ''} disponible{unidadesDisponibles.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button onClick={() => setShowUnitPicker(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 overflow-y-auto grid grid-cols-2 gap-3">
              {unidadesDisponibles.map(u => (
                <button
                  key={u.id}
                  onClick={() => { setShowUnitPicker(false); setUnidadSeleccionada(u) }}
                  className="text-left p-4 border border-slate-200 rounded-xl
                             hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                >
                  <p className="font-semibold text-slate-900">P{u.piso} · {u.numero}{u.letra ?? ''}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{u.tipologias.nombre}</p>
                  <p className="text-sm font-medium text-indigo-600 mt-2">{formatCurrency(u.precio_lista)}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: editar venta */}
      {editState && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="font-bold text-slate-900">Editar venta</h2>
              <button onClick={() => setEditState(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleEdit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Precio final (USD) *</label>
                  <input
                    required type="number" min="0" step="0.01"
                    value={editState.precioFinal}
                    onChange={e => setEditState(s => s && { ...s, precioFinal: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Entrega efectiva (USD) *</label>
                  <input
                    required type="number" min="0" step="0.01"
                    value={editState.entregaEfectiva}
                    onChange={e => setEditState(s => s && { ...s, entregaEfectiva: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de firma *</label>
                  <input
                    required type="date"
                    value={editState.fechaFirma}
                    onChange={e => setEditState(s => s && { ...s, fechaFirma: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="bg-slate-50 rounded-lg p-3 flex flex-col justify-center">
                  <p className="text-xs text-slate-500">Saldo financiado</p>
                  <p className="font-bold text-slate-900 mt-0.5">{formatCurrency(saldoEdicion)}</p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notas</label>
                <textarea
                  rows={2}
                  value={editState.notas}
                  onChange={e => setEditState(s => s && { ...s, notas: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
              <p className="text-[11px] text-slate-400">
                Los cambios de precio no actualizan retroactivamente el plan de cuotas existente.
              </p>
              {editError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {editError}
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  type="button" onClick={() => setEditState(null)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-xl text-sm font-medium
                             text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit" disabled={editLoading}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
                             text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  {editLoading ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SaleForm */}
      {unidadSeleccionada && (
        <SaleForm
          unidad={unidadSeleccionada}
          onClose={() => setUnidadSeleccionada(null)}
          onSuccess={handleVentaSuccess}
        />
      )}

      {/* Modal: confirmar eliminación */}
      {deleteTarget && (
        <ConfirmModal
          title="Eliminar venta"
          message={`¿Eliminar la venta de ${deleteTarget.compradorNombre}? Se borrarán todas las cuotas asociadas y la unidad volverá a estar disponible.`}
          confirmLabel="Eliminar venta"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
