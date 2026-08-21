// Cliente mínimo para la API de embeddings de Voyage AI — sin SDK, la API
// es un POST REST plano (ver https://docs.voyageai.com/reference/embeddings-api).
// Pensado para la caché semántica del chat (lib/chat/) que todavía no se
// construyó — esto es solo la conexión de base, verificada contra la
// documentación oficial el 2026-08-21: voyage-4-lite tiene 200M tokens
// gratis (compartidos con voyage-4/voyage-4-large), suficiente de sobra
// para embeddings de preguntas frecuentes cortas.
const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings'
const MODELO_EMBEDDING = 'voyage-4-lite'

export interface ResultadoEmbedding {
  embedding: number[]
  tokens: number
}

// input_type importa para la calidad del embedding: "document" al indexar
// contenido de referencia (ej. una respuesta cacheada), "query" al
// embeddear lo que preguntó el usuario — nunca el mismo valor para los dos
// lados de una comparación de similitud.
export async function generarEmbedding(texto: string, tipo: 'query' | 'document'): Promise<ResultadoEmbedding | null> {
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey || !texto.trim()) return null

  let res: Response
  try {
    res = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODELO_EMBEDDING, input: texto, input_type: tipo }),
    })
  } catch {
    return null
  }
  if (!res.ok) return null

  const data = await res.json().catch(() => null) as { data?: { embedding?: number[] }[]; usage?: { total_tokens?: number } } | null
  const embedding = data?.data?.[0]?.embedding
  if (!Array.isArray(embedding)) return null

  return { embedding, tokens: data?.usage?.total_tokens ?? 0 }
}
