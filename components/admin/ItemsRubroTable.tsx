'use client'

import { useId } from 'react'
import { formatCurrency, redondear2, sumarMontos } from '@/lib/utils'

// Componente único para cargar ítems (rubro/unidad/cantidad/precio) —
// lo usan NuevoPresupuestoForm y la creación de contrato en
// CertificadosManager. Antes eran dos implementaciones separadas que
// ya habían divergido en orden y estilo visual; esto garantiza que no
// puedan volver a divergir, porque es literalmente el mismo código.

export type FilaItem = { key: number; rubro: string; unidad: string; cantidad: string; precio_unitario: string }

let filaItemKeySeq = 0
export function nuevaFilaItem(): FilaItem {
  return { key: ++filaItemKeySeq, rubro: '', unidad: '', cantidad: '1', precio_unitario: '' }
}

export function subtotalFilaItem(f: FilaItem): number {
  return redondear2((parseFloat(f.cantidad) || 0) * (parseFloat(f.precio_unitario) || 0))
}

export function totalFilasItem(filas: FilaItem[]): number {
  return sumarMontos(filas.map(subtotalFilaItem))
}

interface Props {
  filas: FilaItem[]
  onChange: (filas: FilaItem[]) => void
  moneda: string
  titulo?: string
  // Rubros ya usados por la constructora — alimenta el autocomplete del
  // campo Rubro (datalist, no fuerza a elegir de la lista).
  rubros?: string[]
}

export default function ItemsRubroTable({ filas, onChange, moneda, titulo = 'Ítems', rubros = [] }: Props) {
  const datalistId = useId()

  function actualizar(key: number, cambios: Partial<FilaItem>) {
    onChange(filas.map(f => (f.key === key ? { ...f, ...cambios } : f)))
  }
  function agregar() {
    onChange([...filas, nuevaFilaItem()])
  }
  function quitar(key: number) {
    onChange(filas.length > 1 ? filas.filter(f => f.key !== key) : filas)
  }

  const total = totalFilasItem(filas)

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs font-medium text-slate-600">{titulo}</label>
        <button type="button" onClick={agregar}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 border border-indigo-200 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Agregar fila
        </button>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-100 bg-slate-50">
              <th className="py-2 pl-3 pr-2 font-medium w-8">#</th>
              <th className="py-2 pr-2 font-medium">Rubro</th>
              <th className="py-2 pr-2 font-medium w-28">Unidad</th>
              <th className="py-2 pr-2 font-medium w-24">Cantidad</th>
              <th className="py-2 pr-2 font-medium w-32">Precio unitario</th>
              <th className="py-2 pr-3 font-medium w-28 text-right">Subtotal</th>
              <th className="py-2 pr-2 w-6"></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={f.key} className="border-b border-slate-50 last:border-0">
                <td className="py-2 pl-3 pr-2 text-slate-400 text-xs">{i + 1}</td>
                <td className="py-2 pr-2">
                  <input value={f.rubro} onChange={e => actualizar(f.key, { rubro: e.target.value })}
                    list={datalistId}
                    autoComplete="off"
                    placeholder="Ej: Movimiento de suelos"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </td>
                <td className="py-2 pr-2">
                  <input value={f.unidad} onChange={e => actualizar(f.key, { unidad: e.target.value })}
                    placeholder="m², gl..."
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </td>
                <td className="py-2 pr-2">
                  <input type="number" min="0.01" step="0.01" value={f.cantidad}
                    onChange={e => actualizar(f.key, { cantidad: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </td>
                <td className="py-2 pr-2">
                  <input type="number" min="0" step="0.01" value={f.precio_unitario}
                    onChange={e => actualizar(f.key, { precio_unitario: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </td>
                <td className="py-2 pr-3 text-right font-medium text-slate-700 whitespace-nowrap">
                  {formatCurrency(subtotalFilaItem(f), moneda)}
                </td>
                <td className="py-2 pr-2">
                  <button type="button" onClick={() => quitar(f.key)}
                    className="text-red-400 hover:text-red-600 px-1" title="Quitar fila">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm font-semibold text-slate-900 text-right mt-2">Total: {formatCurrency(total, moneda)}</p>

      <datalist id={datalistId}>
        {rubros.map(r => <option key={r} value={r} />)}
      </datalist>
    </div>
  )
}
