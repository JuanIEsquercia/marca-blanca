'use client'

import { useState } from 'react'
import { cn, formatCurrency } from '@/lib/utils'
import type { StockPublico } from '@/types/database'

interface Props {
  unidad: StockPublico
}

export default function UnitCard({ unidad }: Props) {
  const [showTour, setShowTour] = useState(false)
  const isReservado = unidad.estado_comercial === 'Reservado'

  return (
    <>
      <div className={cn(
        'group relative bg-slate-900 border rounded-2xl p-6 transition-all duration-200',
        isReservado
          ? 'border-amber-800/40 opacity-75'
          : 'border-slate-800 hover:border-indigo-700 hover:bg-slate-800/60 hover:-translate-y-0.5'
      )}>
        {/* Badge estado */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-slate-400 text-xs uppercase tracking-widest">Piso {unidad.piso}</p>
            <p className="text-white font-bold text-lg">
              Unidad {unidad.numero}{unidad.letra ?? ''}
            </p>
          </div>
          <span className={cn(
            'text-xs font-semibold px-2.5 py-1 rounded-full',
            isReservado
              ? 'bg-amber-950 text-amber-400 border border-amber-800'
              : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
          )}>
            {unidad.estado_comercial}
          </span>
        </div>

        {/* Tipología + orientación */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <p className="text-indigo-400 font-semibold text-sm">{unidad.tipologia_nombre}</p>
            {unidad.orientacion && (
              <span className="text-xs text-slate-500 border border-slate-700 px-2 py-0.5 rounded-full">
                {unidad.orientacion}
              </span>
            )}
          </div>
          {unidad.tipologia_descripcion && (
            <p className="text-slate-500 text-xs mt-0.5">{unidad.tipologia_descripcion}</p>
          )}
        </div>

        {/* m2 */}
        <div className="flex gap-4 mb-5 pb-5 border-b border-slate-800">
          <div>
            <p className="text-white font-semibold">{unidad.m2_propios} m²</p>
            <p className="text-slate-500 text-xs">Propios</p>
          </div>
          <div>
            <p className="text-white font-semibold">{unidad.m2_comunes} m²</p>
            <p className="text-slate-500 text-xs">Comunes</p>
          </div>
          <div>
            <p className="text-indigo-300 font-bold">{unidad.m2_totales} m²</p>
            <p className="text-slate-500 text-xs">Totales</p>
          </div>
        </div>

        {/* Precios */}
        <div className="space-y-2 mb-4">
          <div className="flex justify-between items-baseline">
            <span className="text-slate-400 text-sm">Precio lista</span>
            <span className="text-white font-bold text-lg">{formatCurrency(unidad.precio_lista)}</span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-slate-500 text-xs">Precio por m²</span>
            <span className="text-slate-300 text-sm font-medium">{formatCurrency(unidad.precio_por_m2)}/m²</span>
          </div>
          <div className="flex justify-between items-baseline pt-2 border-t border-slate-800">
            <span className="text-slate-400 text-sm">Anticipo mín. ({unidad.entrega_minima_pct}%)</span>
            <span className="text-indigo-400 font-bold">{formatCurrency(unidad.monto_entrega_minima)}</span>
          </div>
        </div>

        <p className="text-slate-600 text-xs">Saldo en hasta {unidad.max_cuotas} cuotas</p>

        {/* Botón tour 360 */}
        {unidad.url_recorrido_360 && (
          <button
            onClick={() => setShowTour(true)}
            className="mt-4 w-full flex items-center justify-center gap-2 py-2 rounded-xl
                       border border-indigo-700 text-indigo-400 hover:bg-indigo-950 transition-colors text-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Recorrido virtual 360°
          </button>
        )}
      </div>

      {/* Modal iframe 360 */}
      {showTour && unidad.url_recorrido_360 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90"
          onClick={() => setShowTour(false)}>
          <div className="w-full max-w-5xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-white font-semibold">
                {unidad.tipologia_nombre} · P{unidad.piso} Unidad {unidad.numero}
              </p>
              <button onClick={() => setShowTour(false)} className="text-white/60 hover:text-white">
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="w-full aspect-video rounded-xl overflow-hidden">
              <iframe
                src={unidad.url_recorrido_360}
                className="w-full h-full"
                allowFullScreen
                allow="xr-spatial-tracking; gyroscope; accelerometer"
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
