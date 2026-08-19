import type { SupabaseClient } from '@supabase/supabase-js'
import type { Comprador } from '@/types/database'

export interface DatosCompradorRapido {
  nombre_completo: string
  dni_cuit?: string
  email?: string
  telefono?: string
}

// Creación rápida de un cliente (compradores) — hoy solo la usa el chat.
// ReservaForm/SaleForm/CertificadosManager/NuevoPresupuestoForm siguen con
// su propio insert vía ClienteSelect (con búsqueda/reuso/actualización de
// un cliente existente, que esto no reemplaza); esto es el caso simple de
// "dar de alta un cliente nuevo" sin ese flujo de búsqueda. Mismo criterio
// que crearProveedorRapido en lib/proveedores.ts — recibe el cliente de
// Supabase ya armado para poder correr server-side (tools del chat).
export async function crearCompradorRapido(supabase: SupabaseClient, constructoraId: string, datos: DatosCompradorRapido): Promise<Comprador | null> {
  const nombre = datos.nombre_completo.trim()
  if (!nombre) return null
  const { data, error } = await supabase
    .from('compradores')
    .insert({
      constructora_id: constructoraId,
      nombre_completo: nombre,
      dni_cuit: datos.dni_cuit?.trim() || null,
      email: datos.email?.trim() || null,
      telefono: datos.telefono?.trim() || null,
    })
    .select('*')
    .single()
  if (error || !data) return null
  return data as Comprador
}
