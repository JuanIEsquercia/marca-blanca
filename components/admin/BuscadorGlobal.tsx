'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { ProyectoAsignado } from '@/lib/permisos'
import { getCurrentProyecto, subscribeProyecto } from '@/lib/proyecto-store'
import {
  buscarSecciones, buscarDatos, etiquetaTipo, etiquetaGrupo, ORDEN_TIPOS,
  type ContextoBuscador, type ResultadoBusqueda, type TipoResultado,
} from '@/lib/buscador'

interface Props {
  rol: string
  permisosEmpresa: string[]
  proyectos: ProyectoAsignado[]
  onNavegar?: () => void
}

const MIN_CHARS_DATOS = 2
const DEBOUNCE_MS = 250

// Resultados de la RPC atados al término que los produjo. Guardarlos así
// (en vez de limpiarlos con un efecto cuando cambia el input) evita mostrar
// los de "prov" mientras se está tipeando "proveedor", y evita el
// setState-dentro-de-efecto que React desaconseja.
interface CacheDatos { termino: string; items: ResultadoBusqueda[] }

const COLOR_TIPO: Record<TipoResultado, string> = {
  seccion: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  proyecto: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  proveedor: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  cliente: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  unidad: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  presupuesto: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
}

export default function BuscadorGlobal({ rol, permisosEmpresa, proyectos, onNavegar }: Props) {
  const router = useRouter()
  const [termino, setTermino] = useState('')
  const [datos, setDatos] = useState<CacheDatos>({ termino: '', items: [] })
  const [abierto, setAbierto] = useState(false)
  const [indiceActivo, setIndiceActivo] = useState(0)
  const contenedorRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)

  // El proyecto actual se lee del store (igual que AdminBreadcrumbs) en vez
  // de recibirlo por prop: así el buscador puede vivir en la barra superior
  // sin depender de que el sidebar se lo pase.
  const proyectoStore = useSyncExternalStore(subscribeProyecto, getCurrentProyecto, () => null)

  const terminoLimpio = termino.trim()

  const ctx: ContextoBuscador = useMemo(() => ({
    rol,
    permisosEmpresa,
    proyectos,
    proyectoActual: proyectoStore
      ? {
          id: proyectoStore.id,
          nombre: proyectoStore.nombre,
          tipo: proyectoStore.tipo as 'desarrollo' | 'obra',
          modoCuentas: (proyectoStore.modo_cuentas ?? 'empresa') as 'empresa' | 'especificas',
        }
      : null,
  }), [rol, permisosEmpresa, proyectos, proyectoStore])

  // Las secciones se filtran en memoria: son ~25 entradas de un catálogo
  // que ya está en el bundle. Sin request, sin debounce, sin espera.
  const secciones = useMemo(
    () => (terminoLimpio ? buscarSecciones(terminoLimpio, ctx) : []),
    [terminoLimpio, ctx]
  )

  // Lista plana en el orden en que se renderiza — es la que numera el
  // teclado, así que tiene que coincidir con el orden visual de los grupos.
  const resultados = useMemo(() => {
    const items = [...secciones, ...(datos.termino === terminoLimpio ? datos.items : [])]
    return items.sort((a, b) => ORDEN_TIPOS.indexOf(a.tipo) - ORDEN_TIPOS.indexOf(b.tipo))
  }, [secciones, datos, terminoLimpio])

  // Mismos resultados, partidos en grupos consecutivos. `offset` es el
  // índice plano del primer ítem del grupo, para que la navegación por
  // teclado siga funcionando sobre la lista agrupada.
  const grupos = useMemo(() => {
    const out: { tipo: TipoResultado; items: ResultadoBusqueda[]; offset: number }[] = []
    resultados.forEach((r, i) => {
      const ultimo = out[out.length - 1]
      if (ultimo && ultimo.tipo === r.tipo) ultimo.items.push(r)
      else out.push({ tipo: r.tipo, items: [r], offset: i })
    })
    return out
  }, [resultados])

  // "Estamos buscando" se DERIVA de que lo guardado no coincida con lo
  // tipeado, en vez de guardarse en su propio estado: así el efecto no
  // necesita un setState sincrónico y el flag no puede quedar
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

  // Que el ítem activo por teclado quede siempre a la vista cuando la lista
  // es más larga que el panel.
  useEffect(() => {
    listaRef.current?.querySelector<HTMLElement>(`[data-indice="${indiceActivo}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [indiceActivo])

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
    <div ref={contenedorRef} className="relative w-full max-w-xl">
      <div className="relative">
        <svg className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
        </svg>
        <input
          ref={inputRef}
          value={termino}
          onChange={e => { setTermino(e.target.value); setAbierto(true); setIndiceActivo(0) }}
          onFocus={() => setAbierto(true)}
          onKeyDown={onKeyDown}
          placeholder="Buscar secciones, proyectos, proveedores, clientes..."
          aria-label="Buscar en el panel"
          className="w-full bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl pl-9 pr-16 py-2 text-sm text-slate-900 dark:text-white
                     placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 transition-all"
        />
        {termino ? (
          <button type="button" onClick={() => { setTermino(''); inputRef.current?.focus() }}
            aria-label="Limpiar búsqueda"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 text-sm leading-none">
            ✕
          </button>
        ) : (
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded px-1.5 py-0.5 pointer-events-none hidden sm:block font-mono">
            Ctrl K
          </kbd>
        )}
      </div>

      {mostrarPanel && (
        <div className="absolute left-0 right-0 mt-2 z-50 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-700/90 rounded-2xl shadow-2xl overflow-hidden">
          {resultados.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {buscandoDatos
                  ? 'Buscando...'
                  : terminoLimpio.length < MIN_CHARS_DATOS
                    ? 'Escribí al menos 2 letras para buscar datos'
                    : `Sin resultados para "${terminoLimpio}"`}
              </p>
              {!buscandoDatos && terminoLimpio.length >= MIN_CHARS_DATOS && (
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  Se buscan secciones, proyectos, proveedores, clientes, unidades y presupuestos.
                </p>
              )}
            </div>
          ) : (
            <>
              <div ref={listaRef} className="max-h-[26rem] overflow-y-auto admin-scroll py-1">
                {grupos.map(grupo => (
                  <div key={grupo.tipo}>
                    <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {etiquetaGrupo(grupo.tipo)}
                    </p>
                    {grupo.items.map((r, j) => {
                      const indice = grupo.offset + j
                      return (
                        <button
                          key={r.id}
                          type="button"
                          data-indice={indice}
                          onMouseEnter={() => setIndiceActivo(indice)}
                          onClick={() => irA(r)}
                          className={cn(
                            'w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors',
                            indice === indiceActivo ? 'bg-indigo-50 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                          )}
                        >
                          <span className={cn('text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 w-20 text-center', COLOR_TIPO[r.tipo])}>
                            {etiquetaTipo(r.tipo)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-slate-900 dark:text-white font-medium truncate">{r.titulo}</span>
                            <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{r.subtitulo}</span>
                          </span>
                          {indice === indiceActivo && (
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 hidden sm:block">Enter ↵</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
              <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500">
                <span>{buscandoDatos ? 'Buscando datos...' : `${resultados.length} resultado${resultados.length === 1 ? '' : 's'}`}</span>
                <span className="hidden sm:block">↑↓ para moverte · Esc para cerrar</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
