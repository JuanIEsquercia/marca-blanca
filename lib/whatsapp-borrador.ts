import { createAdminClient } from '@/lib/supabase/admin'

export interface Borrador {
  tipo: string
  paso: string
  datos: Record<string, unknown>
}

export async function obtenerBorrador(perfilId: string): Promise<Borrador | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('whatsapp_borradores')
    .select('tipo, paso, datos')
    .eq('perfil_id', perfilId)
    .maybeSingle()

  if (error) {
    console.error('obtenerBorrador:', error)
    return null
  }
  return data as Borrador | null
}

export async function guardarBorrador(perfilId: string, constructoraId: string, tipo: string, paso: string, datos: Record<string, unknown>): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('whatsapp_borradores')
    .upsert({ perfil_id: perfilId, constructora_id: constructoraId, tipo, paso, datos, actualizado_en: new Date().toISOString() })

  if (error) console.error('guardarBorrador:', error)
}

export async function limpiarBorrador(perfilId: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from('whatsapp_borradores').delete().eq('perfil_id', perfilId)
  if (error) console.error('limpiarBorrador:', error)
}

// Reclama (borra y devuelve) el borrador SOLO si sigue en el paso esperado —
// operación atómica a nivel de fila. Usar justo antes de registrar el
// gasto/cobro real: si dos entregas del mismo webhook (retry de Kapso, doble
// tap de "Confirmar") llegan casi juntas, solo una encuentra la fila y la
// borra; la otra recibe null y no debe volver a registrar nada. Reemplaza el
// patrón anterior de leer + registrar + borrar, que tenía una ventana de
// carrera entre la lectura y el borrado.
export async function reclamarBorrador(perfilId: string, pasoEsperado: string): Promise<Borrador | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('whatsapp_borradores')
    .delete()
    .eq('perfil_id', perfilId)
    .eq('paso', pasoEsperado)
    .select('tipo, paso, datos')
    .maybeSingle()

  if (error) {
    console.error('reclamarBorrador:', error)
    return null
  }
  return data as Borrador | null
}
