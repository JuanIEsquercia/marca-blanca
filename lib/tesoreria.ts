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

export interface MovimientoConCuenta {
  monto: number
  cuenta_propia_id: string | null
  moneda: string | null // null = sin moneda propia, se asume USD (ver nota arriba)
}

export interface PagoDeCuota {
  estado: string
  monto: number
  cuenta_propia_id: string | null
}

// Gasto/cobro con su plan de pago opcional embebido (migration_064):
// `pagos` vacío/undefined = sin plan, se usa el propio monto/estado/
// cuenta_propia_id (el flujo de siempre). Con `pagos`, cada cuota es su
// propio movimiento de caja — puede haber cuotas ya Pagadas/Cobradas
// aunque el padre siga Pendiente (plan cumplido a medias: 2 de 3
// cheques cobrados), porque el padre solo pasa a Pagado/Cobrado cuando
// TODAS cierran (ver sync_estado_gasto_por_pagos/sync_estado_cobro_por_pagos).
// Por eso estas filas nunca deben venir pre-filtradas por el estado del
// padre — hay que traer todas y dejar que las funciones de abajo decidan.
export interface MovimientoConPagos {
  estado: string | null
  monto: number | null
  cuenta_propia_id: string | null
  moneda: string | null
  pagos?: PagoDeCuota[] | null
}

export interface GastoParaCaja extends MovimientoConPagos {
  moneda: string
}

function perteneceACuenta(mov: MovimientoConCuenta, cuenta: { id: string; moneda: string }): boolean {
  if (mov.cuenta_propia_id !== cuenta.id) return false
  return (mov.moneda ?? 'USD') === cuenta.moneda
}

function cuotaOMonto(f: MovimientoConPagos, incluir: (estado: string | null) => boolean): MovimientoConCuenta[] {
  const pagos = f.pagos ?? []
  if (pagos.length > 0) {
    return pagos.filter(p => incluir(p.estado)).map(p => ({ monto: p.monto, cuenta_propia_id: p.cuenta_propia_id, moneda: f.moneda }))
  }
  return incluir(f.estado) ? [{ monto: f.monto ?? 0, cuenta_propia_id: f.cuenta_propia_id, moneda: f.moneda }] : []
}

// Gastos y cobros comparten exactamente esta lógica de expansión — por eso
// es una sola función para los dos lados en vez de duplicarla en cada uno.
export function movimientosLiquidados(filas: MovimientoConPagos[], estadoLiquidado: string): MovimientoConCuenta[] {
  return filas.flatMap(f => cuotaOMonto(f, e => e === estadoLiquidado))
}

