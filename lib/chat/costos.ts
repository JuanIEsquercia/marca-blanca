// Precios de Claude Sonnet 5 (USD por millón de tokens), verificados contra
// https://platform.claude.com/docs/en/about-claude/pricing el 2026-08-20.
// El chat usa cache_control efímero sin ttl explícito (lib/chat/agente.ts),
// que por default es de 5 minutos — por eso se usa la tarifa de escritura
// de caché "5m", no la de "1h". Si el modelo o el modo de caché cambian,
// estos números quedan desactualizados y hay que revisar la página de
// pricing de nuevo (no hay forma de leerlos en vivo desde la API).
const PRECIO_USD_POR_MTOK = {
  entrada: 2,
  salida: 10,
  cacheEscritura5m: 2.5,
  cacheLectura: 0.2,
}

export interface TokensUso {
  tokens_entrada: number
  tokens_salida: number
  tokens_cache_lectura: number
  tokens_cache_escritura: number
}

export function calcularCostoUSD(uso: TokensUso): number {
  return (
    (uso.tokens_entrada / 1_000_000) * PRECIO_USD_POR_MTOK.entrada +
    (uso.tokens_salida / 1_000_000) * PRECIO_USD_POR_MTOK.salida +
    (uso.tokens_cache_lectura / 1_000_000) * PRECIO_USD_POR_MTOK.cacheLectura +
    (uso.tokens_cache_escritura / 1_000_000) * PRECIO_USD_POR_MTOK.cacheEscritura5m
  )
}
