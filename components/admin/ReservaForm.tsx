'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import type { Unidad, Tipologia, CuentaPropia } from '@/types/database'

interface Props {
  unidad: Unidad & { tipologias: Tipologia }
  onClose: () => void
  onSuccess: () => void
}

export default function ReservaForm({ unidad, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cuentasPropias, setCuentasPropias] = useState<CuentaPropia[]>([])

  // Comprador
  const [nombre, setNombre] = useState('')
  const [dni, setDni] = useState('')
  const [email, setEmail] = useState('')
  const [telefono, setTelefono] = useState('')

  // Reserva
  const defaultVencimiento = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]
  const [fechaVencimiento, setFechaVencimiento] = useState(defaultVencimiento)
  const [montoSena, setMontoSena] = useState('')
  const [cuentaPropiaId, setCuentaPropiaId] = useState('')
  const [notas, setNotas] = useState('')

  useEffect(() => {
    createClient()
      .from('cuentas_propias')
      .select('*')
      .eq('activa', true)
      .order('nombre')
      .then(({ data }) => setCuentasPropias(data ?? []))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()

    try {
      // 1. Buscar o crear comprador
      let compradorId: string

      const { data: existente } = await supabase
        .from('compradores')
        .select('id')
        .eq('dni_cuit', dni.trim())
        .single()

      if (existente) {
        compradorId = existente.id
      } else {
        const { data: nuevo, error: errComp } = await supabase
          .from('compradores')
          .insert({ nombre_completo: nombre, dni_cuit: dni.trim(), email, telefono })
          .select('id')
          .single()

        if (errComp || !nuevo) throw new Error('Error al crear el comprador')
        compradorId = nuevo.id
      }

      // 2. Crear la reserva
      const { error: errReserva } = await supabase.from('reservas').insert({
        unidad_id: unidad.id,
        comprador_id: compradorId,
        fecha_vencimiento: fechaVencimiento,
        monto_sena: montoSena ? parseFloat(montoSena) : null,
        cuenta_propia_id: cuentaPropiaId || null,
        notas: notas || null,
      })

      if (errReserva) throw new Error(errReserva.message)

      // 3. Actualizar estado de la unidad
      await supabase
        .from('unidades')
        .update({ estado_comercial: 'Reservado' })
        .eq('id', unidad.id)

      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }

  const diasRestantes = Math.round(
    (new Date(fechaVencimiento).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Registrar Reserva</h2>
            <p className="text-slate-500 text-sm">
              Unidad P{unidad.piso} - {unidad.numero}{unidad.letra ?? ''} &bull; {unidad.tipologias.nombre}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Datos del interesado */}
          <div>
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">
              Datos del Interesado
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre completo *</label>
                <input required value={nombre} onChange={e => setNombre(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">DNI / CUIT *</label>
                <input required value={dni} onChange={e => setDni(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
                <input value={telefono} onChange={e => setTelefono(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
          </div>

          {/* Condiciones de la reserva */}
          <div>
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">
              Condiciones de la Reserva
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Vencimiento de la reserva *
                  {diasRestantes >= 0 && (
                    <span className="ml-2 text-indigo-600 font-normal">({diasRestantes} días)</span>
                  )}
                </label>
                <input required type="date" value={fechaVencimiento}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={e => setFechaVencimiento(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Monto seña ({unidad.tipologias.nombre === 'Monoambiente' ? 'USD' : 'USD'})
                </label>
                <input type="number" min="0" step="0.01" value={montoSena}
                  onChange={e => setMontoSena(e.target.value)}
                  placeholder="Opcional"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Cuenta donde ingresa</label>
                <select value={cuentaPropiaId} onChange={e => setCuentaPropiaId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">Sin asignar</option>
                  {cuentasPropias.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre} ({c.moneda})</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Notas</label>
                <textarea rows={2} value={notas} onChange={e => setNotas(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>
            </div>
          </div>

          {/* Resumen */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">Resumen</p>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Precio lista</span>
                <span className="font-semibold text-slate-900">{formatCurrency(unidad.precio_lista)}</span>
              </div>
              {montoSena && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Seña</span>
                  <span className="font-semibold text-amber-700">{formatCurrency(parseFloat(montoSena))}</span>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-60
                         text-white rounded-lg text-sm font-semibold transition-colors">
              {loading ? 'Guardando...' : 'Confirmar Reserva'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
