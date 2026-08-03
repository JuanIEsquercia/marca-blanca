import type { SupabaseClient } from '@supabase/supabase-js'

// Consolida las dos fuentes de "plata que un cliente nos debe" — cuotas
// (venta de unidades, Desarrollo) y cobros_proyecto (certificación de
// avance, Obra). Son conceptos de negocio distintos (una cuota es un plan
// de pago fijo pactado en el contrato; un cobro de obra depende de cuánto
// se certificó) por eso NO se unifican en una tabla — se normalizan acá,
// en la capa de lectura, al mismo patrón que ya usa lib/tesoreria.ts para
// combinar fuentes heterogéneas en un solo tipo de "movimiento".
export interface IngresoConsolidado {
  id: string
  origen: 'cuota' | 'cobro_proyecto'
  obraId: string | null
  obraNombre: string | null
  clienteNombre: string | null
  descripcion: string
  monto: number
  moneda: string
  fechaVencimiento: string | null
  fechaPago: string | null
  pagado: boolean
}

interface FilaCuota {
  id: string
  numero_cuota: number
  monto_base: number
  monto_cobrado: number | null
  fecha_vencimiento: string
  fecha_pago: string | null
  estado_pago: string
  contratos_venta: {
    obra_id: string
    cantidad_cuotas: number
    estado: string
    obras: { nombre: string } | null
    compradores: { nombre_completo: string } | null
  } | null
}

interface PagoCobro {
  estado: string
  monto: number
  fecha_pago: string
}

interface FilaCobro {
  id: string
  numero: number | null
  monto: number
  moneda: string
  fecha_vencimiento: string | null
  fecha_pago: string | null
  estado: string
  obra_id: string
  obras: { nombre: string } | null
  contratos_obra: { compradores: { nombre_completo: string } | null } | null
  // Plan de pago opcional (migration_064) — un cobro con plan queda
  // "Pendiente" a nivel de fila hasta que TODAS las cuotas cierran, así que
  // sin esto "Por cobrar" mostraba el monto TOTAL como pendiente aunque ya
  // se hubieran cobrado 2 de 3 cheques.
  cobro_pagos?: PagoCobro[]
}

function normalizarCuota(c: FilaCuota): IngresoConsolidado {
  const cv = c.contratos_venta
  return {
    id: c.id,
    origen: 'cuota',
    obraId: cv?.obra_id ?? null,
    obraNombre: cv?.obras?.nombre ?? null,
    clienteNombre: cv?.compradores?.nombre_completo ?? null,
    descripcion: `Cuota ${c.numero_cuota}${cv ? `/${cv.cantidad_cuotas}` : ''}`,
    monto: c.monto_cobrado ?? c.monto_base,
    // La venta de unidades es siempre en USD por convención del negocio
    // (mismo criterio que lib/tesoreria.ts) — cuotas no tiene columna moneda.
    moneda: 'USD',
    fechaVencimiento: c.fecha_vencimiento,
    fechaPago: c.fecha_pago,
    pagado: c.estado_pago === 'Pagado',
  }
}

// Devuelve una lista (no un solo ingreso): un cobro con plan de pago se
// expande a un IngresoConsolidado por cuota — cada una con su propio monto,
// fecha y estado — en vez de un único registro con el monto total y el
// estado del padre (que se queda en "Pendiente" hasta que la última cuota
// cierra, aunque otras ya se hayan cobrado).
function normalizarCobro(c: FilaCobro): IngresoConsolidado[] {
  const pagos = c.cobro_pagos ?? []
  const descripcionBase = c.numero ? `Cobro N°${c.numero}` : 'Cobro de obra'
  const base = {
    obraId: c.obra_id,
    obraNombre: c.obras?.nombre ?? null,
    // migration_048: el cliente sale del contrato específico del cobro
    // (contrato_obra_id directo) — una obra puede tener varios contratos
    // cliente (etapas), ya no alcanza con "el" contrato de la obra.
    clienteNombre: c.contratos_obra?.compradores?.nombre_completo ?? null,
    moneda: c.moneda,
  }

  if (pagos.length > 0) {
    return pagos.map((p, idx) => ({
      id: `${c.id}-cuota-${idx}`,
      origen: 'cobro_proyecto' as const,
      ...base,
      descripcion: `${descripcionBase} (cuota)`,
      monto: p.monto,
      fechaVencimiento: p.fecha_pago,
      fechaPago: p.estado === 'Cobrado' ? p.fecha_pago : null,
      pagado: p.estado === 'Cobrado',
    }))
  }

  return [{
    id: c.id,
    origen: 'cobro_proyecto',
    ...base,
    descripcion: descripcionBase,
    monto: c.monto,
    fechaVencimiento: c.fecha_vencimiento,
    fechaPago: c.fecha_pago,
    pagado: c.estado === 'Cobrado',
  }]
}

