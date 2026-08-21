'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type Anthropic from '@anthropic-ai/sdk'
import type { ChatStreamEvent } from '@/lib/chat/tipos'
import type { RolUsuario } from '@/types/database'
import type { ProyectoAsignado } from '@/lib/permisos'

interface Props {
  constructoraNombre: string
  userName: string
  userRole: RolUsuario
  permisosEmpresa: string[]
  proyectos: ProyectoAsignado[]
}

type MensajeUI =
  | { tipo: 'texto'; autor: 'usuario' | 'asistente'; texto: string }
  | { tipo: 'navegacion'; ruta: string; label: string }
  | { tipo: 'propuesta'; toolUseId: string; herramienta: string; input: Record<string, unknown>; resuelta?: 'confirmada' | 'cancelada' }

const LABEL_HERRAMIENTA: Record<string, string> = {
  crear_proveedor: 'Crear proveedor',
  crear_cliente: 'Crear cliente',
  crear_cuenta_propia: 'Crear cuenta propia',
  crear_categoria_gasto: 'Crear categoría de gasto',
  crear_personal: 'Crear persona',
  crear_cuadrilla: 'Crear cuadrilla',
  crear_gasto: 'Crear gasto',
  crear_orden_compra: 'Crear orden de compra',
  crear_certificado_avance: 'Certificar avance',
  marcar_gasto_pagado: 'Marcar gasto como pagado',
  crear_cobro: 'Crear cobro',
  marcar_cobro_cobrado: 'Marcar cobro como cobrado',
  crear_presupuesto: 'Crear presupuesto',
  crear_equipo: 'Crear equipo',
  asignar_equipo: 'Asignar equipo',
  liberar_equipo: 'Cambiar estado de equipo',
}

// Un valor de input puede ser un array de objetos (ej. "items" de una
// orden de compra) — String(valor) en eso da "[object Object]", así que
// se listan sus propios pares clave:valor en vez de mostrarlo crudo.
function formatValorPropuesta(valor: unknown): string {
  if (Array.isArray(valor)) {
    return valor
      .map((v, i) => `${i + 1}) ${typeof v === 'object' && v !== null ? formatObjeto(v as Record<string, unknown>) : String(v)}`)
      .join('  ')
  }
  if (typeof valor === 'object' && valor !== null) return formatObjeto(valor as Record<string, unknown>)
  return String(valor)
}

