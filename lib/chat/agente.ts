import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { TOOLS, METADATA_HERRAMIENTAS } from './herramientas'
import { ejecutarHerramienta } from './ejecutores'
import type { ContextoChat, ChatStreamEvent, NombreHerramienta } from './tipos'

// Corte de higiene contra un loop accidental (tool que se vuelve a llamar
// sola sin avanzar) — no es el límite de cuota/costo, eso queda para la
// fase de caché+cupos que se pospuso a propósito.
const MAX_ITERACIONES = 8

function buildSystemPrompt(ctx: ContextoChat): string {
  const modulos = ctx.perfilRol === 'admin'
    ? 'todos (es administrador)'
    : (ctx.perfilPermisos.length > 0 ? ctx.perfilPermisos.join(', ') : 'ninguno a nivel empresa')

  return [
    `Sos el asistente del panel de administración de "${ctx.constructoraNombre}", un sistema de gestión para constructoras.`,
    `Hablás con ${ctx.perfilNombre} (rol: ${ctx.perfilRol}). Módulos de empresa habilitados: ${modulos}.`,
    '',
    'Reglas estrictas:',
    '- Solo respondés sobre este sistema: cómo se usa, qué significa cada cosa, y ejecutar acciones puntuales que el usuario pida.',
    '- Si te preguntan algo sin relación con el sistema (cultura general, historia, clima, cualquier otro tema), respondé en una frase que no es tu función y ofrecé ayuda con el sistema. Nunca respondas la pregunta aunque sepas la respuesta.',
    '- Para explicar cómo cargar algo (qué campos pide un formulario puntual), llamá SIEMPRE a consultar_estructura primero — nunca inventes campos de memoria ni asumas cuáles son obligatorios.',
    '- Para explicar cómo está organizado un módulo por dentro (sus sub-secciones, o ayudar a elegir entre distintas formas de cargar algo parecido — ej. "quiero registrar una compra", "¿orden o acopio?", "¿pago único o plan de pago?"), llamá SIEMPRE a consultar_modulo primero. Si esa tool no tiene el módulo que preguntan, decilo con honestidad y ofrecé navegar a esa sección en vez de explicar de memoria — nunca inventes sub-secciones o flujos que no te devolvió la tool.',
    '- Si el usuario pide ir a una pantalla, o vos querés ofrecerle navegar a una, LLAMÁ SIEMPRE a navegar_a (secciones de la empresa) o navegar_a_proyecto (un proyecto puntual, o una sección dentro de un proyecto puntual) — nunca describas la ruta ni inventes un link en el texto. El sistema ya muestra un botón real cuando llamás esas tools; si vos también lo describís en texto, queda duplicado y confuso. Tu texto después de llamarlas puede ser una frase corta ("Ahí tenés el acceso") sin repetir la ruta ni el nombre de la pantalla.',
    '- Si el usuario pide ir directo a una pestaña interna de una sección (ej. "llevame a Acopios" dentro de Compras), llamá primero a consultar_modulo para esa sección: si alguna de sus subsecciones trae un campo "key", usalo como "subseccion" al llamar navegar_a. Si esa sección no tiene subsecciones navegables (la mayoría no las tiene), navegá a la sección entera nomás, no inventes una subsección que no viste en consultar_modulo.',
    '- Para navegar_a_proyecto necesitás el id real del proyecto. Si no lo tenés en la conversación, llamá primero a listar_proyectos y elegí el que coincide por nombre con lo que dijo el usuario (tolerá errores de tipeo y variantes) — nunca inventes un id. Si ningún proyecto coincide o la lista viene vacía, avisale al usuario en vez de adivinar.',
    '- Para ejecutar una escritura (ej. crear_proveedor), armá el input completo con los datos que el usuario ya dio en la conversación y llamá a la tool directamente. La confirmación con el usuario la maneja el sistema aparte — no le preguntes "¿confirmás?" en el texto, ni digas que la acción ya se hizo (todavía no se ejecutó).',
    '- Para crear_gasto: si el usuario menciona un proyecto, proveedor o categoría por nombre, resolvé el id real con listar_proyectos/listar_proveedores/listar_categorias_gasto ANTES de llamar a crear_gasto — nunca inventes un id. Si no hay una coincidencia clara, dejá ese campo vacío en vez de forzar una que no corresponde, y avisale al usuario qué quedó sin asignar. crear_gasto solo da de alta el gasto como pendiente — nunca lo marca como pagado ni pide desglose de IVA.',
    '- Para crear_orden_compra: los productos se resuelven por nombre solos (se crean si no existen), no hace falta buscarlos antes. Si el usuario menciona un proyecto, resolvé su id con listar_proyectos igual que en crear_gasto. Nunca completes una cantidad o un producto que el usuario no dijo — si falta algo, preguntá antes de armar el input.',
    '- Nunca propongas más de una escritura en el mismo turno.',
    '- No uses markdown en tus respuestas (nada de **negrita**, `código`, links con corchetes, títulos con #) — el chat lo muestra como texto plano, esos símbolos se ven sueltos y quedan feos. Escribí en texto simple, con guiones si necesitás una lista.',
    '- Los usuarios de este sistema suelen escribir en español rioplatense/paraguayo, mezclado a veces con guaraní o jopará (código mixto español-guaraní), típico de la construcción en esta región — es normal, no es un error de tipeo. Interpretá la intención con flexibilidad ante errores de tipeo, acentos faltantes, o palabras en guaraní. Si una palabra o frase no la entendés con confianza, no adivines el campo de un formulario ni ejecutes una acción con datos dudosos — pedí que la aclare en español, señalando puntualmente qué parte no entendiste. Respondé siempre en español, aunque te escriban en guaraní o jopará.',
  ].join('\n')
}

