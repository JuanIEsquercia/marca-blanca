import type { SupabaseClient } from '@supabase/supabase-js'
import type { CuentaPropia } from '@/types/database'
import { formatCurrency, redondear2, sumarMontos } from '@/lib/utils'

// Extraído de app/admin/tesoreria/page.tsx y app/admin/proyectos/[obraId]/caja/page.tsx
// para que el panel y el webhook de WhatsApp calculen el mismo saldo — evita
// que diverjan dos implementaciones del mismo cálculo (ya pasó antes con el
// bug de cobros_proyecto sin impactar tesorería).
//
// Reglas de moneda: cuotas/entregas de contrato (contratos_venta) y señas de
// reserva no tienen columna `moneda` propia — la venta de unidades es
// siempre en USD por convención del negocio (precio_lista, cuotas, etc.).
// gastos y cobros_proyecto sí declaran su propia moneda (ARS o USD). Un
// movimiento solo se imputa al saldo de una cuenta si su moneda coincide con
// la de la cuenta — así un dato mal cargado (cobro en USD asignado por error
// a una cuenta ARS) no contamina el saldo en vez de sumar/restar sin sentido.

interface MovimientoConCuenta {
  monto: number
  cuenta_propia_id: string | null
  moneda: string | null // null = sin moneda propia, se asume USD (ver nota arriba)
}

function perteneceACuenta(mov: MovimientoConCuenta, cuenta: { id: string; moneda: string }): boolean {
  if (mov.cuenta_propia_id !== cuenta.id) return false
  return (mov.moneda ?? 'USD') === cuenta.moneda
}

export interface CuentaConSaldoEmpresa extends CuentaPropia {
  ingresos_ventas: number
  egresos_gastos: number
  saldo_actual: number
  obra_nombre: string | null
}

export interface SaldoCuenta {
  ingresos: number
  egresos: number
  saldo_actual: number
}

// Calcula el saldo consolidado (saldo_inicial + movimientos) para CUALQUIER
// lista de cuentas de la constructora — a diferencia de calcularCajaEmpresa,
// no filtra por obra_id/activa, así que sirve tanto para el pool de empresa
// como para cuentas específicas de un proyecto o inactivas. Las páginas de
// gestión de cuentas (/admin/cuentas, /admin/proyectos/[obraId]/cuentas)
// mostraban únicamente saldo_inicial porque nunca llamaban a ningún cálculo
// de tesorería — ese es justamente el número que NO cambia con la
// operación diaria, así que ahí siempre se veía "congelado".
export async function calcularSaldosDeCuentas(
  supabase: SupabaseClient,
  constructoraId: string,
  cuentas: Pick<CuentaPropia, 'id' | 'moneda' | 'saldo_inicial'>[]
): Promise<Record<string, SaldoCuenta>> {
  const [
    { data: cuotas },
    { data: contratos },
    { data: gastos },
    { data: cobrosProyecto },
    { data: reservas },
  ] = await Promise.all([
    supabase.from('cuotas').select('monto_base, monto_cobrado, estado_pago, cuenta_propia_id').eq('constructora_id', constructoraId).eq('estado_pago', 'Pagado'),
    supabase.from('contratos_venta').select('entrega_efectiva, cuenta_propia_id').eq('constructora_id', constructoraId),
    supabase.from('gastos').select('monto, moneda, estado, cuenta_propia_id').eq('constructora_id', constructoraId).eq('estado', 'Pagado'),
    supabase.from('cobros_proyecto').select('monto, moneda, cuenta_propia_id').eq('constructora_id', constructoraId).eq('estado', 'cobrado'),
    supabase.from('reservas').select('monto_sena, cuenta_propia_id').eq('constructora_id', constructoraId).eq('estado', 'Vigente').not('monto_sena', 'is', null),
  ])

  // Cuotas: el monto real cobrado puede diferir del nominal (descuentos,
  // recargos) — monto_cobrado es lo que efectivamente entró a la cuenta.
  const ingresos: MovimientoConCuenta[] = [
    ...(cuotas ?? []).map(c => ({ monto: c.monto_cobrado ?? c.monto_base ?? 0, cuenta_propia_id: c.cuenta_propia_id, moneda: null })),
    ...(contratos ?? []).map(c => ({ monto: c.entrega_efectiva ?? 0, cuenta_propia_id: c.cuenta_propia_id, moneda: null })),
    ...(reservas ?? []).map(r => ({ monto: r.monto_sena ?? 0, cuenta_propia_id: r.cuenta_propia_id, moneda: null })),
    ...(cobrosProyecto ?? []).map(c => ({ monto: c.monto ?? 0, cuenta_propia_id: c.cuenta_propia_id, moneda: c.moneda })),
  ]

  const resultado: Record<string, SaldoCuenta> = {}
  for (const cuenta of cuentas) {
    const ingresosCuenta = sumarMontos(ingresos.filter(m => perteneceACuenta(m, cuenta)).map(m => m.monto))
    const egresosCuenta = sumarMontos(
      (gastos ?? []).filter(g => g.cuenta_propia_id === cuenta.id && g.moneda === cuenta.moneda).map(g => g.monto ?? 0)
    )
    resultado[cuenta.id] = {
      ingresos: ingresosCuenta,
      egresos: egresosCuenta,
      saldo_actual: redondear2(cuenta.saldo_inicial + ingresosCuenta - egresosCuenta),
    }
  }
  return resultado
}

