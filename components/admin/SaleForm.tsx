'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, redondear2 } from '@/lib/utils'
import CuentaPropiaSelect from './CuentaPropiaSelect'
import ClienteSelect, { EMPTY_CLIENTE, type ClienteValue } from './ClienteSelect'
import type { Unidad, Tipologia, CuentaPropia, Comprador } from '@/types/database'

interface CompradorPreFill {
  compradorId: string
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
  constructoraId?: string
  puedeCrearCuenta: boolean
  compradores?: Pick<Comprador, 'id' | 'nombre_completo' | 'dni_cuit' | 'email' | 'telefono'>[]
}

export default function SaleForm({ unidad, onClose, onSuccess, reservaId, compradorPreFill, constructoraId, puedeCrearCuenta, compradores = [] }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cuentasPropias, setCuentasPropias] = useState<CuentaPropia[]>([])

  // Comprador — si viene de una reserva ya convertida, precarga el
  // comprador YA vinculado (compradorId) en vez de solo copiar el texto:
  // así el submit lo reusa/actualiza en vez de crear uno nuevo por error.
  const [cliente, setCliente] = useState<ClienteValue>(
    compradorPreFill
      ? {
          compradorId: compradorPreFill.compradorId,
          nombre: compradorPreFill.nombre,
          cuit: compradorPreFill.dni,
          email: compradorPreFill.email,
          telefono: compradorPreFill.telefono,
          actualizarExistente: false,
        }
      : EMPTY_CLIENTE
  )

  // Contrato
  const [precioFinal, setPrecioFinal] = useState(String(unidad.precio_lista))
  const entregaMinima = redondear2(unidad.precio_lista * unidad.entrega_minima_pct / 100)
  const [entregaEfectiva, setEntregaEfectiva] = useState(String(entregaMinima))
  const [cantCuotas, setCantCuotas] = useState(String(unidad.max_cuotas))
  const [fechaFirma, setFechaFirma] = useState(new Date().toISOString().split('T')[0])
  const [cuentaPropiaId, setCuentaPropiaId] = useState('')
  const [cuentasNuevas, setCuentasNuevas] = useState<CuentaPropia[]>([])
  const [notas, setNotas] = useState('')
  const [senaPrevia, setSenaPrevia] = useState<number | null>(null)

  useEffect(() => {
    // Entrega efectiva es siempre USD (mismo criterio que precio_lista) —
    // solo se ofrecen cuentas USD.
    createClient()
      .from('cuentas_propias')
      .select('*')
      .eq('activa', true)
      .eq('moneda', 'USD')
      .order('nombre')
      .then(({ data }) => setCuentasPropias(data ?? []))
  }, [])

  // Si la venta viene de una reserva, la seña ya cobrada (monto_sena) es
  // plata que ya entró a una cuenta — sin este prefill, el vendedor
  // recalculaba "entrega efectiva" desde cero y esa plata quedaba sin
  // reflejarse en ningún lado (ni duplicada ni contada). La entrega
  // efectiva del contrato debe incluirla como mínimo.
  useEffect(() => {
    if (!reservaId) return
    createClient()
      .from('reservas')
      .select('monto_sena, cuenta_propia_id')
      .eq('id', reservaId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data?.monto_sena) return
        setSenaPrevia(data.monto_sena)
        setEntregaEfectiva(String(Math.max(entregaMinima, data.monto_sena)))
        if (data.cuenta_propia_id) setCuentaPropiaId(data.cuenta_propia_id)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservaId])

  const saldoRestante = parseFloat(precioFinal || '0') - parseFloat(entregaEfectiva || '0')
  const montoCuota = cantCuotas ? saldoRestante / parseInt(cantCuotas) : 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()

    try {
      // 1. Resolver comprador — ClienteSelect (o el prefill de la reserva)
      // ya dice si es uno existente (reusar o actualizar) o hay que crearlo.
      let compradorId: string

      if (cliente.compradorId) {
        compradorId = cliente.compradorId
        if (cliente.actualizarExistente) {
          const { error: errUpdate } = await supabase.from('compradores').update({
            nombre_completo: cliente.nombre.trim(),
            dni_cuit: cliente.cuit.trim() || null,
            email: cliente.email.trim() || null,
            telefono: cliente.telefono.trim() || null,
          }).eq('id', compradorId)
          if (errUpdate) throw new Error(errUpdate.message)
        }
      } else {
        const { data: nuevo, error: errComp } = await supabase
          .from('compradores')
          .insert({
            nombre_completo: cliente.nombre.trim(),
            dni_cuit: cliente.cuit.trim() || null,
            email: cliente.email.trim() || null,
            telefono: cliente.telefono.trim() || null,
            ...(constructoraId ? { constructora_id: constructoraId } : {}),
          })
          .select('id')
          .single()

        if (errComp || !nuevo) throw new Error(errComp?.message ?? 'Error al crear el comprador')
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
            <ClienteSelect compradores={compradores} value={cliente} onChange={setCliente} />
          </div>

          {/* Términos del contrato */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
              Términos del Contrato
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                {senaPrevia !== null && (
                  <p className="text-xs text-amber-600 mt-1">
                    Incluye la seña de {formatCurrency(senaPrevia)} ya cobrada en la reserva — no la vuelvas a cargar aparte.
                  </p>
                )}
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
                <CuentaPropiaSelect
                  cuentas={[...cuentasPropias, ...cuentasNuevas]}
                  onCreated={c => setCuentasNuevas(prev => [...prev, c])}
                  value={cuentaPropiaId}
                  onChange={setCuentaPropiaId}
                  constructoraId={constructoraId ?? ''}
                  obraId={unidad.obra_id}
                  puedeCrear={puedeCrearCuenta}
                  emptyLabel="Sin asignar" />
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

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 pt-2">
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
