import type { SupabaseClient } from '@supabase/supabase-js'

// Bandeja de pendientes del panel (migration_077). Son ESTADOS derivados
// de los datos, no eventos guardados: un gasto está vencido hasta que se
// paga, y cuando se paga el pendiente desaparece solo. Por eso no hay
// "marcar como leído" — no habría nada que marcar.

export type TipoPendiente =
  | 'gasto_vencido'
  | 'cheque_gasto_vencido'
  | 'cobro_vencido'
  | 'cheque_cobro_vencido'
  | 'cuota_venta_vencida'
  | 'reserva_por_vencer'
  | 'certificado_estancado'

export interface Pendiente {
  tipo: TipoPendiente
  severidad: 'alta' | 'media'
  id: string
  titulo: string
  subtitulo: string
  fecha: string
  obraId: string | null
  href: string
}

const ETIQUETA: Record<TipoPendiente, string> = {
  gasto_vencido: 'Gasto vencido',
  cheque_gasto_vencido: 'Cuota a pagar vencida',
  cobro_vencido: 'Cobro vencido',
  cheque_cobro_vencido: 'Cuota a cobrar vencida',
  cuota_venta_vencida: 'Cuota de venta vencida',
  reserva_por_vencer: 'Reserva por vencer',
  certificado_estancado: 'Certificado sin avanzar',
}

// Orden de aparición en el panel: primero la plata que ya se debe o ya se
// debería haber cobrado, después lo que está por vencer, y al final lo
// trabado (que no tiene fecha límite dura).
export const ORDEN_TIPOS: TipoPendiente[] = [
  'gasto_vencido',
  'cheque_gasto_vencido',
  'cobro_vencido',
  'cheque_cobro_vencido',
  'cuota_venta_vencida',
  'reserva_por_vencer',
  'certificado_estancado',
]

export function etiquetaPendiente(tipo: TipoPendiente): string {
  return ETIQUETA[tipo]
}

// A qué pantalla lleva cada pendiente. Igual criterio que el buscador: las
// rutas se arman en TypeScript, no en la RPC.
function href(tipo: TipoPendiente, obraId: string | null): string {
  switch (tipo) {
    case 'gasto_vencido':
    case 'cheque_gasto_vencido':
      return obraId ? `/admin/proyectos/${obraId}/gastos` : '/admin/gastos'
    case 'cobro_vencido':
    case 'cheque_cobro_vencido':
      return obraId ? `/admin/proyectos/${obraId}/cobros` : '/admin/ingresos'
    case 'cuota_venta_vencida':
      return obraId ? `/admin/proyectos/${obraId}/contratos` : '/admin/ingresos'
    case 'reserva_por_vencer':
      return obraId ? `/admin/proyectos/${obraId}/reservas` : '/admin'
    case 'certificado_estancado':
      return obraId ? `/admin/proyectos/${obraId}/certificados` : '/admin'
  }
}

interface FilaPendiente {
  tipo: string
  severidad: string
  id: string
  titulo: string
  subtitulo: string
  fecha: string
  obra_id: string | null
}

export async function obtenerPendientes(
  supabase: SupabaseClient,
  constructoraId: string
): Promise<Pendiente[]> {
  const { data, error } = await supabase.rpc('pendientes_usuario', { p_constructora_id: constructoraId })
  if (error) return []

  return ((data ?? []) as FilaPendiente[])
    .map(f => ({
      tipo: f.tipo as TipoPendiente,
      severidad: (f.severidad === 'alta' ? 'alta' : 'media') as 'alta' | 'media',
      id: `${f.tipo}:${f.id}`,
      titulo: f.titulo,
      subtitulo: f.subtitulo,
      fecha: f.fecha,
      obraId: f.obra_id,
      href: href(f.tipo as TipoPendiente, f.obra_id),
    }))
    .sort((a, b) => {
      const porTipo = ORDEN_TIPOS.indexOf(a.tipo) - ORDEN_TIPOS.indexOf(b.tipo)
      return porTipo !== 0 ? porTipo : a.fecha.localeCompare(b.fecha)
    })
}

// Cuántos días pasaron desde la fecha (negativo = todavía no llegó).
export function diasDeAtraso(fechaIso: string): number {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const f = new Date(`${fechaIso}T00:00:00`)
  return Math.round((hoy.getTime() - f.getTime()) / (1000 * 60 * 60 * 24))
}