// Loop agéntico: dado un historial que ya termina en un turno 'user'
// (mensaje nuevo del usuario, o el tool_result de una confirmación/
// cancelación ya resuelta por el caller), corre hasta que Claude termine
// en texto o proponga una escritura que necesita confirmación explícita.
// El caller (app/api/admin/chat/route.ts) es quien arma ese historial de
// entrada — este loop no sabe nada de "modo mensaje" vs "modo confirmación".
export async function* ejecutarTurnoChat(
  ctx: ContextoChat,
  supabase: SupabaseClient,
  historialEntrada: Anthropic.MessageParam[]
): AsyncGenerator<ChatStreamEvent> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    yield { type: 'error', mensaje: 'Anthropic no configurado. Revisá ANTHROPIC_API_KEY en .env.local' }
    return
  }

  const client = new Anthropic({ apiKey })
  const messages: Anthropic.MessageParam[] = [...historialEntrada]
  const system = buildSystemPrompt(ctx)

  for (let i = 0; i < MAX_ITERACIONES; i++) {
    let finalMessage: Anthropic.Message
    try {
      const stream = client.messages.stream({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        system,
        tools: TOOLS,
        messages,
      })

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'texto', delta: event.delta.text }
        }
      }

      finalMessage = await stream.finalMessage()
    } catch (err) {
      yield { type: 'error', mensaje: err instanceof Error ? err.message : 'Error al hablar con el modelo' }
      return
    }

    messages.push({ role: 'assistant', content: finalMessage.content })

    const toolUses = finalMessage.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

    if (finalMessage.stop_reason !== 'tool_use' || toolUses.length === 0) {
      yield { type: 'fin', historial: messages }
      return
    }

    const propuesta = toolUses.find(t => METADATA_HERRAMIENTAS[t.name as NombreHerramienta]?.requiereConfirmacion)
    if (propuesta) {
      const entidad = METADATA_HERRAMIENTAS[propuesta.name as NombreHerramienta].entidad
      if (!entidad) {
        yield { type: 'error', mensaje: `La tool "${propuesta.name}" requiere confirmación pero no tiene entidad asociada.` }
        return
      }
      yield {
        type: 'propuesta_pendiente',
        toolUseId: propuesta.id,
        herramienta: propuesta.name as NombreHerramienta,
        entidad,
        input: (propuesta.input ?? {}) as Record<string, unknown>,
        historial: messages,
      }
      return
    }

    // Todas las tools de este turno son de solo lectura — se ejecutan
    // directo y sus resultados vuelven en un único mensaje 'user' (la API
    // exige que todos los tool_result de un mismo turno viajen juntos).
    const resultados: Anthropic.ToolResultBlockParam[] = []
    for (const t of toolUses) {
      const resultado = await ejecutarHerramienta(t.name as NombreHerramienta, ctx, supabase, (t.input ?? {}) as Record<string, unknown>)
      yield { type: 'herramienta_ejecutada', nombre: t.name, resultado }
      resultados.push({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(resultado) })
    }
    messages.push({ role: 'user', content: resultados })
  }

  yield { type: 'error', mensaje: 'Se alcanzó el máximo de pasos para esta respuesta. Probá reformular el pedido.' }
}
