import type Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { generarEmbedding, MODELO_EMBEDDING } from '@/lib/voyage'
import type { ContextoChat, NombreHerramienta } from './tipos'

// Caché semántica de preguntas frecuentes (migration_075). Ver el
// comentario de esa migración para el porqué; acá vive el "qué se puede
// cachear", que es la parte delicada: la tabla es GLOBAL entre tenants.
//
// La regla es mecánica, nunca a criterio del modelo: estas dos tools leen
// catálogos estáticos de TypeScript (catalogo-entidades.ts,
// catalogo-modulos.ts), no la base — su resultado es idéntico para
// cualquier constructora. Cualquier otra tool toca datos del tenant, o está
// gateada por permisos (navegar_a devuelve error si al usuario le falta el
// módulo), y descalifica el turno entero.
const HERRAMIENTAS_CACHEABLES: NombreHerramienta[] = ['consultar_estructura', 'consultar_modulo']

// Umbral de similitud coseno para servir una respuesta cacheada.
//
// SIN CALIBRAR CONTRA DATOS REALES TODAVÍA: no se pudo alcanzar la API de
// Voyage desde el entorno donde se escribió esto. 0.95 es deliberadamente
// conservador — es preferible un miss (se paga la llamada, como hoy) a un
// hit equivocado. El riesgo concreto a medir es el par de preguntas casi
// idénticas pero de entidades distintas ("¿cómo cargo un gasto?" vs "¿cómo
// cargo un cobro?"): si su similitud queda por encima del umbral, el chat
// contestaría lo que no es. Para calibrar: correr scripts/calibrar-faq-cache.mjs,
// que imprime la similitud de parafraseos contra la de preguntas vecinas.
const UMBRAL_SIMILITUD = 0.95

// Una pregunta muy larga no es una "consulta básica del sistema", es un
// pedido con contexto propio — no tiene sentido cachearla.
const MAX_CHARS_PREGUNTA = 300

function bloquesToolUse(mensajes: Anthropic.MessageParam[]): string[] {
  const nombres: string[] = []
  for (const m of mensajes) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue
    for (const b of m.content) {
      if (typeof b === 'object' && b !== null && 'type' in b && b.type === 'tool_use') {
        nombres.push((b as Anthropic.ToolUseBlockParam).name)
      }
    }
  }
  return nombres
}

export function herramientasSonCacheables(mensajes: Anthropic.MessageParam[]): boolean {
  return bloquesToolUse(mensajes).every(n => (HERRAMIENTAS_CACHEABLES as string[]).includes(n))
}

export function herramientasUsadas(mensajes: Anthropic.MessageParam[]): string[] {
  return [...new Set(bloquesToolUse(mensajes))]
}

// Devuelve la pregunta solo si este turno es candidato a caché: tiene que
// ser el PRIMER mensaje de la conversación. Un seguimiento ("¿y eso cómo se
// hace?") depende del contexto anterior, así que su respuesta no sirve para
// otra persona que escriba exactamente lo mismo.
export function preguntaCacheable(historial: Anthropic.MessageParam[]): string | null {
  if (historial.length !== 1) return null
  const primero = historial[0]
  if (primero.role !== 'user' || typeof primero.content !== 'string') return null
  const texto = primero.content.trim()
  if (!texto || texto.length > MAX_CHARS_PREGUNTA) return null
  return texto
}

interface FilaFaq { id: string; pregunta: string; respuesta: string; similitud: number }

export interface RespuestaCacheada {
  id: string
  respuesta: string
  similitud: number
  preguntaOriginal: string
}

export async function buscarRespuestaCacheada(pregunta: string): Promise<RespuestaCacheada | null> {
  try {
    const emb = await generarEmbedding(pregunta, 'query')
    if (!emb) return null

    const { data, error } = await createAdminClient().rpc('buscar_faq_cache', {
      p_embedding: JSON.stringify(emb.embedding),
      p_modelo: MODELO_EMBEDDING,
      p_umbral: UMBRAL_SIMILITUD,
    })
    if (error) return null

    const fila = ((data ?? []) as FilaFaq[])[0]
    if (!fila) return null
    return { id: fila.id, respuesta: fila.respuesta, similitud: fila.similitud, preguntaOriginal: fila.pregunta }
  } catch {
    // La caché nunca puede tirar abajo una respuesta: si Voyage no responde
    // o la RPC falla, se sigue por el camino normal (llamar al modelo).
    return null
  }
}

export async function registrarHit(id: string): Promise<void> {
  try {
    await createAdminClient().rpc('registrar_hit_faq_cache', { p_id: id })
  } catch {
    // métrica, no funcionalidad
  }
}

// Última barrera antes de escribir en una tabla compartida entre tenants: el
// modelo tiene el nombre de la constructora y del usuario en su contexto y
// puede haber personalizado la respuesta ("en Constructora X, para cargar
// un gasto..."). La lista blanca de tools ya hace el trabajo pesado; esto
// atrapa el caso de la personalización en prosa.
function contieneDatosDelTenant(texto: string, ctx: ContextoChat): boolean {
  const t = texto.toLowerCase()
  const nombres = [ctx.constructoraNombre, ctx.perfilNombre]
    .map(n => n?.trim().toLowerCase())
    .filter((n): n is string => !!n && n.length >= 3)
  return nombres.some(n => t.includes(n))
}

export async function guardarRespuestaCacheada(
  ctx: ContextoChat,
  pregunta: string,
  respuesta: string,
  mensajesDelTurno: Anthropic.MessageParam[]
): Promise<void> {
  try {
    const texto = respuesta.trim()
    if (!texto || texto.length < 40) return
    if (!herramientasSonCacheables(mensajesDelTurno)) return
    if (contieneDatosDelTenant(texto, ctx)) return

    const emb = await generarEmbedding(pregunta, 'document')
    if (!emb) return

    await createAdminClient().from('chat_faq_cache').insert({
      pregunta,
      respuesta: texto,
      embedding: JSON.stringify(emb.embedding),
      modelo: MODELO_EMBEDDING,
      herramientas: herramientasUsadas(mensajesDelTurno),
    })
  } catch {
    // best-effort, igual que registrarUso: no interrumpe la conversación
  }
}
