import type { SupabaseClient } from '@supabase/supabase-js'

// Captura de índices y cotizaciones desde la API pública del BCRA
// (migration_078). Verificado contra la API real el 2026-09-10:
//
//   GET https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias/{id}?desde=&hasta=
//   -> { status, metadata: {...}, results: [ { idVariable, detalle: [ {fecha, valor} ] } ] }
//
// Sin API key. Las series son diarias pero NO tienen fines de semana ni
// feriados, por eso la lectura siempre va por valor_indice() (último valor
// hasta la fecha) y nunca por igualdad de fecha.

const BCRA_BASE = 'https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias'

export type TipoIndice = 'USD_MAYORISTA' | 'USD_MINORISTA' | 'UVA' | 'UVI' | 'CER' | 'ICL'

interface DefinicionSerie {
  idVariable: number
  etiqueta: string
  descripcion: string
}

// idVariable sacados del catálogo real del BCRA (GET /Monetarias).
export const SERIES_BCRA: Record<TipoIndice, DefinicionSerie> = {
  USD_MAYORISTA: {
    idVariable: 5,
    etiqueta: 'Dólar mayorista',
    descripcion: 'Tipo de cambio mayorista de referencia — el que se usa para valuar contratos, no el de pizarra.',
  },
  USD_MINORISTA: {
    idVariable: 4,
    etiqueta: 'Dólar minorista',
    descripcion: 'Tipo de cambio minorista (promedio vendedor) — el de pizarra al público.',
  },
  UVA: {
    idVariable: 31,
    etiqueta: 'UVA',
    descripcion: 'Unidad de Valor Adquisitivo — sigue la inflación (CER). Se usa en créditos y alquileres.',
  },
  UVI: {
    idVariable: 32,
    etiqueta: 'UVI',
    descripcion: 'Unidad de Vivienda — sigue el costo de la construcción, no la inflación general. Es la serie de esta lista más cercana al CAC.',
  },
  CER: {
    idVariable: 30,
    etiqueta: 'CER',
    descripcion: 'Coeficiente de Estabilización de Referencia — inflación (IPC).',
  },
  ICL: {
    idVariable: 40,
    etiqueta: 'ICL',
    descripcion: 'Índice para Contratos de Locación — el que fija el BCRA para alquileres.',
  },
}

// El CAC (Cámara Argentina de la Construcción) es el índice que más usan los
// contratos de obra, pero la Cámara no publica una API — se carga a mano.
// Se declara acá para que el resto del sistema lo trate igual que a los
// automáticos: misma tabla, misma función de lectura.
export const TIPO_CAC = 'CAC'

interface RespuestaBcra {
  status?: number
  results?: { idVariable: number; detalle?: { fecha: string; valor: number }[] }[]
}

export interface ResultadoSerie {
  tipo: TipoIndice
  guardados: number
  error?: string
}

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function hace(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

// Trae una serie y la deja guardada. Idempotente: usa upsert sobre
// (tipo, fecha), así correr el cron dos veces el mismo día no duplica ni
// falla, y un backfill puede pisar tranquilo lo ya cargado.
async function capturarSerie(
  admin: SupabaseClient,
  tipo: TipoIndice,
  desde: string,
  hasta: string
): Promise<ResultadoSerie> {
  const { idVariable } = SERIES_BCRA[tipo]
  const url = `${BCRA_BASE}/${idVariable}?desde=${desde}&hasta=${hasta}&limit=3000`

  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  } catch (err) {
    // El BCRA ha tenido problemas de cadena TLS con algunos clientes; si
    // falla la conexión conviene verlo explícito en el resultado del cron
    // y no como "0 valores" silencioso.
    return { tipo, guardados: 0, error: `No se pudo conectar: ${err instanceof Error ? err.message : 'error de red'}` }
  }
  if (!res.ok) return { tipo, guardados: 0, error: `BCRA respondió ${res.status}` }

  const json = (await res.json().catch(() => null)) as RespuestaBcra | null
  const detalle = json?.results?.[0]?.detalle ?? []
  if (detalle.length === 0) return { tipo, guardados: 0 }

  const filas = detalle
    .filter(d => Number.isFinite(d.valor) && d.valor > 0)
    .map(d => ({ tipo, fecha: d.fecha.slice(0, 10), valor: d.valor, fuente: 'bcra' }))

  const { error } = await admin.from('indices_valores').upsert(filas, { onConflict: 'tipo,fecha' })
  if (error) return { tipo, guardados: 0, error: error.message }

  return { tipo, guardados: filas.length }
}

// Captura todas las series automáticas. `desde` sirve para el backfill
// inicial (traer años de historia de una); sin él toma una ventana corta,
// que además cubre el caso de que el cron no haya corrido algún día.
export async function capturarIndices(
  admin: SupabaseClient,
  opciones: { desde?: string; tipos?: TipoIndice[] } = {}
): Promise<ResultadoSerie[]> {
  const desde = opciones.desde ?? hace(15)
  const hasta = hoyIso()
  const tipos = opciones.tipos ?? (Object.keys(SERIES_BCRA) as TipoIndice[])

  // En serie y no en paralelo: son pocas series y el BCRA es un organismo
  // público, no hay motivo para golpearlo con seis requests simultáneas.
  const resultados: ResultadoSerie[] = []
  for (const tipo of tipos) {
    resultados.push(await capturarSerie(admin, tipo, desde, hasta))
  }
  return resultados
}

// Último valor conocido de cada serie, para mostrarlo en el panel.
export interface UltimoValor {
  tipo: string
  fecha: string
  valor: number
}

export async function ultimosValores(supabase: SupabaseClient): Promise<UltimoValor[]> {
  const { data } = await supabase
    .from('indices_valores')
    .select('tipo, fecha, valor')
    .order('fecha', { ascending: false })
    .limit(500)

  const vistos = new Map<string, UltimoValor>()
  for (const fila of (data ?? []) as UltimoValor[]) {
    if (!vistos.has(fila.tipo)) vistos.set(fila.tipo, fila)
  }
  return [...vistos.values()]
}
