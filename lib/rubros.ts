import type { SupabaseClient } from '@supabase/supabase-js'

// Lista de nombres de rubros ya usados por la constructora, para
// alimentar el <datalist> de autocomplete en los formularios de
// presupuestos/contratos de obra.
export async function obtenerRubros(supabase: SupabaseClient, constructoraId: string): Promise<string[]> {
  const { data } = await supabase
    .from('rubros')
    .select('nombre')
    .eq('constructora_id', constructoraId)
    .order('nombre')
  return (data ?? []).map(r => r.nombre as string)
}

// Estandariza un rubro contra el catálogo de la constructora antes de
// guardarlo en un ítem: si ya existe algo equivalente (mismo texto sin
// espacios de más/mayúsculas/tildes), devuelve su grafía canónica —
// así "Losa", "losa " y "LOSA" siempre terminan guardados igual. Si la
// llamada falla por algún motivo, no bloquea el guardado del ítem: cae
// al texto tal como se tipeó (el comportamiento de antes de esto existir).
export async function obtenerOCrearRubro(supabase: SupabaseClient, constructoraId: string, nombre: string): Promise<string> {
  const { data, error } = await supabase
    .rpc('obtener_o_crear_rubro', { p_constructora_id: constructoraId, p_nombre: nombre })
    .single()
  if (error || !data) return nombre.trim()
  return (data as { nombre: string }).nombre
}

export interface Rubro {
  id: string
  nombre: string
}

// Rubro con la marca de si forma parte del contrato con el cliente de la
// obra en la que se está trabajando — el selector los muestra primero
// porque son los únicos que producen una comparación real contra el
// presupuesto (ver resumen_rubros_obra, migration_073). Imputar a un
// rubro que no está en el contrato es válido igual: aparece en el control
// de obra como costo sin presupuesto asociado.
export interface RubroOpcion extends Rubro {
  enContrato: boolean
}

// Catálogo completo con id — a diferencia de obtenerRubros(), que solo
// devuelve nombres para el <datalist> de los formularios de presupuesto.
// Acá hace falta el id porque gastos/ordenes_compra/acopios guardan
// rubro_id (FK), no el texto.
export async function obtenerRubrosConId(supabase: SupabaseClient, constructoraId: string): Promise<Rubro[]> {
  const { data } = await supabase
    .from('rubros')
    .select('id, nombre')
    .eq('constructora_id', constructoraId)
    .order('nombre')
  return (data ?? []) as Rubro[]
}

// Catálogo de la constructora ordenado para imputar un costo en UNA obra:
// primero los rubros del contrato con el cliente de esa obra, después el
// resto. Los ítems del contrato guardan el rubro como TEXTO ya canonizado
// por obtener_o_crear_rubro (misma grafía que rubros.nombre), así que el
// cruce por nombre es confiable — es el mismo criterio con el que
// resumen_rubros_obra() arma la comparación.
export async function obtenerRubrosParaObra(
  supabase: SupabaseClient,
  constructoraId: string,
  obraId: string
): Promise<RubroOpcion[]> {
  const [catalogo, { data: itemsContrato }] = await Promise.all([
    obtenerRubrosConId(supabase, constructoraId),
    supabase
      .from('contrato_obra_items')
      .select('rubro, contratos_obra!inner(obra_id, tipo)')
      .eq('contratos_obra.obra_id', obraId)
      .eq('contratos_obra.tipo', 'cliente'),
  ])

  const enContrato = new Set(((itemsContrato ?? []) as unknown as { rubro: string }[]).map(i => i.rubro))

  return catalogo
    .map(r => ({ ...r, enContrato: enContrato.has(r.nombre) }))
    .sort((a, b) => (Number(b.enContrato) - Number(a.enContrato)) || a.nombre.localeCompare(b.nombre))
}

// Alta rápida desde un selector, devolviendo el id (obtenerOCrearRubro
// solo devuelve el nombre porque sus llamadores guardan texto).
export async function crearRubroRapido(supabase: SupabaseClient, constructoraId: string, nombre: string): Promise<Rubro | null> {
  const { data, error } = await supabase
    .rpc('obtener_o_crear_rubro', { p_constructora_id: constructoraId, p_nombre: nombre })
    .single()
  if (error || !data) return null
  return data as Rubro
}
