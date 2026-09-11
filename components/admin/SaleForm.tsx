'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, redondear2 } from '@/lib/utils'
import CuentaPropiaSelect from './CuentaPropiaSelect'
import ClienteSelect, { EMPTY_CLIENTE, type ClienteValue } from './ClienteSelect'
import type { Unidad, Tipologia, CuentaPropia, Comprador, MonedaPlan } from '@/types/database'

// Cómo se puede pactar el plan de cuotas. El precio de la unidad es SIEMPRE
// en dólares — eso no se elige. Lo que se elige acá es en qué queda el plan
// de cuotas, que es donde el mercado argentino realmente varía.
const FORMAS_DE_PAGO = [
  {
    id: 'usd',
    label: 'Cuotas en dólares',
    detalle: 'El saldo se divide en cuotas fijas en dólares. No se ajustan.',
    moneda: 'USD' as MonedaPlan,
    indice: null as string | null,
  },
  {
    id: 'ars_dolar',
    label: 'Cuotas en pesos al dólar del día',
    detalle: 'Cada cuota se emite al valor del dólar de ese momento. En dólares, el saldo no cambia.',
    moneda: 'ARS' as MonedaPlan,
    indice: 'USD_MINORISTA' as string | null,
  },
  {
    id: 'ars_cac',
    label: 'Cuotas en pesos ajustables por CAC',
    detalle: 'Índice de costo de la construcción. Se carga a mano: no tiene API pública.',
    moneda: 'ARS' as MonedaPlan,
    indice: 'CAC' as string | null,
  },
  {
    id: 'ars_uva',
    label: 'Cuotas en pesos ajustables por UVA',
    detalle: 'Unidad de Valor Adquisitivo, sigue la inflación. La publica el BCRA todos los días.',
    moneda: 'ARS' as MonedaPlan,
    indice: 'UVA' as string | null,
  },
  {
    id: 'ars_fijo',
    label: 'Cuotas en pesos fijos',
    detalle: 'Sin ajuste. El monto en pesos queda clavado desde la firma.',
    moneda: 'ARS' as MonedaPlan,
    indice: null as string | null,
  },
] as const

