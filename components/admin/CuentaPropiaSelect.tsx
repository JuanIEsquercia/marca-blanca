'use client'

import { useState } from 'react'
import { crearCuentaPropiaRapida } from '@/lib/cuentasPropias'
import { cn } from '@/lib/utils'
import type { CuentaPropia } from '@/types/database'

interface Props {
  cuentas: CuentaPropia[]
  value: string
  onChange: (id: string) => void
  // El padre mantiene la lista de cuentas (viene de props del servidor) —
  // esto le avisa que sume la recién creada, mismo criterio que
  // productosNuevos/proveedoresNuevos en Compras/Gastos. Necesario para que
  // selectores hermanos (ej. una fila más en un plan de pago) también la vean.
  onCreated?: (cuenta: CuentaPropia) => void
  constructoraId: string
  obraId?: string | null
  // Si se pasa, filtra el selector a esa moneda y la cuenta nueva se crea
  // fija en esa moneda (sin selector) — mismo criterio que los modales de
  // pago que solo aceptan cuentas en la moneda del gasto/cobro. Tipado
  // como string (no 'ARS'|'USD') porque los campos moneda de Gasto/
  // CobroProyecto/etc. vienen tipados sueltos en types/database.ts.
  moneda?: string
  required?: boolean
  emptyLabel?: string
  className?: string
}

export default function CuentaPropiaSelect({
  cuentas, value, onChange, onCreated, constructoraId, obraId = null, moneda,
  required, emptyLabel = 'Sin cuenta asignada', className,
}: Props) {
  const [creando, setCreando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<'banco' | 'caja'>('banco')
  const [monedaNueva, setMonedaNueva] = useState<'ARS' | 'USD'>(moneda === 'USD' ? 'USD' : 'ARS')
  const [saldoInicial, setSaldoInicial] = useState('0')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disponibles = moneda ? cuentas.filter(c => c.moneda === moneda) : cuentas

  function cancelar() {
    setCreando(false)
    setNombre('')
    setTipo('banco')
    setMonedaNueva(moneda === 'USD' ? 'USD' : 'ARS')
    setSaldoInicial('0')
    setError(null)
  }

  async function crear() {
    if (!nombre.trim()) return
    setLoading(true)
    setError(null)
    const nueva = await crearCuentaPropiaRapida(
      constructoraId, nombre, tipo, (moneda ?? monedaNueva) as 'ARS' | 'USD', obraId,
      parseFloat(saldoInicial) || 0
    )
    setLoading(false)
    if (!nueva) { setError('Error al crear la cuenta'); return }
    onCreated?.(nueva)
    onChange(nueva.id)
    cancelar()
  }

  if (creando) {
    return (
      <div className="space-y-2 border border-indigo-200 rounded-lg p-2 bg-indigo-50/40">
        <div className={cn('grid gap-2', moneda ? 'grid-cols-2' : 'grid-cols-3')}>
          <input autoFocus value={nombre} onChange={e => setNombre(e.target.value)}
            placeholder="Nombre de la cuenta"
            className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <select value={tipo} onChange={e => setTipo(e.target.value as 'banco' | 'caja')}
            className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="banco">Banco</option>
            <option value="caja">Caja</option>
          </select>
          {!moneda && (
            <select value={monedaNueva} onChange={e => setMonedaNueva(e.target.value as 'ARS' | 'USD')}
              className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
          )}
          <div className={moneda ? 'col-span-2' : 'col-span-3'}>
            <input type="number" step="0.01" value={saldoInicial} onChange={e => setSaldoInicial(e.target.value)}
              placeholder="Saldo inicial"
              className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={crear} disabled={loading || !nombre.trim()}
            className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:opacity-50">
            {loading ? '...' : 'Crear cuenta'}
          </button>
          <button type="button" onClick={cancelar}
            className="px-3 py-1 border border-slate-300 rounded-lg text-xs text-slate-600">Cancelar</button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    )
  }

  return (
    <select required={required} value={value}
      onChange={e => e.target.value === '__nuevo__' ? setCreando(true) : onChange(e.target.value)}
      className={className ?? 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500'}>
      <option value="">{emptyLabel}</option>
      {disponibles.map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.moneda})</option>)}
      <option value="__nuevo__">+ Agregar cuenta nueva</option>
    </select>
  )
}
