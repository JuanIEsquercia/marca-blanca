import { createClient } from '@/lib/supabase/client'
import type { Proveedor } from '@/types/database'

export interface DatosProveedorRapido {
  razon_social: string
  cuit?: string
  telefono?: string
  email?: string
  direccion?: string
  notas?: string
}

// Creación rápida desde un selector (Gastos, Compras, Certificados) sin
// salir del formulario en curso. Mismo criterio simple que usa
// ProveedoresManager.tsx: proveedores no tiene dedupe por nombre (a
// diferencia de productos/rubros), así que es un insert directo — mismos
// campos que el alta completa, para no dejar un proveedor "a medias".
export async function crearProveedorRapido(constructoraId: string, datos: DatosProveedorRapido): Promise<Proveedor | null> {
  const razonSocial = datos.razon_social.trim()
  if (!razonSocial) return null
  const supabase = createClient()
  const { data, error } = await supabase
    .from('proveedores')
    .insert({
      constructora_id: constructoraId,
      razon_social: razonSocial,
      cuit: datos.cuit?.trim() || null,
      telefono: datos.telefono?.trim() || null,
      email: datos.email?.trim() || null,
      direccion: datos.direccion?.trim() || null,
      notas: datos.notas?.trim() || null,
    })
    .select('*')
    .single()
  if (error || !data) return null
  return data as Proveedor
}