type FormaPagoId = (typeof FORMAS_DE_PAGO)[number]['id']

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

  // Plan de cuotas (migration_079 + migration_080)
  const [formaPago, setFormaPago] = useState<FormaPagoId>('usd')
  const [cotizacion, setCotizacion] = useState('')
  const [tasaMora, setTasaMora] = useState('')
  const [cotizacionHoy, setCotizacionHoy] = useState<number | null>(null)
  const forma = FORMAS_DE_PAGO.find(f => f.id === formaPago)!
  const cuotasEnPesos = forma.moneda === 'ARS'
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

  // Cotización publicada a la fecha de firma. Es solo una sugerencia: lo
  // que vale es lo que las partes pactaron, y por eso el campo es editable.
  useEffect(() => {
    if (!cuotasEnPesos) return
    let vigente = true
    createClient()
      .rpc('valor_indice', { p_tipo: 'USD_MINORISTA', p_fecha: fechaFirma })
      .then(({ data }) => {
        if (!vigente) return
        const v = data == null ? null : Number(data)
        setCotizacionHoy(v)
        setCotizacion(prev => prev || (v == null ? '' : String(v)))
      })
    return () => { vigente = false }
  }, [cuotasEnPesos, fechaFirma])

  const saldoRestante = parseFloat(precioFinal || '0') - parseFloat(entregaEfectiva || '0')
  const cotizacionNum = parseFloat(cotizacion || '0')
  // El saldo nace en dólares siempre; si las cuotas van en pesos, se
  // convierte a la cotización pactada. Esa conversión ocurre UNA vez, al
  // firmar — después el plan vive en su propia moneda.
  const saldoPlan = cuotasEnPesos && cotizacionNum > 0 ? saldoRestante * cotizacionNum : saldoRestante
  const montoCuota = cantCuotas ? saldoPlan / parseInt(cantCuotas) : 0

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
        // El precio y la entrega van en dólares siempre; esto describe solo
        // el plan de cuotas. El trigger de la base convierte el saldo y
        // calcula las unidades de índice pactadas.
        cuotas_moneda: forma.moneda,
        indice_tipo: forma.indice,
        cotizacion_pactada: cuotasEnPesos && cotizacionNum > 0 ? cotizacionNum : null,
        tasa_mora_diaria: tasaMora ? parseFloat(tasaMora) : null,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Cierre de Venta</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Unidad P{unidad.piso} - {unidad.numero}{unidad.letra ?? ''} &bull; {unidad.tipologias.nombre}
              {reservaId && (
                <span className="ml-2 text-amber-600 dark:text-amber-400 text-xs font-medium bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                  Desde reserva
                </span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Datos del comprador */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-3">
              Datos del Comprador
            </h3>
            <ClienteSelect compradores={compradores} value={cliente} onChange={setCliente} />
          </div>

          {/* Términos del contrato */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-3">
              Términos del Contrato
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Precio final (USD) *</label>
                <input required type="number" min="0" step="0.01" value={precioFinal}
                  onChange={e => setPrecioFinal(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Entrega efectiva (USD) *</label>
                <input required type="number" min="0" step="0.01" value={entregaEfectiva}
                  onChange={e => setEntregaEfectiva(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                {senaPrevia !== null && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    Incluye la seña de {formatCurrency(senaPrevia)} ya cobrada en la reserva — no la vuelvas a cargar aparte.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Cantidad de cuotas *</label>
                <input required type="number" min="1" max={unidad.max_cuotas} value={cantCuotas}
                  onChange={e => setCantCuotas(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Fecha de firma *</label>
                <input required type="date" value={fechaFirma} onChange={e => setFechaFirma(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
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
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Notas</label>
                <textarea rows={2} value={notas} onChange={e => setNotas(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>
            </div>
          </div>

          {/* Plan de cuotas */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-1">
              Plan de Cuotas
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              El precio y la entrega son siempre en dólares. Acá se define únicamente cómo se pactan las cuotas.
            </p>
            <div className="space-y-2">
              {FORMAS_DE_PAGO.map(f => (
                <label key={f.id}
                  className={`flex gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    formaPago === f.id
                      ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}>
                  <input type="radio" name="forma-pago" value={f.id} checked={formaPago === f.id}
                    onChange={() => setFormaPago(f.id)} className="mt-0.5 accent-indigo-600" />
                  <span>
                    <span className="block text-sm font-medium text-slate-900 dark:text-white">{f.label}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{f.detalle}</span>
                  </span>
                </label>
              ))}
            </div>

            {cuotasEnPesos && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Cotización pactada ($ por US$) *
                  </label>
                  <input required type="number" min="0" step="0.01" value={cotizacion}
                    onChange={e => setCotizacion(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                    {cotizacionHoy != null
                      ? `Dólar minorista publicado al ${fechaFirma}: ${cotizacionHoy}. Cambialo si pactaron otro.`
                      : 'No hay cotización publicada para esa fecha. Cargá la que pactaron.'}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Interés por mora (% diario)
                  </label>
                  <input type="number" min="0" step="0.01" value={tasaMora} placeholder="Sin mora"
                    onChange={e => setTasaMora(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                    Sobre el capital, desde el vencimiento. No se capitaliza y podés no cobrarlo al recibir el pago.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Resumen calculado */}
          <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/50 rounded-xl p-4 space-y-2">
            <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-3">Resumen</h3>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-400">Saldo a financiar</span>
              <span className="font-semibold text-slate-900 dark:text-white">
                {formatCurrency(saldoRestante)}
                {cuotasEnPesos && cotizacionNum > 0 && (
                  <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">
                    = {formatCurrency(saldoPlan, 'ARS')}
                  </span>
                )}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-400">
                Valor cuota {forma.indice ? 'inicial' : 'estimado'}
              </span>
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                {isNaN(montoCuota) ? '-' : formatCurrency(montoCuota, forma.moneda)} x {cantCuotas || '?'} cuotas
              </span>
            </div>
            {forma.indice && (
              <p className="text-xs text-amber-600 dark:text-amber-400 pt-1">
                Cada cuota se ajusta hasta que la emitís. Al emitirla, el monto queda congelado y no vuelve a moverse.
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
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
