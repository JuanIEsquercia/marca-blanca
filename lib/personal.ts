import type { SupabaseClient } from '@supabase/supabase-js'
import type { Personal, Cuadrilla, TipoContratacion } from '@/types/database'

export interface DatosPersonalRapido {
  nombre: string
  dni?: string
  cuil?: string
  telefono?: string
  tipo_contratacion?: TipoContratacion
  categoria?: string
  jornal?: number
  fecha_ingreso?: string
}

// Alta rápida de una persona — hoy solo la usa el chat. PersonalManager.tsx
// sigue con su propio insert (formulario completo, con asignación a
// cuadrilla/obra en el mismo paso); esto es el caso simple de "cargame una
// persona nueva", sin asignación todavía — se hace después desde el panel,
// donde además se elige la obra con el resto del contexto a la vista. Mismo
// criterio que crearProveedorRapido en lib/proveedores.ts.
export async function crearPersonalRapido(supabase: SupabaseClient, constructoraId: string, datos: DatosPersonalRapido): Promise<Personal | null> {
  const nombre = datos.nombre.trim()
  if (!nombre) return null
  const { data, error } = await supabase
    .from('personal')
    .insert({
      constructora_id: constructoraId,
      nombre,
      dni: datos.dni?.trim() || null,
      cuil: datos.cuil?.trim() || null,
      telefono: datos.telefono?.trim() || null,
      tipo_contratacion: datos.tipo_contratacion ?? 'relacion_dependencia',
      categoria: datos.categoria?.trim() || null,
      jornal: datos.jornal ?? null,
      fecha_ingreso: datos.fecha_ingreso?.trim() || null,
      estado: 'disponible',
    })
    .select('*')
    .single()
  if (error || !data) return null
  return data as Personal
}

export interface DatosCuadrillaRapida {
  nombre: string
  notas?: string
}

// Mismo criterio: alta mínima sin capataz (asignarlo requiere elegir entre
// el personal existente, mejor hacerlo desde el panel donde se ve la
// lista completa) — solo para el chat.
export async function crearCuadrillaRapida(supabase: SupabaseClient, constructoraId: string, datos: DatosCuadrillaRapida): Promise<Cuadrilla | null> {
  const nombre = datos.nombre.trim()
  if (!nombre) return null
  const { data, error } = await supabase
    .from('cuadrillas')
    .insert({
      constructora_id: constructoraId,
      nombre,
      notas: datos.notas?.trim() || null,
    })
    .select('*')
    .single()
  if (error || !data) return null
  return data as Cuadrilla
}