// "Consolidado de la empresa": antes solo sumaba el pool compartido
// (obra_id NULL) y dejaba afuera las cuentas específicas de un proyecto
// (obras.modo_cuentas = 'especificas') — plata real de la constructora que
// no aparecía en ningún lado como total. Ahora trae TODAS las cuentas
// activas y expone de qué proyecto es cada una (null = pool de empresa) para
// no perder el control de a qué corresponde cada saldo.
export async function calcularCajaEmpresa(supabase: SupabaseClient, constructoraId: string): Promise<CuentaConSaldoEmpresa[]> {
  const { data: cuentas } = await supabase
    .from('cuentas_propias').select('*, obras(nombre)')
    .eq('constructora_id', constructoraId).eq('activa', true).order('nombre')

  const saldos = await calcularSaldosDeCuentas(supabase, constructoraId, cuentas ?? [])

  return (cuentas ?? []).map(cuenta => {
    const { obras, ...resto } = cuenta as CuentaPropia & { obras: { nombre: string } | null }
    return {
      ...resto,
      obra_nombre: obras?.nombre ?? null,
      ingresos_ventas: saldos[cuenta.id]?.ingresos ?? 0,
      egresos_gastos: saldos[cuenta.id]?.egresos ?? 0,
      saldo_actual: saldos[cuenta.id]?.saldo_actual ?? cuenta.saldo_inicial,
    }
  })
}

export interface TotalesMoneda {
  ingresos: number
  egresosPagados: number
  egresosPendientes: number
}

export interface CajaProyecto {
  cuentasConSaldo: { id: string; nombre: string; tipo: string; moneda: string; saldo_actual: number }[]
  // Un total por moneda presente (ARS/USD) — nunca se suman entre sí, para
  // no mostrar una cifra "$ 1.234" que en realidad mezcla pesos y dólares.
  totalesPorMoneda: Record<string, TotalesMoneda>
}

const MONEDAS = ['ARS', 'USD'] as const

