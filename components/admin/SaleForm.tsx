'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import type { Unidad, Tipologia, CuentaPropia } from '@/types/database'

interface CompradorPreFill {
  nombre: string
  dni: string
  email: string
  telefono: string
}

interface Props {
  unidad: Unidad & { tipologias: Tipologia }
  onClose: () => void
  onSuccess: () => void
  reservaId?: string
  compradorPreFill?: CompradorPreFill
}

export default function SaleForm({ unidad, onClose, onSuccess, reservaId, compradorPreFill }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cuentasPropias, setCuentasPropias] = useState<CuentaPropia[]>([])

  // Comprador
  const [nombre, setNombre] = useState(compradorPreFill?.nombre ?? '')
  const [dni, setDni] = useState(compradorPreFill?.dni ?? '')
  const [email, setEmail] = useState(compradorPreFill?.email ?? '')
  const [telefono, setTelefono] = useState(compradorPreFill?.telefono ?? '')

  // Contrato
  const [precioFinal, setPrecioFinal] = useState(String(unidad.precio_lista))
  const [entregaEfectiva, setEntregaEfectiva] = useState(
    String(Math.round(unidad.precio_lista * unidad.entrega_minima_pct / 100))
  )
  const [cantCuotas, setCantCuotas] = useState(String(unidad.max_cuotas))
  const [fechaFirma, setFechaFirma] = useState(new Date().toISOString().split('T')[0])
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

  const saldoRestante = parseFloat(precioFinal || '0') - parseFloat(entregaEfectiva || '0')
  const montoCuota = cantCuotas ? saldoRestante / parseInt(cantCuotas) : 0

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

      // 2. Crear contrato (el trigger de Supabase genera las cuotas)
      const { error: errContrato } = await supabase.from('contratos_venta').insert({
        unidad_id: unidad.id,
        comprador_id: compradorId,
        precio_final: parseFloat(precioFinal),
        entrega_efectiva: parseFloat(entregaEfectiva),
        cantidad_cuotas: parseInt(cantCuotas),
        fecha_firma: fechaFirma,
        cuenta_propia_id: cuentaPropiaId || null,
        notas: notas || null,
      })

      if (errContrato) throw new Error(errContrato.message)

      // 3. Actualizar estado de la unidad
      await supabase
        .from('unidades')
        .update({ estado_comercial: 'Vendido' })
        .eq('id', unidad.id)

      // 4. Si viene de una reserva, marcarla como Convertida
      if (reservaId) {
        await supabase
          .from('reservas')
          .update({ estado: 'Convertida' })
          .eq('id', reservaId)
      }

      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Cierre de Venta</h2>
            <p className="text-slate-500 text-sm">
              Unidad P{unidad.piso} - {unidad.numero}{unidad.letra ?? ''} &bull; {unidad.tipologias.nombre}
              {reservaId && (
                <span className="ml-2 text-amber-600 text-xs font-medium bg-amber-50 px-2 py-0.5 rounded-full">
                  Desde reserva
                </span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Datos del comprador */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
              Datos del Comprador
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

          {/* Términos del contrato */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
              Términos del Contrato
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Precio final (USD) *</label>
                <input required type="number" min="0" step="0.01" value={precioFinal}
                  onChange={e => setPrecioFinal(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Entrega efectiva (USD) *</label>
                <input required type="number" min="0" step="0.01" value={entregaEfectiva}
                  onChange={e => setEntregaEfectiva(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Cantidad de cuotas *</label>
                <input required type="number" min="1" max={unidad.max_cuotas} value={cantCuotas}
                  onChange={e => setCantCuotas(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de firma *</label>
                <input required type="date" value={fechaFirma} onChange={e => setFechaFirma(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Cuenta donde ingresa la entrega
                </label>
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

          {/* Resumen calculado */}
          <div className="bg-slate-50 rounded-xl p-4 space-y-2">
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Resumen</h3>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Saldo a financiar</span>
              <span className="font-semibold text-slate-900">{formatCurrency(saldoRestante)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Valor cuota estimado</span>
              <span className="font-semibold text-indigo-600">
                {isNaN(montoCuota) ? '-' : formatCurrency(montoCuota)} x {cantCuotas || '?'} cuotas
              </span>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
                         text-white rounded-lg text-sm font-semibold transition-colors">
              {loading ? 'Guardando...' : 'Confirmar Venta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
