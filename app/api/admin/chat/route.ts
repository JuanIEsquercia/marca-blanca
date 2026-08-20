import type Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getConstructoraContext } from '@/lib/tenant'
import { ejecutarTurnoChat } from '@/lib/chat/agente'
import { ejecutarHerramienta } from '@/lib/chat/ejecutores'
import { verificarLimiteMensual } from '@/lib/chat/limite'
import type { ContextoChat, ChatStreamEvent, NombreHerramienta } from '@/lib/chat/tipos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ChatRequestBody =
  | { modo: 'mensaje'; historial: Anthropic.MessageParam[]; mensaje: string }
  | { modo: 'confirmacion'; historial: Anthropic.MessageParam[]; toolUseId: string; aprobado: boolean }

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

export async function POST(request: Request) {
  const ctxTenant = await getConstructoraContext()
  if (!ctxTenant) return NextResponse.json({ error: 'Sin sesión' }, { status: 401 })

  // Chequeo de tope ANTES de tocar el body/el modelo — un tenant bloqueado
  // no debe generar ni un token más, ni siquiera para leer la propuesta que
  // esté confirmando.
  const limite = await verificarLimiteMensual(createAdminClient(), ctxTenant.constructoraId)
  if (limite.bloqueado) {
    const evento: ChatStreamEvent = {
      type: 'error',
      mensaje: `Se alcanzó el límite de uso del asistente para este mes ($${limite.costoActualUSD.toFixed(2)} de $${limite.limiteUSD.toFixed(2)}). Vuelve a estar disponible el próximo mes, o un administrador puede ampliar el límite.`,
    }
    return new Response(JSON.stringify(evento) + '\n', {
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
    })
  }

  let body: ChatRequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
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
    if (!body.mensaje?.trim()) return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 })
    messages.push({ role: 'user', content: body.mensaje.trim() })
  } else {
    const toolUse = buscarToolUsePropuesto(body.historial, body.toolUseId)
    if (!toolUse) return NextResponse.json({ error: 'No se encontró la propuesta a confirmar' }, { status: 400 })

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
