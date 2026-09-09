'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, formatDate } from '@/lib/utils'
// El orden y el agrupado ya vienen resueltos por obtenerPendientes.
import {
  obtenerPendientes, etiquetaPendiente, diasDeAtraso,
  type Pendiente, type TipoPendiente,
} from '@/lib/pendientes'

interface Props {
  constructoraId: string
}

const COLOR_SEVERIDAD = {
  alta: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  media: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
} as const

export default function Notificaciones({ constructoraId }: Props) {
  const router = useRouter()
  const [pendientes, setPendientes] = useState<Pendiente[] | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [recargando, setRecargando] = useState(false)
  const contenedorRef = useRef<HTMLDivElement>(null)

  const cargar = useCallback(async () => {
    const items = await obtenerPendientes(createClient(), constructoraId)
    setPendientes(items)
  }, [constructoraId])

  // Una sola consulta por carga completa de página: este componente vive en
  // el layout, así que no se vuelve a montar al navegar dentro del panel.
  // Sin polling a propósito — un pendiente que aparece 30 segundos más
  // tarde no cambia ninguna decisión, y sondear cada X segundos por cada
  // usuario abierto sí se nota en la base.
  useEffect(() => {
    let cancelado = false
    obtenerPendientes(createClient(), constructoraId).then(items => {
      if (!cancelado) setPendientes(items)
    })
    return () => { cancelado = true }
  }, [constructoraId])

  useEffect(() => {
    function onClickFuera(e: MouseEvent) {
      if (!contenedorRef.current?.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', onClickFuera)
    return () => document.removeEventListener('mousedown', onClickFuera)
  }, [])

  const grupos = useMemo(() => {
    if (!pendientes) return []
    const out: { tipo: TipoPendiente; items: Pendiente[] }[] = []
    for (const p of pendientes) {
      const ultimo = out[out.length - 1]
      if (ultimo && ultimo.tipo === p.tipo) ultimo.items.push(p)
      else out.push({ tipo: p.tipo, items: [p] })
    }
    return out
  }, [pendientes])

  const total = pendientes?.length ?? 0
  const urgentes = pendientes?.filter(p => p.severidad === 'alta').length ?? 0

  async function abrir() {
    const proximo = !abierto
    setAbierto(proximo)
    // Al abrir se refresca: entre la carga de la página y este momento el
    // usuario pudo haber pagado justo lo que figura acá.
    if (proximo) {
      setRecargando(true)
      await cargar()
      setRecargando(false)
    }
  }

  function irA(p: Pendiente) {
    setAbierto(false)
    router.push(p.href)
  }

  return (
    <div ref={contenedorRef} className="relative shrink-0">
      <button
        type="button"
        onClick={abrir}
        aria-label={total > 0 ? `Pendientes (${total})` : 'Pendientes'}
        className={cn(
          'relative p-2 rounded-xl transition-colors',
          abierto
            ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200'
        )}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {total > 0 && (
          <span className={cn(
            'absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center',
            urgentes > 0 ? 'bg-rose-500' : 'bg-amber-500'
          )}>
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 mt-2 w-[22rem] sm:w-[26rem] z-50 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-700/90 rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-900 dark:text-white">Pendientes</p>
            {recargando && <span className="text-[11px] text-slate-400">Actualizando...</span>}
          </div>

          {pendientes === null ? (
            <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400 text-center">Cargando...</p>
          ) : total === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Todo al día</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                No hay vencimientos ni certificados trabados en lo que tenés asignado.
              </p>
            </div>
          ) : (
            <>
              <div className="max-h-[26rem] overflow-y-auto admin-scroll py-1">
                {grupos.map(grupo => (
                  <div key={grupo.tipo}>
                    <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {etiquetaPendiente(grupo.tipo)}
                    </p>
                    {grupo.items.map(p => {
                      const atraso = diasDeAtraso(p.fecha)
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => irA(p)}
                          className="w-full text-left px-4 py-2.5 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                        >
                          <span className={cn('text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 mt-0.5', COLOR_SEVERIDAD[p.severidad])}>
                            {atraso > 0 ? `${atraso}d` : atraso === 0 ? 'hoy' : `en ${-atraso}d`}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-slate-900 dark:text-white font-medium truncate">{p.titulo}</span>
                            <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{p.subtitulo}</span>
                            <span className="block text-[11px] text-slate-400 dark:text-slate-500">{formatDate(p.fecha)}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
              <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 dark:text-slate-500">
                {urgentes > 0
                  ? `${urgentes} vencido${urgentes === 1 ? '' : 's'} de ${total} pendiente${total === 1 ? '' : 's'}`
                  : `${total} pendiente${total === 1 ? '' : 's'}, ninguno vencido`}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
