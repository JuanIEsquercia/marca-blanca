'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  buscarSecciones, buscarDatos, etiquetaTipo,
  type ContextoBuscador, type ResultadoBusqueda,
} from '@/lib/buscador'

interface Props {
  ctx: ContextoBuscador
  onNavegar?: () => void
}

const MIN_CHARS_DATOS = 2
const DEBOUNCE_MS = 250

// Resultados de la RPC atados al término que los produjo. Guardarlos así
// (en vez de limpiarlos con un efecto cuando cambia el input) evita mostrar
// los resultados de "prov" mientras se está tipeando "proveedor", y evita
// el setState-dentro-de-efecto que React desaconseja.
interface CacheDatos { termino: string; items: ResultadoBusqueda[] }

const COLOR_TIPO: Record<string, string> = {
  seccion: 'bg-slate-700 text-slate-300',
  proyecto: 'bg-indigo-500/20 text-indigo-300',
  proveedor: 'bg-amber-500/20 text-amber-300',
  cliente: 'bg-emerald-500/20 text-emerald-300',
  unidad: 'bg-sky-500/20 text-sky-300',
  presupuesto: 'bg-violet-500/20 text-violet-300',
}

export default function BuscadorGlobal({ ctx, onNavegar }: Props) {
  const router = useRouter()
  const [termino, setTermino] = useState('')
  const [datos, setDatos] = useState<CacheDatos>({ termino: '', items: [] })
  const [abierto, setAbierto] = useState(false)
  const [indiceActivo, setIndiceActivo] = useState(0)
  const contenedorRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const terminoLimpio = termino.trim()

  // Las secciones se filtran en memoria: son ~25 entradas de un catálogo
  // que ya está en el bundle. Sin request, sin debounce, sin espera.
  const secciones = useMemo(
    () => (terminoLimpio ? buscarSecciones(terminoLimpio, ctx) : []),
    [terminoLimpio, ctx]
  )

  // Los datos guardados solo cuentan si corresponden al término actual —
  // ver CacheDatos arriba.
  const resultados = useMemo(
    () => [...secciones, ...(datos.termino === terminoLimpio ? datos.items : [])],
    [secciones, datos, terminoLimpio]
  )

  // "Estamos buscando" se DERIVA de que lo guardado no coincida con lo
  // tipeado, en vez de guardarse en su propio estado: así el efecto no
  // necesita un setState sincrónico y no hay forma de que el flag quede
  // desincronizado de los resultados.
  const buscandoDatos = terminoLimpio.length >= MIN_CHARS_DATOS && datos.termino !== terminoLimpio

  useEffect(() => {
    if (terminoLimpio.length < MIN_CHARS_DATOS) return
    let cancelado = false
    const id = setTimeout(async () => {
      const items = await buscarDatos(createClient(), terminoLimpio)
      if (!cancelado) setDatos({ termino: terminoLimpio, items })
    }, DEBOUNCE_MS)
    return () => { cancelado = true; clearTimeout(id) }
  }, [terminoLimpio])

  // Ctrl/Cmd+K desde cualquier parte del panel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    function onClickFuera(e: MouseEvent) {
      if (!contenedorRef.current?.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', onClickFuera)
    return () => document.removeEventListener('mousedown', onClickFuera)
  }, [])

  const irA = useCallback((r: ResultadoBusqueda) => {
    setAbierto(false)
    setTermino('')
    onNavegar?.()
    router.push(r.href)
  }, [router, onNavegar])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setAbierto(false); inputRef.current?.blur(); return }
    if (resultados.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndiceActivo(i => (i + 1) % resultados.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndiceActivo(i => (i - 1 + resultados.length) % resultados.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const elegido = resultados[Math.min(indiceActivo, resultados.length - 1)]
      if (elegido) irA(elegido)
    }
  }

  const mostrarPanel = abierto && terminoLimpio.length > 0

  return (
    <div ref={contenedorRef} className="relative px-3 pb-2">
      <div className="relative">
        <svg className="w-4 h-4 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
        </svg>
        <input
          ref={inputRef}
          value={termino}
          onChange={e => { setTermino(e.target.value); setAbierto(true); setIndiceActivo(0) }}
          onFocus={() => setAbierto(true)}
          onKeyDown={onKeyDown}
          placeholder="Buscar..."
          aria-label="Buscar secciones y datos"
          className="w-full bg-slate-850 border border-slate-700 rounded-lg pl-8 pr-9 py-1.5 text-sm text-white
                     placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-transparent"
        />
        {termino ? (
          <button type="button" onClick={() => { setTermino(''); inputRef.current?.focus() }}
            aria-label="Limpiar búsqueda"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-sm leading-none">
            ✕
          </button>
        ) : (
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 border border-slate-700 rounded px-1 py-0.5 pointer-events-none hidden lg:block">
            ⌘K
          </kbd>
        )}
      </div>

      {mostrarPanel && (
        <div className="absolute left-3 right-3 mt-1 z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden max-h-80 overflow-y-auto admin-scroll">
          {resultados.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-500">
              {buscandoDatos
                ? 'Buscando...'
                : terminoLimpio.length < MIN_CHARS_DATOS
                  ? 'Escribí al menos 2 letras para buscar datos.'
                  : 'Sin resultados.'}
            </p>
          ) : (
            <>
              {resultados.map((r, i) => (
                <button
                  key={r.id}
                  type="button"
                  onMouseEnter={() => setIndiceActivo(i)}
                  onClick={() => irA(r)}
                  className={cn(
                    'w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors',
                    i === indiceActivo ? 'bg-slate-800' : 'hover:bg-slate-850'
                  )}
                >
                  <span className={cn('text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0', COLOR_TIPO[r.tipo])}>
                    {etiquetaTipo(r.tipo)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-white truncate">{r.titulo}</span>
                    <span className="block text-[11px] text-slate-500 truncate">{r.subtitulo}</span>
                  </span>
                </button>
              ))}
              {buscandoDatos && (
                <p className="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-800">Buscando datos...</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
