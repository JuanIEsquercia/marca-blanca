import type { SupabaseClient } from '@supabase/supabase-js'
import type { CuentaPropia } from '@/types/database'

// Creación rápida desde un selector de cobro/pago (ContratoObraCard,
// Gastos, Contratos, Cobros, PlanDePago, el chat) sin salir del formulario
// en curso. Mismo criterio simple que usa CuentasPropiasManager.tsx —
// insert directo, sin dedupe (una constructora puede tener varias
// cuentas con el mismo nombre, ej. "Caja" por obra). Recibe el cliente de
// Supabase ya armado — mismo criterio que crearProveedorRapido en
// lib/proveedores.ts — para poder correr tanto con el cliente de browser
// como con el de servidor atado a cookies (tools del chat).
export async function crearCuentaPropiaRapida(
  supabase: SupabaseClient,
  constructoraId: string,
  nombre: string,
  tipo: 'banco' | 'caja',
  moneda: 'ARS' | 'USD',
  obraId?: string | null,
  saldoInicial?: number
): Promise<CuentaPropia | null> {
  const nombreLimpio = nombre.trim()
  if (!nombreLimpio) return null
  const { data, error } = await supabase
    .from('cuentas_propias')
    .insert({
      constructora_id: constructoraId,
      obra_id: obraId ?? null,
      nombre: nombreLimpio,
      tipo,
      moneda,
      saldo_inicial: saldoInicial ?? 0,
    })
    .select('*')
    .single()
  if (error || !data) return null
  return data as CuentaPropia
}