// contratos_venta!inner (no un embed simple): así el .eq('contratos_venta.estado', ...)
// de abajo excluye directamente las cuotas de un contrato rescindido, en vez
// de solo anidar el dato — ver migration_058.
const CUOTA_SELECT = 'id, numero_cuota, monto_base, monto_cobrado, fecha_vencimiento, fecha_pago, estado_pago, contratos_venta!inner(obra_id, cantidad_cuotas, estado, obras(nombre), compradores(nombre_completo))'
const COBRO_SELECT = 'id, numero, monto, moneda, fecha_vencimiento, fecha_pago, estado, obra_id, obras(nombre), contratos_obra(compradores(nombre_completo)), cobro_pagos(estado, monto, fecha_pago)'

// Igual criterio que /admin/gastos: los ya cobrados se acotan a los
// últimos 12 meses por defecto (todo lo pendiente se trae siempre, una
// deuda vieja sigue siendo relevante) — soloUltimos12Meses=false lo
// desactiva ("Ver historial completo").
export async function obtenerIngresos(
  supabase: SupabaseClient,
  constructoraId: string,
  soloUltimos12Meses: boolean
): Promise<IngresoConsolidado[]> {
  const hace12Meses = new Date()
  hace12Meses.setMonth(hace12Meses.getMonth() - 12)
  const ventanaInicio = hace12Meses.toISOString().slice(0, 10)

  let cuotasPagadasQuery = supabase
    .from('cuotas')
    .select(CUOTA_SELECT)
    .eq('constructora_id', constructoraId)
    .eq('estado_pago', 'Pagado')
    .eq('contratos_venta.estado', 'vigente')
    .order('fecha_pago', { ascending: false })
  if (soloUltimos12Meses) cuotasPagadasQuery = cuotasPagadasQuery.gte('fecha_pago', ventanaInicio)

  let cobrosPagadosQuery = supabase
    .from('cobros_proyecto')
    .select(COBRO_SELECT)
    .eq('constructora_id', constructoraId)
    .eq('estado', 'Cobrado')
    .order('fecha_pago', { ascending: false })
  if (soloUltimos12Meses) cobrosPagadosQuery = cobrosPagadosQuery.gte('fecha_pago', ventanaInicio)

  const [
    { data: cuotasPendientes },
    { data: cuotasPagadas },
    { data: cobrosPendientes },
    { data: cobrosPagados },
  ] = await Promise.all([
    supabase.from('cuotas').select(CUOTA_SELECT)
      .eq('constructora_id', constructoraId).neq('estado_pago', 'Pagado')
      .eq('contratos_venta.estado', 'vigente')
      .order('fecha_vencimiento', { ascending: true }),
    cuotasPagadasQuery,
    supabase.from('cobros_proyecto').select(COBRO_SELECT)
      .eq('constructora_id', constructoraId).eq('estado', 'Pendiente')
      .order('fecha_vencimiento', { ascending: true }),
    cobrosPagadosQuery,
  ])

  return [
    ...((cuotasPendientes ?? []) as unknown as FilaCuota[]).map(normalizarCuota),
    ...((cuotasPagadas ?? []) as unknown as FilaCuota[]).map(normalizarCuota),
    ...((cobrosPendientes ?? []) as unknown as FilaCobro[]).flatMap(normalizarCobro),
    ...((cobrosPagados ?? []) as unknown as FilaCobro[]).flatMap(normalizarCobro),
  ]
}
