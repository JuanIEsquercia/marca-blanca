'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency, formatDate, ESTADO_COLORS } from '@/lib/utils'
import type { Cuota, ContratoVenta, Comprador, Unidad, Tipologia, CuentaPropia } from '@/types/database'

type ContratoConRelaciones = ContratoVenta & {
  compradores: Comprador
  unidades: Unidad & { tipologias: Tipologia }
  cuotas: Cuota[]
}

interface Props {
  contratos: ContratoConRelaciones[]
  cuentasPropias: CuentaPropia[]
  initialContratoId?: string
}

export default function CuentaCorriente({ contratos, cuentasPropias, initialContratoId }: Props) {
  const router = useRouter()
  const today = new Date().toISOString().split('T')[0]

  const [busqueda, setBusqueda] = useState('')
  const [soloVencidas, setSoloVencidas] = useState(false)
  const [contratoSeleccionado, setContratoSeleccionado] = useState<ContratoConRelaciones | null>(
    initialContratoId ? (contratos.find(c => c.id === initialContratoId) ?? null) : null
  )
  const [isPending, startTransition] = useTransition()

  // Modal de pago
  const [pagoModal, setPagoModal] = useState<{ cuotaId: string; monto: number } | null>(null)
  const [pagoCuenta, setPagoCuenta] = useState('')
  const [pagoFecha, setPagoFecha] = useState(new Date().toISOString().split('T')[0])
  const [pagoMonto, setPagoMonto] = useState('')
  const [loadingPago, setLoadingPago] = useState(false)

  // Actualizar selección si llega un initialContratoId después del render
  useEffect(() => {
    if (initialContratoId && !contratoSeleccionado) {
      const c = contratos.find(c => c.id === initialContratoId)
      if (c) setContratoSeleccionado(c)
    }
  }, [initialContratoId, contratos, contratoSeleccionado])

  const contratosFiltrados = contratos.filter(c => {
    const matchBusqueda =
      c.compradores.nombre_completo.toLowerCase().includes(busqueda.toLowerCase()) ||
      c.compradores.dni_cuit.includes(busqueda)

    if (!matchBusqueda) return false

    if (soloVencidas) {
      const tieneVencidas = c.cuotas.some(
        q => q.estado_pago === 'Pendiente' && q.fecha_vencimiento < today
      )
      return tieneVencidas
    }

    return true
  })

  function abrirPago(cuotaId: string, monto: number) {
    setPagoModal({ cuotaId, monto })
    setPagoCuenta('')
    setPagoFecha(new Date().toISOString().split('T')[0])
    setPagoMonto(String(monto))
  }

  async function confirmarPago() {
    if (!pagoModal) return
    setLoadingPago(true)
    const supabase = createClient()
    await supabase
      .from('cuotas')
      .update({
        estado_pago: 'Pagado',
        fecha_pago: pagoFecha,
        monto_cobrado: parseFloat(pagoMonto) || pagoModal.monto,
        cuenta_propia_id: pagoCuenta || null,
      })
      .eq('id', pagoModal.cuotaId)
    setLoadingPago(false)
    setPagoModal(null)
    startTransition(() => router.refresh())
  }

  const cuotasSelected = contratoSeleccionado?.cuotas ?? []
  const vencidasSelected = cuotasSelected.filter(c => c.estado_pago === 'Pendiente' && c.fecha_vencimiento < today)
  const pendientes = cuotasSelected.filter(c => c.estado_pago === 'Pendiente').length
  const pagadas = cuotasSelected.filter(c => c.estado_pago === 'Pagado').length
  const vencidas = vencidasSelected.length

  const totalVencidasGlobal = contratos.reduce((acc, c) =>
    acc + c.cuotas.filter(q => q.estado_pago === 'Pendiente' && q.fecha_vencimiento < today).length, 0
  )

  return (
    <>
    <div className="flex gap-6 h-full">
      {/* Panel izquierdo */}
      <div className="w-80 shrink-0 flex flex-col gap-3">
        <input
          type="text"
          placeholder="Buscar por nombre o DNI..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />

        {/* Filtro vencidas */}
        <button
          onClick={() => setSoloVencidas(v => !v)}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors text-left',
            soloVencidas
              ? 'bg-red-50 border-red-300 text-red-700'
              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
          )}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          {soloVencidas ? 'Mostrando con vencidas' : 'Filtrar con cuotas vencidas'}
          {totalVencidasGlobal > 0 && (
            <span className="ml-auto text-xs bg-red-500 text-white px-1.5 py-0.5 rounded-full font-bold">
              {totalVencidasGlobal}
            </span>
          )}
        </button>

        <div className="space-y-2 overflow-y-auto flex-1">
          {contratosFiltrados.map(c => {
            const vencidasC = c.cuotas.filter(q => q.estado_pago === 'Pendiente' && q.fecha_vencimiento < today).length
            return (
              <button
                key={c.id}
                onClick={() => setContratoSeleccionado(c)}
                className={cn(
                  'w-full text-left p-3 rounded-xl border transition-colors',
                  contratoSeleccionado?.id === c.id
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                )}
              >
                <p className="font-medium text-slate-900 text-sm">{c.compradores.nombre_completo}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {c.unidades.piso}° piso · {c.unidades.tipologias.nombre}
                </p>
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  {vencidasC > 0 && (
                    <span className="text-xs font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
                      {vencidasC} vencida{vencidasC > 1 ? 's' : ''}
                    </span>
                  )}
                  <span className="text-xs text-orange-600">
                    {c.cuotas.filter(q => q.estado_pago === 'Pendiente').length} pendientes
                  </span>
                  <span className="text-xs text-slate-400">·</span>
                  <span className="text-xs text-green-600">
                    {c.cuotas.filter(q => q.estado_pago === 'Pagado').length} pagadas
                  </span>
                </div>
              </button>
            )
          })}

          {contratosFiltrados.length === 0 && (
            <p className="text-center text-slate-400 text-sm py-8">No se encontraron resultados.</p>
          )}
        </div>
      </div>

      {/* Panel derecho */}
      <div className="flex-1 overflow-auto">
        {!contratoSeleccionado ? (
          <div className="h-full flex items-center justify-center text-slate-400">
            <div className="text-center">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">Seleccioná un comprador para ver sus cuotas</p>
            </div>
          </div>
        ) : (
          <div>
            {/* Header del comprador */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {contratoSeleccionado.compradores.nombre_completo}
                  </h2>
                  <p className="text-slate-500 text-sm">
                    DNI/CUIT: {contratoSeleccionado.compradores.dni_cuit} ·{' '}
                    Unidad P{contratoSeleccionado.unidades.piso} - {contratoSeleccionado.unidades.numero}
                    {contratoSeleccionado.unidades.letra ?? ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Precio final</p>
                  <p className="font-bold text-slate-900">{formatCurrency(contratoSeleccionado.precio_final)}</p>
                </div>
              </div>
              <div className="flex gap-4 mt-3 pt-3 border-t border-slate-100">
                <div className="text-center">
                  <p className="text-xl font-bold text-slate-900">{cuotasSelected.length}</p>
                  <p className="text-xs text-slate-500">Total</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-green-600">{pagadas}</p>
                  <p className="text-xs text-slate-500">Pagadas</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-orange-500">{pendientes}</p>
                  <p className="text-xs text-slate-500">Pendientes</p>
                </div>
                {vencidas > 0 && (
                  <div className="text-center">
                    <p className="text-xl font-bold text-red-600">{vencidas}</p>
                    <p className="text-xs text-red-500">Vencidas</p>
                  </div>
                )}
              </div>
            </div>

            {/* Tabla de cuotas */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-center px-4 py-3 font-semibold text-slate-600 w-16">Nº</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Monto base</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Vencimiento</th>
                    <th className="text-center px-4 py-3 font-semibold text-slate-600">Estado</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Cobrado</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Fecha pago</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...cuotasSelected]
                    .sort((a, b) => a.numero_cuota - b.numero_cuota)
                    .map(cuota => {
                      const esVencida = cuota.estado_pago === 'Pendiente' && cuota.fecha_vencimiento < today
                      return (
                        <tr key={cuota.id}
                          className={cn('hover:bg-slate-50 transition-colors', esVencida && 'bg-red-50/40')}>
                          <td className="px-4 py-3 text-center text-slate-500">{cuota.numero_cuota}</td>
                          <td className="px-4 py-3 text-right font-medium text-slate-900">
                            {formatCurrency(cuota.monto_base)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn('text-sm', esVencida ? 'text-red-600 font-semibold' : 'text-slate-600')}>
                              {formatDate(cuota.fecha_vencimiento)}
                            </span>
                            {esVencida && (
                              <p className="text-[10px] text-red-500">Vencida</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={cn(
                              'inline-block text-xs font-medium px-2 py-0.5 rounded-full border',
                              ESTADO_COLORS[cuota.estado_pago]
                            )}>
                              {cuota.estado_pago}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-500 text-xs">
                            {cuota.monto_cobrado ? formatCurrency(cuota.monto_cobrado) : '—'}
                          </td>
                          <td className="px-4 py-3 text-slate-500 text-xs">
                            {cuota.fecha_pago ? formatDate(cuota.fecha_pago) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {cuota.estado_pago !== 'Pagado' && (
                              <button
                                onClick={() => abrirPago(cuota.id, cuota.monto_base)}
                                className={cn(
                                  'text-xs font-medium transition-colors',
                                  esVencida
                                    ? 'text-red-600 hover:text-red-800'
                                    : 'text-indigo-600 hover:text-indigo-800'
                                )}
                              >
                                Registrar pago
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>

    {/* Modal registrar pago de cuota */}
    {pagoModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
          <div className="p-6 border-b border-slate-200">
            <h2 className="font-bold text-slate-900">Registrar cobro de cuota</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Monto base: <strong>{formatCurrency(pagoModal.monto)}</strong>
            </p>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Monto cobrado *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={pagoMonto}
                onChange={e => setPagoMonto(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">Podés modificar si se cobró un monto diferente al base</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Cuenta donde se recibió el pago</label>
              <select
                value={pagoCuenta}
                onChange={e => setPagoCuenta(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Sin asignar</option>
                {cuentasPropias.filter(c => c.activa).map(c => (
                  <option key={c.id} value={c.id}>{c.nombre} ({c.moneda})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de cobro *</label>
              <input type="date" value={pagoFecha}
                onChange={e => setPagoFecha(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setPagoModal(null)}
                className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={confirmarPago}
                disabled={loadingPago || !pagoMonto}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                {loadingPago ? 'Guardando...' : 'Confirmar cobro'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
