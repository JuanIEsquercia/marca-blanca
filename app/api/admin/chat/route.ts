import type Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getConstructoraContext } from '@/lib/tenant'
import { crearRateLimiter } from '@/lib/auth-helpers'
import { ejecutarTurnoChat } from '@/lib/chat/agente'
import { ejecutarHerramienta } from '@/lib/chat/ejecutores'
import { METADATA_HERRAMIENTAS } from '@/lib/chat/herramientas'
import { verificarLimiteMensual } from '@/lib/chat/limite'
import type { ContextoChat, ChatStreamEvent, NombreHerramienta } from '@/lib/chat/tipos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ChatRequestBody =
  | { modo: 'mensaje'; historial: Anthropic.MessageParam[]; mensaje: string }
  | { modo: 'confirmacion'; historial: Anthropic.MessageParam[]; toolUseId: string; aprobado: boolean }

// Topes de sanidad (auditoría 2026-08-24). El historial viaja entero desde
// el cliente en cada request (ver "estado en el cable" en lib/chat/agente.ts)
// — sin esto, un usuario podía mandar megabytes de "historial" inventado y
// quemar el tope mensual de toda su constructora en pocas llamadas, o
// hacer una ráfaga de requests con el mismo efecto. Los números son
// holgados para el uso real: una charla larga de ida y vuelta con varias
// tools ejecutadas anda por los 30-60 KB.
const MAX_BYTES_BODY = 400_000
const MAX_MENSAJES_HISTORIAL = 80
const MAX_CHARS_MENSAJE = 4_000
const MAX_REQUESTS_POR_MINUTO = 30

// In-memory por instancia (misma limitación conocida que el de login, ver
// lib/auth-helpers.ts) — acota ráfagas desde una sesión, no reemplaza el
// tope mensual por constructora (lib/chat/limite.ts), que es el freno real.
const chatLimiter = crearRateLimiter(MAX_REQUESTS_POR_MINUTO, 60 * 1000)

function esMensajeParamValido(valor: unknown): valor is Anthropic.MessageParam {
  if (typeof valor !== 'object' || valor === null) return false
  const m = valor as { role?: unknown; content?: unknown }
  if (m.role !== 'user' && m.role !== 'assistant') return false
  return typeof m.content === 'string' || Array.isArray(m.content)
}

function esHistorialValido(valor: unknown): valor is Anthropic.MessageParam[] {
  return Array.isArray(valor) && valor.length <= MAX_MENSAJES_HISTORIAL && valor.every(esMensajeParamValido)
}