export function movimientosPendientes(filas: MovimientoConPagos[], estadoLiquidado: string): MovimientoConCuenta[] {
  return filas.flatMap(f => cuotaOMonto(f, e => e !== estadoLiquidado))
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
    // contratos_venta!inner(estado) + el filtro de abajo: una cuota de un
    // contrato rescindido deja de contar como ingreso real (el contrato
    // cayó, no hubo tal cobro a nivel de negocio) — ver migration_058.
    supabase.from('cuotas').select('monto_base, monto_cobrado, estado_pago, cuenta_propia_id, contratos_venta!inner(estado)').eq('constructora_id', constructoraId).eq('estado_pago', 'Pagado').eq('contratos_venta.estado', 'vigente'),
    supabase.from('contratos_venta').select('entrega_efectiva, cuenta_propia_id').eq('constructora_id', constructoraId).eq('estado', 'vigente'),
    // Sin filtro de estado acá a propósito: un gasto con plan de pago
    // parcialmente cumplido sigue Pendiente pero puede tener cuotas ya
    // Pagadas — movimientosLiquidados() decide fila por fila (ver
    // MovimientoConPagos más arriba).
    supabase.from('gastos').select('monto, moneda, estado, cuenta_propia_id, pagos:gasto_pagos(estado, monto, cuenta_propia_id)').eq('constructora_id', constructoraId),
    supabase.from('cobros_proyecto').select('monto, moneda, estado, cuenta_propia_id, pagos:cobro_pagos(estado, monto, cuenta_propia_id)').eq('constructora_id', constructoraId),
    supabase.from('reservas').select('monto_sena, cuenta_propia_id').eq('constructora_id', constructoraId).eq('estado', 'Vigente').not('monto_sena', 'is', null),
  ])

  // Cuotas: el monto real cobrado puede diferir del nominal (descuentos,
  // recargos) — monto_cobrado es lo que efectivamente entró a la cuenta.
  const ingresos: MovimientoConCuenta[] = [
    ...(cuotas ?? []).map(c => ({ monto: c.monto_cobrado ?? c.monto_base ?? 0, cuenta_propia_id: c.cuenta_propia_id, moneda: null })),
    ...(contratos ?? []).map(c => ({ monto: c.entrega_efectiva ?? 0, cuenta_propia_id: c.cuenta_propia_id, moneda: null })),
    ...(reservas ?? []).map(r => ({ monto: r.monto_sena ?? 0, cuenta_propia_id: r.cuenta_propia_id, moneda: null })),
    ...movimientosLiquidados((cobrosProyecto ?? []) as MovimientoConPagos[], 'Cobrado'),
  ]
  const egresos = movimientosLiquidados((gastos ?? []) as MovimientoConPagos[], 'Pagado')

  const resultado: Record<string, SaldoCuenta> = {}
  for (const cuenta of cuentas) {
    const ingresosCuenta = sumarMontos(ingresos.filter(m => perteneceACuenta(m, cuenta)).map(m => m.monto))
    const egresosCuenta = sumarMontos(egresos.filter(m => perteneceACuenta(m, cuenta)).map(m => m.monto))
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

// Parte pura del cálculo (sin queries) — separada para que páginas que ya
// tienen gastos/cuentas/ingresos cargados en memoria (ej. la de Caja del
// proyecto, que los necesita igual para la tabla de detalle) puedan
// reusarlos en vez de volver a pedirlos, como pasaba antes acá mismo.
export function calcularTotalesYSaldos(
  cuentas: Pick<CuentaPropia, 'id' | 'nombre' | 'tipo' | 'moneda' | 'saldo_inicial'>[],
  gastos: GastoParaCaja[],
  ingresos: MovimientoConCuenta[]
): CajaProyecto {
  // Un gasto sin plan de pago cuenta entero por su propio estado (como
  // siempre); uno con plan expande cada cuota — así un plan cumplido a
  // medias (2 de 3 cheques ya pagados) aporta esos 2 a "pagado" y solo el
  // 3ro a "pendiente", en vez de que el gasto completo cuente para un lado
  // o el otro (ver movimientosLiquidados/movimientosPendientes arriba).
  const egresosLiquidados = movimientosLiquidados(gastos, 'Pagado')
  const egresosPendientesMov = movimientosPendientes(gastos, 'Pagado')

  const totalesPorMoneda: Record<string, TotalesMoneda> = {}
  for (const moneda of MONEDAS) {
    const ingresosMoneda = sumarMontos(ingresos.filter(i => (i.moneda ?? 'USD') === moneda).map(i => i.monto))
    const egresosPagados = sumarMontos(egresosLiquidados.filter(m => (m.moneda ?? 'USD') === moneda).map(m => m.monto))
    const egresosPendientes = sumarMontos(egresosPendientesMov.filter(m => (m.moneda ?? 'USD') === moneda).map(m => m.monto))
    if (ingresosMoneda !== 0 || egresosPagados !== 0 || egresosPendientes !== 0) {
      totalesPorMoneda[moneda] = { ingresos: ingresosMoneda, egresosPagados, egresosPendientes }
    }
  }

  const cuentasConSaldo = cuentas.map(cuenta => {
    const ingresosCuenta = sumarMontos(ingresos.filter(i => perteneceACuenta(i, cuenta)).map(i => i.monto))
    const egresosCuenta = sumarMontos(egresosLiquidados.filter(m => perteneceACuenta(m, cuenta)).map(m => m.monto))
    return { id: cuenta.id, nombre: cuenta.nombre, tipo: cuenta.tipo, moneda: cuenta.moneda, saldo_actual: redondear2(cuenta.saldo_inicial + ingresosCuenta - egresosCuenta) }
  })

  return { cuentasConSaldo, totalesPorMoneda }
}

async function obtenerIngresosProyecto(
  supabase: SupabaseClient,
  ctx: { obraId: string; obraTipo: 'desarrollo' | 'obra' }
): Promise<MovimientoConCuenta[]> {
  if (ctx.obraTipo === 'desarrollo') {
    // Señas de reservas Vigentes: dinero ya depositado que hasta ahora no
    // aparecía en ningún cálculo de caja. Solo 'Vigente' — una vez que la
    // reserva se convierte en venta (estado 'Convertida'), ese monto pasa a
    // representarse vía contratos_venta.entrega_efectiva (ver SaleForm, que
    // prefillea la entrega con la seña ya cobrada) y contarlo acá también
    // sería duplicarlo.
    const [{ data: cuotas }, { data: contratos }, { data: reservas }] = await Promise.all([
      supabase
        .from('cuotas')
        .select('monto_base, monto_cobrado, cuenta_propia_id, contratos_venta!inner(estado, unidades!inner(obra_id))')
        .eq('estado_pago', 'Pagado')
        .eq('contratos_venta.unidades.obra_id', ctx.obraId)
        .eq('contratos_venta.estado', 'vigente'),
      supabase
        .from('contratos_venta')
        .select('entrega_efectiva, cuenta_propia_id, unidades!inner(obra_id)')
        .eq('unidades.obra_id', ctx.obraId)
        .eq('estado', 'vigente')
        .not('entrega_efectiva', 'is', null),
      supabase
        .from('reservas')
        .select('monto_sena, cuenta_propia_id')
        .eq('obra_id', ctx.obraId)
        .eq('estado', 'Vigente')
        .not('monto_sena', 'is', null),
    ])

    return [
      ...(cuotas ?? []).map(c => ({ monto: c.monto_cobrado ?? c.monto_base ?? 0, cuenta_propia_id: c.cuenta_propia_id ?? null, moneda: null })),
      ...(contratos ?? []).filter(c => (c.entrega_efectiva ?? 0) > 0).map(c => ({ monto: c.entrega_efectiva ?? 0, cuenta_propia_id: c.cuenta_propia_id ?? null, moneda: null })),
      ...(reservas ?? []).map(r => ({ monto: r.monto_sena ?? 0, cuenta_propia_id: r.cuenta_propia_id ?? null, moneda: null })),
    ]
  }

  // Sin filtro de estado acá a propósito — igual que en
  // calcularSaldosDeCuentas, un cobro con plan de pago parcialmente
  // cumplido sigue Pendiente pero puede tener cuotas ya Cobradas.
  const { data: cobros } = await supabase
    .from('cobros_proyecto')
    .select('monto, moneda, estado, cuenta_propia_id, pagos:cobro_pagos(estado, monto, cuenta_propia_id)')
    .eq('obra_id', ctx.obraId)

  return movimientosLiquidados((cobros ?? []) as MovimientoConPagos[], 'Cobrado')
}

export async function calcularCajaProyecto(
  supabase: SupabaseClient,
  ctx: { constructoraId: string; obraId: string; obraTipo: 'desarrollo' | 'obra'; obraModo: 'empresa' | 'especificas' }
): Promise<CajaProyecto> {
  const cuentasQuery = supabase.from('cuentas_propias').select('*')
    .eq('constructora_id', ctx.constructoraId)
    .eq('activa', true)
    .order('nombre')
  const cuentasQueryScoped = ctx.obraModo === 'especificas' ? cuentasQuery.eq('obra_id', ctx.obraId) : cuentasQuery.is('obra_id', null)

  const gastosQuery = supabase
    .from('gastos')
    .select('*, pagos:gasto_pagos(estado, monto, cuenta_propia_id)')
    .eq('constructora_id', ctx.constructoraId)
    .eq('obra_id', ctx.obraId)

  const [{ data: cuentas }, { data: gastos }, ingresos] = await Promise.all([
    cuentasQueryScoped,
    gastosQuery,
    obtenerIngresosProyecto(supabase, ctx),
  ])

  return calcularTotalesYSaldos(cuentas ?? [], (gastos ?? []) as unknown as GastoParaCaja[], ingresos)
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
