'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, redondear2, sumarMontos } from '@/lib/utils'

interface Props {
  constructoraId: string
}

type Fila = { key: number; rubro: string; unidad: string; cantidad: string; precio_unitario: string }

let filaKeySeq = 0
function nuevaFila(): Fila {
  return { key: ++filaKeySeq, rubro: '', unidad: '', cantidad: '1', precio_unitario: '' }
}

export default function NuevoPresupuestoForm({ constructoraId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteCuit, setClienteCuit] = useState('')
  const [clienteEmail, setClienteEmail] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [moneda, setMoneda] = useState('ARS')
  const [descripcion, setDescripcion] = useState('')

  const [filas, setFilas] = useState<Fila[]>([nuevaFila()])

  function actualizarFila(key: number, cambios: Partial<Fila>) {
    setFilas(fs => fs.map(f => (f.key === key ? { ...f, ...cambios } : f)))
  }
  function agregarFila() {
    setFilas(fs => [...fs, nuevaFila()])
  }
  function quitarFila(key: number) {
    setFilas(fs => (fs.length > 1 ? fs.filter(f => f.key !== key) : fs))
  }
  function subtotalFila(f: Fila) {
    return redondear2((parseFloat(f.cantidad) || 0) * (parseFloat(f.precio_unitario) || 0))
  }
  const total = sumarMontos(filas.map(subtotalFila))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clienteNombre.trim()) return
    setLoading(true)
    setError(null)
    const supabase = createClient()

    const { data: nuevo, error: err } = await supabase
      .from('presupuestos')
      .insert({
        constructora_id: constructoraId,
        cliente_nombre: clienteNombre.trim(),
        cliente_cuit: clienteCuit.trim() || null,
        cliente_email: clienteEmail.trim() || null,
        cliente_telefono: clienteTelefono.trim() || null,
        moneda,
        descripcion: descripcion.trim() || null,
        estado: 'borrador',
      })
      .select('id')
      .single()

    if (err || !nuevo) { setLoading(false); setError(err?.message ?? 'Error al crear el presupuesto'); return }

    const filasValidas = filas.filter(f => f.rubro.trim() && f.precio_unitario)
    if (filasValidas.length > 0) {
      const { error: errItems } = await supabase.from('presupuesto_items').insert(
        filasValidas.map((f, i) => ({
          presupuesto_id: nuevo.id,
          constructora_id: constructoraId,
          orden: i,
          rubro: f.rubro.trim(),
          unidad: f.unidad.trim() || null,
          cantidad: redondear2(parseFloat(f.cantidad) || 1),
          precio_unitario: redondear2(parseFloat(f.precio_unitario)),
        }))
      )
      if (errItems) {
        // Compensar: no dejar un presupuesto vacío colgado si los ítems fallaron.
        await supabase.from('presupuestos').delete().eq('id', nuevo.id)
        setLoading(false)
        setError(errItems.message)
        return
      }
    }

    router.push('/admin/presupuestos')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Datos del cliente</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Cliente *</label>
            <input required value={clienteNombre} onChange={e => setClienteNombre(e.target.value)}
              placeholder="Razón social o nombre"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">CUIT</label>
            <input value={clienteCuit} onChange={e => setClienteCuit(e.target.value)}
              placeholder="20-12345678-9"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Moneda</label>
            <select value={moneda} onChange={e => setMoneda(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="ARS">ARS — Pesos</option>
              <option value="USD">USD — Dólares</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
            <input type="email" value={clienteEmail} onChange={e => setClienteEmail(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
            <input value={clienteTelefono} onChange={e => setClienteTelefono(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Descripción del trabajo</label>
            <textarea rows={2} value={descripcion} onChange={e => setDescripcion(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-700">Ítems del presupuesto</h2>
          <button type="button" onClick={agregarFila}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-indigo-200 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Agregar fila
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="pb-2 pr-2 font-medium w-8">#</th>
                <th className="pb-2 pr-2 font-medium">Rubro</th>
                <th className="pb-2 pr-2 font-medium w-32">Unidad</th>
                <th className="pb-2 pr-2 font-medium w-28">Cantidad</th>
                <th className="pb-2 pr-2 font-medium w-36">Precio unitario</th>
                <th className="pb-2 pr-2 font-medium w-32 text-right">Subtotal</th>
                <th className="pb-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={f.key} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-2 text-slate-400 text-xs">{i + 1}</td>
                  <td className="py-2 pr-2">
                    <input value={f.rubro} onChange={e => actualizarFila(f.key, { rubro: e.target.value })}
                      placeholder="Ej: Movimiento de suelos"
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </td>
                  <td className="py-2 pr-2">
                    <input value={f.unidad} onChange={e => actualizarFila(f.key, { unidad: e.target.value })}
                      placeholder="m², gl..."
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </td>
                  <td className="py-2 pr-2">
                    <input type="number" min="0.01" step="0.01" value={f.cantidad}
                      onChange={e => actualizarFila(f.key, { cantidad: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </td>
                  <td className="py-2 pr-2">
                    <input type="number" min="0" step="0.01" value={f.precio_unitario}
                      onChange={e => actualizarFila(f.key, { precio_unitario: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </td>
                  <td className="py-2 pr-2 text-right font-medium text-slate-700 whitespace-nowrap">
                    {formatCurrency(subtotalFila(f), moneda)}
                  </td>
                  <td className="py-2">
                    <button type="button" onClick={() => quitarFila(f.key)}
                      className="text-red-400 hover:text-red-600 px-1" title="Quitar fila">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end mt-3 pt-3 border-t border-slate-100">
          <p className="text-base font-bold text-slate-900">Total: {formatCurrency(total, moneda)}</p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-3">
        <Link href="/admin/presupuestos"
          className="px-5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors">
          Cancelar
        </Link>
        <button type="submit" disabled={loading}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold transition-colors">
          {loading ? 'Guardando...' : 'Crear presupuesto'}
        </button>
      </div>
    </form>
  )
}
