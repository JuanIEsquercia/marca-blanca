import { createClient } from '@/lib/supabase/client'
import type { Proveedor } from '@/types/database'

// Creación rápida desde un selector (Gastos, Compras, Certificados) sin
// salir del formulario en curso. Mismo criterio simple que usa
// ProveedoresManager.tsx: proveedores no tiene dedupe por nombre (a
// diferencia de productos/rubros), así que es un insert directo — el
// usuario completa CUIT/email/teléfono después desde Proveedores si hace falta.
export async function crearProveedorRapido(constructoraId: string, razonSocial: string): Promise<Proveedor | null> {
  const nombre = razonSocial.trim()
  if (!nombre) return null
  const supabase = createClient()
  const { data, error } = await supabase
    .from('proveedores')
    .insert({ constructora_id: constructoraId, razon_social: nombre })
    .select('*')
    .single()
  if (error || !data) return null
  return data as Proveedor
}
