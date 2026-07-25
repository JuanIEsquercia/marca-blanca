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