function formatObjeto(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .filter(([k, v]) => v !== null && v !== undefined && v !== '' && !esClaveId(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
}

// Un id (gasto_id, cuenta_propia_id, contrato_obra_item_id...) no le dice
// nada al usuario que tiene que revisar antes de confirmar — son plomería
// para el sistema, no algo verificable a simple vista. Se ocultan de la
// tarjeta de confirmación en vez de mostrar un UUID crudo.
function esClaveId(clave: string): boolean {
  return /(^|_)id$/i.test(clave)
}

function BurbujaTexto({ autor, texto }: { autor: 'usuario' | 'asistente'; texto: string }) {
  return (
    <div className={cn('flex', autor === 'usuario' ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words',
        autor === 'usuario' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800'
      )}>
        {texto || '…'}
      </div>
    </div>
  )
}

function NavegacionCard({ label, onNavegar }: { label: string; onNavegar: () => void }) {
  return (
    <div className="flex justify-start">
      <button onClick={onNavegar}
        className="max-w-[85%] flex items-center gap-2 bg-white border border-indigo-200 rounded-2xl px-3.5 py-2.5 text-sm text-indigo-700 font-medium hover:bg-indigo-50 transition-colors">
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
        {label}
      </button>
    </div>
  )
}

function PropuestaCard({
  herramienta, input, resuelta, disabled, onConfirmar, onCancelar,
}: {
  herramienta: string
  input: Record<string, unknown>
  resuelta?: 'confirmada' | 'cancelada'
  disabled: boolean
  onConfirmar: () => void
  onCancelar: () => void
}) {
  // "resumen" (marcar_gasto_pagado/marcar_cobro_cobrado) es una frase ya
  // armada por el modelo para que el usuario verifique de un vistazo, sin
  // ids — se destaca aparte y no se repite en la lista genérica de abajo.
  const resumen = typeof input.resumen === 'string' ? input.resumen : null
  const campos = Object.entries(input).filter(([k, v]) => v !== null && v !== undefined && v !== '' && k !== 'resumen' && !esClaveId(k))
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] w-full bg-white border border-amber-200 rounded-2xl p-3.5 space-y-2.5">
        <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
          {LABEL_HERRAMIENTA[herramienta] ?? herramienta}
        </p>
        {resumen && <p className="text-sm text-slate-800 font-medium">{resumen}</p>}
        <div className="space-y-1">
          {campos.map(([clave, valor]) => (
            <div key={clave} className="flex justify-between gap-3 text-xs">
              <span className="text-slate-400 shrink-0">{clave}</span>
              <span className="text-slate-700 font-medium text-right whitespace-pre-wrap">{formatValorPropuesta(valor)}</span>
            </div>
          ))}
        </div>
        {resuelta ? (
          <p className={cn('text-xs font-medium', resuelta === 'confirmada' ? 'text-emerald-600' : 'text-slate-400')}>
            {resuelta === 'confirmada' ? '✓ Confirmado' : '✕ Cancelado'}
          </p>
        ) : (
          <div className="flex gap-2 pt-1">
            <button onClick={onCancelar} disabled={disabled}
              className="flex-1 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Cancelar
            </button>
            <button onClick={onConfirmar} disabled={disabled}
              className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold">
              Confirmar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ChatAsistente({ userName }: Props) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [mensajes, setMensajes] = useState<MensajeUI[]>([])
  const [historialAPI, setHistorialAPI] = useState<Anthropic.MessageParam[]>([])
  const [input, setInput] = useState('')
  const [enviando, setEnviando] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  function scrollAbajo() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    })
  }

  async function consumirStream(body: object) {
    setEnviando(true)
    let burbujaAbierta = false

    try {
      const res = await fetch('/api/admin/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok || !res.body) {
        setMensajes(prev => [...prev, { tipo: 'texto', autor: 'asistente', texto: 'Hubo un error de conexión — probá de nuevo.' }])
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lineas = buffer.split('\n')
        buffer = lineas.pop() ?? ''

        for (const linea of lineas) {
          if (!linea.trim()) continue
          const evento = JSON.parse(linea) as ChatStreamEvent

          if (evento.type === 'texto') {
            if (burbujaAbierta) {
              setMensajes(prev => {
                const ultimo = prev[prev.length - 1]
                if (!ultimo || ultimo.tipo !== 'texto') return prev
                return [...prev.slice(0, -1), { ...ultimo, texto: ultimo.texto + evento.delta }]
              })
            } else {
              burbujaAbierta = true
              setMensajes(prev => [...prev, { tipo: 'texto', autor: 'asistente', texto: evento.delta }])
            }
          } else {
            burbujaAbierta = false
            if (evento.type === 'herramienta_ejecutada' && (evento.nombre === 'navegar_a' || evento.nombre === 'navegar_a_proyecto')) {
              const r = evento.resultado as { ruta?: string; label?: string }
              if (r.ruta && r.label) setMensajes(prev => [...prev, { tipo: 'navegacion', ruta: r.ruta!, label: r.label! }])
            } else if (evento.type === 'propuesta_pendiente') {
              setHistorialAPI(evento.historial)
              setMensajes(prev => [...prev, { tipo: 'propuesta', toolUseId: evento.toolUseId, herramienta: evento.herramienta, input: evento.input }])
            } else if (evento.type === 'fin') {
              setHistorialAPI(evento.historial)
            } else if (evento.type === 'error') {
              setMensajes(prev => [...prev, { tipo: 'texto', autor: 'asistente', texto: `⚠ ${evento.mensaje}` }])
            }
          }
          scrollAbajo()
        }
      }
    } finally {
      setEnviando(false)
      scrollAbajo()
    }
  }

  async function enviarMensaje(e: React.FormEvent) {
    e.preventDefault()
    const texto = input.trim()
    if (!texto || enviando) return
    setMensajes(prev => [...prev, { tipo: 'texto', autor: 'usuario', texto }])
    setInput('')
    scrollAbajo()
    await consumirStream({ modo: 'mensaje', historial: historialAPI, mensaje: texto })
  }

  async function resolverPropuesta(indice: number, toolUseId: string, aprobado: boolean) {
    setMensajes(prev => prev.map((m, i) =>
      i === indice && m.tipo === 'propuesta' ? { ...m, resuelta: aprobado ? 'confirmada' as const : 'cancelada' as const } : m
    ))
    await consumirStream({ modo: 'confirmacion', historial: historialAPI, toolUseId, aprobado })
  }

  return (
    <>
      <button onClick={() => setAbierto(v => !v)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-2xl flex items-center justify-center transition-colors">
        {abierto ? (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8-1.06 0-2.076-.163-3.02-.462L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        )}
      </button>

      {abierto && (
        <div className="fixed right-0 top-0 h-full w-full sm:w-[420px] z-50 bg-white shadow-2xl flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-slate-200 shrink-0">
            <div>
              <h2 className="font-bold text-slate-900 text-sm">Asistente</h2>
              <p className="text-xs text-slate-400">Hola {userName.split(' ')[0]} — preguntame sobre el sistema</p>
            </div>
            <button onClick={() => setAbierto(false)} className="text-slate-400 hover:text-slate-600">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {mensajes.length === 0 && (
              <p className="text-sm text-slate-400 text-center mt-8">
                Preguntame cómo hacer algo en el sistema, o pedime que lo cargue por vos.
              </p>
            )}
            {mensajes.map((m, i) => {
              if (m.tipo === 'texto') return <BurbujaTexto key={i} autor={m.autor} texto={m.texto} />
              if (m.tipo === 'navegacion') {
                return <NavegacionCard key={i} label={m.label} onNavegar={() => { router.push(m.ruta); setAbierto(false) }} />
              }
              return (
                <PropuestaCard key={i} herramienta={m.herramienta} input={m.input} resuelta={m.resuelta}
                  disabled={enviando || !!m.resuelta}
                  onConfirmar={() => resolverPropuesta(i, m.toolUseId, true)}
                  onCancelar={() => resolverPropuesta(i, m.toolUseId, false)} />
              )
            })}
          </div>

          <form onSubmit={enviarMensaje} className="p-3 border-t border-slate-200 flex gap-2 shrink-0">
            <input value={input} onChange={e => setInput(e.target.value)} disabled={enviando}
              placeholder="Escribí tu pregunta..."
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60" />
            <button type="submit" disabled={enviando || !input.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors">
              {enviando ? '...' : 'Enviar'}
            </button>
          </form>
        </div>
      )}
    </>
  )
}
