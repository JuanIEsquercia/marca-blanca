'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import type { Reserva, Comprador, Unidad, Tipologia, CuentaPropia, EstadoReserva } from '@/types/database'
import SaleForm from './SaleForm'

type ReservaConRelaciones = Reserva & {
  compradores: Comprador
  unidades: Unidad & { tipologias: Tipologia }
  cuentas_propias: CuentaPropia | null
}

interface Props {
  reservas: ReservaConRelaciones[]
  cuentasPropias: CuentaPropia[]
}

const ESTADO_COLORS: Record<EstadoReserva, string> = {
  Vigente:    'bg-amber-50 text-amber-700 border-amber-200',
  Convertida: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Caída':    'bg-slate-100 text-slate-500 border-slate-200',
}

const FILTROS: (EstadoReserva | 'Todas')[] = ['Todas', 'Vigente', 'Convertida', 'Caída']

export default function ReservasManager({ reservas, cuentasPropias }: Props) {
  const router = useRouter()
  const [filtro, setFiltro] = useState<EstadoReserva | 'Todas'>('Todas')
  const [saleReserva, setSaleReserva] = useState<ReservaConRelaciones | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const today = new Date().toISOString().split('T')[0]

  const filtradas = filtro === 'Todas'
    ? reservas
    : reservas.filter(r => r.estado === filtro)

  function refresh() { startTransition(() => router.refresh()) }

  async function marcarCaida(reserva: ReservaConRelaciones) {
    if (!confirm(`¿Marcar como caída la reserva de ${reserva.compradores.nombre_completo}? La unidad volverá a estar disponible.`)) return
    setLoadingId(reserva.id)
    const supabase = createClient()
    await supabase.from('reservas').update({ estado: 'Caída' }).eq('id', reserva.id)
    await supabase.from('unidades').update({ estado_comercial: 'Disponible' }).eq('id', reserva.unidad_id)
    setLoadingId(null)
    refresh()
  }

  const vigentes = reservas.filter(r => r.estado === 'Vigente')
  const porVencer = vigentes.filter(r => {
    const diff = (new Date(r.fecha_vencimiento).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    return diff <= 7
  })

  return (
    <>
      {/* Alerta reservas por vencer */}
      {porVencer.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
          <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-amber-800">
            <strong>{porVencer.length} reserva{porVencer.length > 1 ? 's' : ''}</strong> vence{porVencer.length > 1 ? 'n' : ''} en los próximos 7 días.
          </p>
        </div>
      )}

      {/* Filtros */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {FILTROS.map(f => (
          <button key={f} onClick={() => setFiltro(f)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
              filtro === f
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            )}>
            {f}
            <span className="ml-1.5 text-xs opacity-70">
              ({f === 'Todas' ? reservas.length : reservas.filter(r => r.estado === f).length})
            </span>
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Interesado</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Unidad</th>
              <th className="text-right px-4 py-3 font-semibold text-slate-600">Seña</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Reservado</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Vencimiento</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtradas.map(r => {
              const diasRestantes = Math.round(
                (new Date(r.fecha_vencimiento).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
              )
              const vencida = r.estado === 'Vigente' && r.fecha_vencimiento < today
              return (
                <tr key={r.id} className={cn('hover:bg-slate-50 transition-colors', vencida && 'bg-red-50/50')}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{r.compradores.nombre_completo}</p>
                    <p className="text-xs text-slate-400 font-mono">{r.compradores.dni_cuit}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    P{r.unidades.piso} - {r.unidades.numero}{r.unidades.letra ?? ''}
                    <p className="text-xs text-slate-400">{r.unidades.tipologias.nombre}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">
                    {r.monto_sena ? formatCurrency(r.monto_sena) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(r.fecha_reserva)}</td>
                  <td className="px-4 py-3">
                    <p className={cn('text-sm', vencida ? 'text-red-600 font-semibold' : 'text-slate-600')}>
                      {formatDate(r.fecha_vencimiento)}
                    </p>
                    {r.estado === 'Vigente' && !vencida && (
                      <p className="text-xs text-slate-400">{diasRestantes} días</p>
                    )}
                    {vencida && (
                      <p className="text-xs text-red-500">Vencida</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn(
                      'inline-block text-xs font-medium px-2 py-0.5 rounded-full border',
                      ESTADO_COLORS[r.estado]
                    )}>
                      {r.estado}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.estado === 'Vigente' && (
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => setSaleReserva(r)}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                        >
                          Convertir a venta
                        </button>
                        <button
                          onClick={() => marcarCaida(r)}
                          disabled={loadingId === r.id}
                          className="text-xs text-slate-400 hover:text-red-600 transition-colors disabled:opacity-50"
                        >
                          Marcar caída
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {filtradas.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">
            No hay reservas con este filtro.
          </div>
        )}
      </div>

      {/* Modal de cierre de venta desde reserva */}
      {saleReserva && (
        <SaleForm
          unidad={saleReserva.unidades}
          reservaId={saleReserva.id}
          compradorPreFill={{
            nombre: saleReserva.compradores.nombre_completo,
            dni: saleReserva.compradores.dni_cuit,
            email: saleReserva.compradores.email ?? '',
            telefono: saleReserva.compradores.telefono ?? '',
          }}
          onClose={() => setSaleReserva(null)}
          onSuccess={() => { setSaleReserva(null); refresh() }}
        />
      )}
    </>
  )
}
