import type { SupabaseClient } from '@supabase/supabase-js'
import type { CategoriaCosto } from '@/types/database'

export interface DatosCategoriaCostoRapida {
  nombre: string
  color?: string
}

const COLOR_DEFAULT = '#6366f1'

// Alta rápida de una categoría de gasto — hoy solo la usa el chat.
// CategoriasCostoManager.tsx sigue con su propio insert (selector de color
// con paleta visual, no tiene sentido que el chat elija de ahí); esto es
// el caso simple de "cargame una categoría nueva" con un color por
// default. Mismo criterio que crearProveedorRapido en lib/proveedores.ts
// — recibe el cliente de Supabase ya armado para poder correr server-side
// (tools del chat).
export async function crearCategoriaCostoRapida(supabase: SupabaseClient, constructoraId: string, datos: DatosCategoriaCostoRapida): Promise<CategoriaCosto | null> {
  const nombre = datos.nombre.trim()
  if (!nombre) return null
  const { data, error } = await supabase
    .from('categorias_costo')
    .insert({
      constructora_id: constructoraId,
      nombre,
      color: datos.color?.trim() || COLOR_DEFAULT,
    })
    .select('*')
    .single()
  if (error || !data) return null
  return data as CategoriaCosto
}