export async function calcularCajaProyecto(
  supabase: SupabaseClient,
  ctx: { constructoraId: string; obraId: string; obraTipo: 'desarrollo' | 'obra'; obraModo: 'empresa' | 'especificas' }
): Promise<CajaProyecto> {
  const cuentasQuery = supabase.from('cuentas_propias').select('*')
    .eq('constructora_id', ctx.constructoraId)
    .eq('activa', true)
    .order('nombre')

  const { data: cuentas } = await (
    ctx.obraModo === 'especificas'
      ? cuentasQuery.eq('obra_id', ctx.obraId)
      : cuentasQuery.is('obra_id', null)
  )

  const { data: gastos } = await supabase
    .from('gastos')
    .select('*')
    .eq('constructora_id', ctx.constructoraId)
    .eq('obra_id', ctx.obraId)

  let ingresos: MovimientoConCuenta[] = []

  if (ctx.obraTipo === 'desarrollo') {
    const { data: cuotas } = await supabase
      .from('cuotas')
      .select('monto_base, monto_cobrado, cuenta_propia_id, contratos_venta!inner(unidades!inner(obra_id))')
      .eq('estado_pago', 'Pagado')
      .eq('contratos_venta.unidades.obra_id', ctx.obraId)

    const { data: contratos } = await supabase
      .from('contratos_venta')
      .select('entrega_efectiva, cuenta_propia_id, unidades!inner(obra_id)')
      .eq('unidades.obra_id', ctx.obraId)
      .not('entrega_efectiva', 'is', null)

    // Señas de reservas Vigentes: dinero ya depositado que hasta ahora no
    // aparecía en ningún cálculo de caja. Solo 'Vigente' — una vez que la
    // reserva se convierte en venta (estado 'Convertida'), ese monto pasa a
    // representarse vía contratos_venta.entrega_efectiva (ver SaleForm, que
    // prefillea la entrega con la seña ya cobrada) y contarlo acá también
    // sería duplicarlo.
    const { data: reservas } = await supabase
      .from('reservas')
      .select('monto_sena, cuenta_propia_id')
      .eq('obra_id', ctx.obraId)
      .eq('estado', 'Vigente')
      .not('monto_sena', 'is', null)

    ingresos = [
      ...(cuotas ?? []).map(c => ({ monto: c.monto_cobrado ?? c.monto_base ?? 0, cuenta_propia_id: c.cuenta_propia_id ?? null, moneda: null })),
      ...(contratos ?? []).filter(c => (c.entrega_efectiva ?? 0) > 0).map(c => ({ monto: c.entrega_efectiva ?? 0, cuenta_propia_id: c.cuenta_propia_id ?? null, moneda: null })),
      ...(reservas ?? []).map(r => ({ monto: r.monto_sena ?? 0, cuenta_propia_id: r.cuenta_propia_id ?? null, moneda: null })),
    ]
  } else {
    const { data: cobros } = await supabase
      .from('cobros_proyecto')
      .select('monto, moneda, cuenta_propia_id')
      .eq('obra_id', ctx.obraId)
      .eq('estado', 'cobrado')

    ingresos = (cobros ?? []).map(c => ({ monto: c.monto, cuenta_propia_id: c.cuenta_propia_id ?? null, moneda: c.moneda }))
  }

  const totalesPorMoneda: Record<string, TotalesMoneda> = {}
  for (const moneda of MONEDAS) {
    const ingresosMoneda = sumarMontos(ingresos.filter(i => (i.moneda ?? 'USD') === moneda).map(i => i.monto))
    const egresosPagados = sumarMontos((gastos ?? []).filter(g => g.estado === 'Pagado' && g.moneda === moneda).map(g => g.monto ?? 0))
    const egresosPendientes = sumarMontos((gastos ?? []).filter(g => g.estado === 'Pendiente' && g.moneda === moneda).map(g => g.monto ?? 0))
    if (ingresosMoneda !== 0 || egresosPagados !== 0 || egresosPendientes !== 0) {
      totalesPorMoneda[moneda] = { ingresos: ingresosMoneda, egresosPagados, egresosPendientes }
    }
  }

  const cuentasConSaldo = (cuentas ?? []).map(cuenta => {
    const ingresosCuenta = sumarMontos(ingresos.filter(i => perteneceACuenta(i, cuenta)).map(i => i.monto))
    const egresosCuenta = sumarMontos(
      (gastos ?? []).filter(g => g.cuenta_propia_id === cuenta.id && g.estado === 'Pagado' && g.moneda === cuenta.moneda).map(g => g.monto ?? 0)
    )
    return { id: cuenta.id, nombre: cuenta.nombre, tipo: cuenta.tipo, moneda: cuenta.moneda, saldo_actual: redondear2(cuenta.saldo_inicial + ingresosCuenta - egresosCuenta) }
  })

  return { cuentasConSaldo, totalesPorMoneda }
}

export interface CuentaSimple {
  id: string
  nombre: string
  moneda: string
}

// Mismo criterio que las páginas de Caja/Gastos del panel: si el proyecto
// está en modo 'especificas' se opera con sus propias cuentas, si no con el
// pool compartido de la empresa (obra_id NULL). obraId=null (nivel empresa)
// siempre usa el pool compartido.
//
// moneda (opcional): mismo filtro que ya hace el <select> del panel web
// (GastosManager/CobrosObraManager, ".filter(c => c.moneda === ...)") — acá
// se aplica en la query para que el webhook de WhatsApp nunca ofrezca (ni
// permita elegir) una cuenta de moneda distinta a la del gasto/cobro que se
// está cargando, evitando contaminar saldo_actual con montos mezclados.
export async function obtenerCuentasPropias(supabase: SupabaseClient, constructoraId: string, obraId: string | null, modoCuentas: 'empresa' | 'especificas', moneda?: string): Promise<CuentaSimple[]> {
  let query = supabase.from('cuentas_propias').select('id, nombre, moneda').eq('constructora_id', constructoraId).eq('activa', true).order('nombre')

  query = obraId && modoCuentas === 'especificas'
    ? query.eq('obra_id', obraId)
    : query.is('obra_id', null)

  if (moneda) query = query.eq('moneda', moneda)

  const { data } = await query
  return (data ?? []) as CuentaSimple[]
}

export function formatearMonto(n: number, moneda = 'USD'): string {
  return formatCurrency(n, moneda)
}
