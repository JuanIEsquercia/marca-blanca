import type { SupabaseClient } from '@supabase/supabase-js'
import { calcularCostoUSD } from './costos'

export interface EstadoLimite {
  bloqueado: boolean
  costoActualUSD: number
  limiteUSD: number
}

// Alcance = constructora entera (no por usuario), ventana = mes calendario,
// comportamiento al llegar al tope = bloquear hasta que resetee — decisión
// del usuario 2026-08-20. El límite en sí vive en
// constructoras.chat_limite_mensual_usd (migration_070.sql, default 100).
//
// Recibe un cliente admin (service role) a propósito: el límite es sobre el
// consumo de TODOS los usuarios de la constructora, pero la RLS de
// chat_uso (migration_069.sql) solo deja ver las propias filas a un
// operador no-admin — con el cliente atado a la sesión, el chequeo
// subcontaría el consumo real cada vez que lo dispara alguien que no es
// admin. Mismo criterio que getConstructoraContext() en lib/tenant.ts.
export async function verificarLimiteMensual(adminClient: SupabaseClient, constructoraId: string): Promise<EstadoLimite> {
  const primerDiaDelMes = new Date()
  primerDiaDelMes.setUTCDate(1)
  primerDiaDelMes.setUTCHours(0, 0, 0, 0)

  const [{ data: constructora }, { data: usos }] = await Promise.all([
    adminClient.from('constructoras').select('chat_limite_mensual_usd').eq('id', constructoraId).maybeSingle(),
    adminClient
      .from('chat_uso')
      .select('tokens_entrada, tokens_salida, tokens_cache_lectura, tokens_cache_escritura')
      .eq('constructora_id', constructoraId)
      .gte('created_at', primerDiaDelMes.toISOString()),
  ])

  const limiteUSD = (constructora?.chat_limite_mensual_usd as number | null) ?? 100
  const costoActualUSD = (usos ?? []).reduce((acc, u) => acc + calcularCostoUSD(u), 0)

  return { bloqueado: costoActualUSD >= limiteUSD, costoActualUSD, limiteUSD }
}
