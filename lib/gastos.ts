import type { SupabaseClient } from '@supabase/supabase-js'
import type { Gasto } from '@/types/database'

export interface DatosGastoRapido {
  descripcion: string
  monto: number
  moneda?: 'ARS' | 'USD'
  obraId?: string | null
  proveedorId?: string
  cuentaProveedorId?: string
  categoriaId?: string
  certificadoId?: string
  numeroComprobante?: string
  montoNeto?: number
  iva?: number
  percepciones?: number
  fechaVencimiento?: string
  notas?: string
}

// Alta rápida de un gasto PENDIENTE — hoy solo la usa el chat, con el mismo
// set de campos que el alta completa de GastosManager.tsx (salvo
// comprobante_url: es un archivo subido, el chat no tiene forma de
// adjuntarlo). No cubre marcarlo como pagado: esa acción mueve una cuenta
// propia real y es un paso deliberado aparte (marcar_gasto_pagado), igual
// que en el panel (el alta y el pago son dos formularios distintos ahí
// también). Mismo criterio que crearProveedorRapido en lib/proveedores.ts.
export async function crearGastoRapido(supabase: SupabaseClient, constructoraId: string, datos: DatosGastoRapido): Promise<Gasto | null> {
  const descripcion = datos.descripcion.trim()
  if (!descripcion || !(datos.monto > 0)) return null
  const { data, error } = await supabase
    .from('gastos')
    .insert({
      constructora_id: constructoraId,
      obra_id: datos.obraId ?? null,
      proveedor_id: datos.proveedorId ?? null,
      cuenta_proveedor_id: datos.cuentaProveedorId ?? null,
      categoria_id: datos.categoriaId ?? null,
      certificado_id: datos.certificadoId ?? null,
      descripcion,
      monto: datos.monto,
      moneda: datos.moneda ?? 'ARS',
      fecha_vencimiento: datos.fechaVencimiento ?? new Date().toISOString().slice(0, 10),
      numero_comprobante: datos.numeroComprobante?.trim() || null,
      monto_neto: datos.montoNeto ?? null,
      iva: datos.iva ?? null,
      percepciones: datos.percepciones ?? null,
      notas: datos.notas?.trim() || null,
    })
    .select('*')
    .single()
  if (error || !data) return null
  return data as Gasto
}
