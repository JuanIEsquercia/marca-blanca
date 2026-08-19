import type { SupabaseClient } from '@supabase/supabase-js'
import type { Gasto } from '@/types/database'

export interface DatosGastoRapido {
  descripcion: string
  monto: number
  moneda?: 'ARS' | 'USD'
  obraId?: string | null
  proveedorId?: string
  categoriaId?: string
  fechaVencimiento?: string
  notas?: string
}

// Alta rápida de un gasto PENDIENTE — hoy solo la usa el chat. No cubre el
// desglose de IVA/monto neto (son informativos — ver columna en
// schema.sql, no afectan cálculos de tesorería/caja) ni marcarlo como
// pagado: esa acción mueve una cuenta propia real y es un paso deliberado
// aparte, igual que en GastosManager.tsx (el alta y el pago son dos
// formularios distintos ahí también). Mismo criterio que
// crearProveedorRapido en lib/proveedores.ts.
export async function crearGastoRapido(supabase: SupabaseClient, constructoraId: string, datos: DatosGastoRapido): Promise<Gasto | null> {
  const descripcion = datos.descripcion.trim()
  if (!descripcion || !(datos.monto > 0)) return null
  const { data, error } = await supabase
    .from('gastos')
    .insert({
      constructora_id: constructoraId,
      obra_id: datos.obraId ?? null,
      proveedor_id: datos.proveedorId ?? null,
      categoria_id: datos.categoriaId ?? null,
      descripcion,
      monto: datos.monto,
      moneda: datos.moneda ?? 'ARS',
      fecha_vencimiento: datos.fechaVencimiento ?? new Date().toISOString().slice(0, 10),
      notas: datos.notas?.trim() || null,
    })
    .select('*')
    .single()
  if (error || !data) return null
  return data as Gasto
}
