import type { SupabaseClient } from '@supabase/supabase-js'

// Cuotas ajustables por índice e interés por mora (migration_079).
//
// Las dos reglas que gobiernan todo esto:
//
//   - Una cuota EMITIDA no se modifica nunca más. El ajuste va siempre
//     hacia adelante. Antes de emitir, lo que se muestra es una proyección;
//     después, un número congelado.
//   - El ajuste y el interés son cosas distintas. El ajuste mantiene el
//     valor, el interés penaliza el atraso, y el interés se calcula SOBRE
//     el capital ya ajustado. Por eso vienen siempre desglosados y el
//     interés no se guarda: se calcula hasta el día que se cobra, y quien
//     cobra puede decidir no cobrarlo.

export interface EstadoCuota {
  emitida: boolean
  capital: number
  diasAtraso: number
  interesMora: number
  total: number
  indiceTipo: string | null
  indiceValor: number | null
}

interface FilaEstadoCuota {
  emitida: boolean
  capital: number
  dias_atraso: number
  interes_mora: number
  total: number
  indice_tipo: string | null
  indice_valor: number | null
}

export async function obtenerEstadoCuota(
  supabase: SupabaseClient,
  cuotaId: string,
  fecha?: string
): Promise<EstadoCuota | null> {
  const { data, error } = await supabase.rpc('estado_cuota', {
    p_cuota_id: cuotaId,
    ...(fecha ? { p_fecha: fecha } : {}),
  })
  if (error) return null

  const fila = ((data ?? []) as FilaEstadoCuota[])[0]
  if (!fila) return null

  return {
    emitida: fila.emitida,
    capital: fila.capital,
    diasAtraso: fila.dias_atraso,
    interesMora: fila.interes_mora,
    total: fila.total,
    indiceTipo: fila.indice_tipo,
    indiceValor: fila.indice_valor,
  }
}

export interface ResultadoEmision {
  montoCongelado: number
  indiceUsado: number | null
}

// Congela el capital de la cuota con el último índice publicado a la fecha.
// A partir de acá el monto es inmutable (lo impone un trigger, no solo esta
// función). Devuelve el mensaje de error de Postgres tal cual cuando falla:
// los casos reales son "ya fue emitida" y "no hay índice cargado", y los dos
// le dicen algo accionable al usuario.
export async function emitirCuota(
  supabase: SupabaseClient,
  cuotaId: string,
  fecha?: string
): Promise<{ ok: true; resultado: ResultadoEmision } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('emitir_cuota', {
    p_cuota_id: cuotaId,
    ...(fecha ? { p_fecha: fecha } : {}),
  })
  if (error) return { ok: false, error: error.message }

  const fila = ((data ?? []) as { monto_congelado: number; indice_usado: number | null }[])[0]
  if (!fila) return { ok: false, error: 'No se pudo emitir la cuota.' }

  return { ok: true, resultado: { montoCongelado: fila.monto_congelado, indiceUsado: fila.indice_usado } }
}

// Cuánto vale hoy una cuota pactada en unidades de índice, sin tocar la
// base. Sirve para previsualizar al armar el plan, antes de que exista la
// cuota.
export function proyectarMonto(unidades: number, valorIndice: number): number {
  return Math.round(unidades * valorIndice * 100) / 100
}

// Inversa: cuántas unidades representa un monto en pesos a una cotización.
// Es lo que se guarda al pactar una cuota ajustable, porque las unidades
// son el dato estable y los pesos el volátil.
export function unidadesDesdeMonto(monto: number, valorIndice: number): number {
  if (!valorIndice) return 0
  return Math.round((monto / valorIndice) * 1e6) / 1e6
}