// Busca, en el último turno 'assistant' del historial, el bloque
// tool_use que generó la propuesta que se está confirmando/cancelando —
// el nombre y los argumentos de la tool viajan ahí, no se vuelven a pedir
// sueltos en el body (evita que el body mienta sobre qué tool corresponde
// a ese toolUseId).
function buscarToolUsePropuesto(historial: Anthropic.MessageParam[], toolUseId: string): Anthropic.ToolUseBlockParam | null {
  for (let i = historial.length - 1; i >= 0; i--) {
    const msg = historial[i]
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue
    const bloque = msg.content.find(
      (b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use' && b.id === toolUseId
    )
    if (bloque) return bloque
  }
  return null
}

function respuestaNdjson(evento: ChatStreamEvent): Response {
  return new Response(JSON.stringify(evento) + '\n', {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
  })
}

export async function POST(request: Request) {
  const ctxTenant = await getConstructoraContext()
  if (!ctxTenant) return NextResponse.json({ error: 'Sin sesión' }, { status: 401 })

  if (!chatLimiter.chequear(ctxTenant.userId)) {
    return respuestaNdjson({ type: 'error', mensaje: 'Demasiados mensajes seguidos. Esperá un minuto y volvé a intentar.' })
  }

  // Chequeo de tope ANTES de tocar el body/el modelo — un tenant bloqueado
  // no debe generar ni un token más, ni siquiera para leer la propuesta que
  // esté confirmando.
  const limite = await verificarLimiteMensual(createAdminClient(), ctxTenant.constructoraId)
  if (limite.bloqueado) {
    return respuestaNdjson({
      type: 'error',
      mensaje: `Se alcanzó el límite de uso del asistente para este mes ($${limite.costoActualUSD.toFixed(2)} de $${limite.limiteUSD.toFixed(2)}). Vuelve a estar disponible el próximo mes, o un administrador puede ampliar el límite.`,
    })
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BYTES_BODY) {
    return NextResponse.json({ error: 'La conversación es demasiado larga — empezá una nueva.' }, { status: 413 })
  }

  let body: ChatRequestBody
  try {
    const raw = await request.text()
    if (raw.length > MAX_BYTES_BODY) {
      return NextResponse.json({ error: 'La conversación es demasiado larga — empezá una nueva.' }, { status: 413 })
    }
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null || !esHistorialValido(body.historial)) {
    return NextResponse.json({ error: 'Historial inválido' }, { status: 400 })
  }

  const ctx: ContextoChat = {
    constructoraId: ctxTenant.constructoraId,
    constructoraNombre: ctxTenant.constructoraNombre,
    perfilId: ctxTenant.userId,
    perfilRol: ctxTenant.perfilRol,
    perfilPermisos: ctxTenant.perfilPermisos,
    perfilProyectos: ctxTenant.perfilProyectos,
    perfilNombre: ctxTenant.perfilNombre,
  }
  const supabase = await createClient()

  const messages: Anthropic.MessageParam[] = [...body.historial]

  if (body.modo === 'mensaje') {
    const mensaje = typeof body.mensaje === 'string' ? body.mensaje.trim() : ''
    if (!mensaje) return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 })
    if (mensaje.length > MAX_CHARS_MENSAJE) {
      return NextResponse.json({ error: `El mensaje es demasiado largo (máximo ${MAX_CHARS_MENSAJE} caracteres).` }, { status: 400 })
    }
    messages.push({ role: 'user', content: mensaje })
  } else if (body.modo === 'confirmacion') {
    if (typeof body.toolUseId !== 'string' || typeof body.aprobado !== 'boolean') {
      return NextResponse.json({ error: 'Confirmación inválida' }, { status: 400 })
    }
    const toolUse = buscarToolUsePropuesto(body.historial, body.toolUseId)
    if (!toolUse) return NextResponse.json({ error: 'No se encontró la propuesta a confirmar' }, { status: 400 })

    // El historial lo arma el cliente — solo se ejecuta por esta vía lo que
    // el sistema hubiera cortado para pedir confirmación (tools de
    // escritura). Una tool de lectura o un nombre que no existe en el
    // catálogo no tiene por qué llegar acá.
    const metadata = METADATA_HERRAMIENTAS[toolUse.name as NombreHerramienta]
    if (!metadata?.requiereConfirmacion) {
      return NextResponse.json({ error: 'Esa acción no es confirmable' }, { status: 400 })
    }

    let resultBlock: Anthropic.ToolResultBlockParam
    if (body.aprobado) {
      const resultado = await ejecutarHerramienta(
        toolUse.name as NombreHerramienta,
        ctx,
        supabase,
        (toolUse.input ?? {}) as Record<string, unknown>
      )
      resultBlock = { type: 'tool_result', tool_use_id: body.toolUseId, content: JSON.stringify(resultado) }
    } else {
      resultBlock = {
        type: 'tool_result',
        tool_use_id: body.toolUseId,
        content: 'El usuario canceló esta acción — no se ejecutó.',
        is_error: true,
      }
    }
    messages.push({ role: 'user', content: [resultBlock] })
  } else {
    return NextResponse.json({ error: 'Modo inválido' }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const body_ = new ReadableStream({
    async start(controller) {
      try {
        for await (const evento of ejecutarTurnoChat(ctx, supabase, messages)) {
          controller.enqueue(encoder.encode(JSON.stringify(evento) + '\n'))
        }
      } catch (err) {
        const evento: ChatStreamEvent = { type: 'error', mensaje: err instanceof Error ? err.message : 'Error inesperado' }
        controller.enqueue(encoder.encode(JSON.stringify(evento) + '\n'))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(body_, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
  })
}
