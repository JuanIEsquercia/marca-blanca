import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import { calcularCajaEmpresa } from '@/lib/tesoreria'
import { obtenerIngresos } from '@/lib/ingresos'
import TesoreriaView, { type MovimientoFlujo } from '@/components/admin/TesoreriaView'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Caja' }
export const dynamic = 'force-dynamic'

// 12 meses atrás (histórico real) + el actual + 11 adelante (proyectado a
// partir de vencimientos ya conocidos: cuotas de venta, cobros y gastos
// pendientes) — 24 meses en total. TesoreriaView agrupa esto en trimestres
// o años sumando los meses correspondientes, no hace falta traer los datos
// de nuevo por cada nivel de agregación.
function getMonthRange(mesesAtras: number, mesesAdelante: number) {
  const months = []
  const now = new Date()
  for (let i = -mesesAtras; i < mesesAdelante; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    months.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: d.toLocaleDateString('es-AR', { month: 'short', year: 'numeric' }),
    })
  }
  return months
}

export default async function TesoreriaPage() {
  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')

  const supabase = await createClient()

  // El flujo mensual muestra 12 meses atrás (histórico) + 12 adelante
  // (proyección) — filtrar lo YA PAGADO/COBRADO a esa ventana evita traer
  // todo el historial de la constructora en cada carga (sin esto, quedaba
  // sujeto al límite default de PostgREST de ~1000 filas y subestimaba los
  // totales silenciosamente en tenants con historial largo). Lo Pendiente
  // (gastos, cobros, cuotas) NO se filtra por fecha en ningún sentido: una
  // deuda vieja sigue siendo relevante, y un vencimiento lejano en el
  // futuro (cuota 40/60 de un plan largo) igual tiene que poder proyectarse
  // más adelante si el usuario extiende la ventana.
  const meses = getMonthRange(12, 12)
  const ventanaInicio = `${meses[0].year}-${String(meses[0].month).padStart(2, '0')}-01`

  const [
    { data: obras },
    { data: cuotas },
    { data: contratos },
    { data: gastos },
    { data: cobrosProyecto },
    cuentasConSaldo,
    ingresosConsolidados,
  ] = await Promise.all([
    supabase.from('obras').select('id, nombre').eq('constructora_id', ctx.constructoraId).order('nombre'),
    // Antes solo traía Pagadas — ahora también las Pendientes (con su
    // fecha_vencimiento, ya conocida de antemano al generarse el plan de
    // cuotas) para poder proyectar ingresos futuros, no solo mostrar lo ya
    // cobrado.
    supabase.from('cuotas')
      .select('monto_base, monto_cobrado, fecha_pago, fecha_vencimiento, estado_pago, contratos_venta!inner(obra_id, estado)')
      .eq('constructora_id', ctx.constructoraId)
      .eq('contratos_venta.estado', 'vigente')
      .or(`estado_pago.neq.Pagado,fecha_pago.gte.${ventanaInicio}`),
    supabase.from('contratos_venta').select('entrega_efectiva, fecha_firma, obra_id')
      .eq('constructora_id', ctx.constructoraId).eq('estado', 'vigente').gte('fecha_firma', ventanaInicio),
    // Un gasto con plan de pago (migration_064) sigue "Pendiente" a nivel de
    // fila hasta que TODAS sus cuotas cierran — así que filtrar por
    // estado='Pagado' + ventana de fecha_pago (como antes) dejaba afuera
    // cheques ya pagados de un plan parcialmente cumplido. Se trae en una
    // sola query (Pendiente sin ventana, igual que siempre + Pagado dentro
    // de la ventana) con las cuotas anidadas, y se expande cuota por cuota
    // más abajo (mismo criterio que movimientosLiquidados/Pendientes de
    // lib/tesoreria.ts, acá inline porque necesitamos la fecha de cada
    // cuota para ubicarla en el mes correcto del flujo).
    supabase.from('gastos')
      .select('*, proveedores(razon_social), categorias_costo(nombre, color), pagos:gasto_pagos(estado, monto, fecha_pago)')
      .eq('constructora_id', ctx.constructoraId)
      .or(`estado.eq.Pendiente,fecha_pago.gte.${ventanaInicio}`),
    // Mismo criterio que gastos: un cobro con plan de pago parcial sigue
    // "Pendiente" hasta que cierra del todo. fecha_vencimiento nueva acá
    // (antes no se traía) para poder ubicar los pendientes en el mes que
    // corresponde de la proyección, en vez de solo mostrarlos en la lista
    // plana "Por cobrar".
    supabase.from('cobros_proyecto')
      .select('monto, moneda, fecha_pago, fecha, fecha_vencimiento, obra_id, estado, pagos:cobro_pagos(estado, monto, fecha_pago)')
      .eq('constructora_id', ctx.constructoraId)
      .or(`estado.eq.Pendiente,fecha.gte.${ventanaInicio}`),
    calcularCajaEmpresa(supabase, ctx.constructoraId),
    // Los pendientes de cobro (cuotas + cobros de obra) SIEMPRE se traen
    // completos acá, sin recortar por ventana — igual criterio que los
    // gastos pendientes de abajo: una deuda vieja sigue siendo relevante.
    obtenerIngresos(supabase, ctx.constructoraId, true),
  ])

  type PagoConFecha = { estado: string; monto: number; fecha_pago: string }

  // Expande un gasto/cobro a sus movimientos reales: si tiene plan de pago,
  // cada cuota es su propio movimiento (con su propia fecha) — si no, el
  // gasto/cobro entero cuenta por su estado/fecha de siempre.
  function expandirGasto(g: { estado: string; monto: number | null; fecha_pago: string | null; fecha_vencimiento: string; pagos?: PagoConFecha[] | null }) {
    const pagos = g.pagos ?? []
    if (pagos.length > 0) {
      return pagos.map(p => ({ liquidado: p.estado === 'Pagado', monto: p.monto, fecha: p.fecha_pago }))
    }
    return [{ liquidado: g.estado === 'Pagado', monto: g.monto ?? 0, fecha: g.estado === 'Pagado' ? g.fecha_pago : g.fecha_vencimiento }]
  }
  // A diferencia de gastos, acá antes se descartaban los pendientes (solo
  // interesaba lo ya Cobrado) — ahora también se devuelven, marcados
  // `liquidado: false` con su fecha de vencimiento, para poder proyectarlos
  // en el mes que corresponde (mismo criterio que expandirGasto).
  function expandirCobro(c: { estado: string; monto: number | null; fecha_pago: string | null; fecha: string; fecha_vencimiento: string | null; pagos?: PagoConFecha[] | null }) {
    const pagos = c.pagos ?? []
    if (pagos.length > 0) {
      return pagos.map(p => ({ liquidado: p.estado === 'Cobrado', monto: p.monto, fecha: p.fecha_pago }))
    }
    return [{ liquidado: c.estado === 'Cobrado', monto: c.monto ?? 0, fecha: c.estado === 'Cobrado' ? (c.fecha_pago ?? c.fecha) : (c.fecha_vencimiento ?? c.fecha) }]
  }
  // Cuotas: mismo criterio, Pagada cuenta como ingreso real (fecha_pago),
  // Pendiente como proyección (fecha_vencimiento, ya fijada de antemano al
  // generarse el plan de cuotas del contrato).
  function expandirCuota(c: { estado_pago: string; monto_base: number; monto_cobrado: number | null; fecha_pago: string | null; fecha_vencimiento: string }) {
    const liquidado = c.estado_pago === 'Pagado'
    return { liquidado, monto: liquidado ? (c.monto_cobrado ?? c.monto_base) : c.monto_base, fecha: liquidado ? c.fecha_pago : c.fecha_vencimiento }
  }

  // Serie normalizada de movimientos con su obra_id — antes el "Flujo
  // mensual" sumaba todo junto sin distinguir de qué proyecto venía cada
  // ingreso/egreso; ahora el filtro de proyecto en TesoreriaView recalcula
  // esto mismo del lado del cliente sin ir de nuevo a la base.
  const movimientos: MovimientoFlujo[] = [
    ...(cuotas ?? []).map(c => {
      const mov = expandirCuota(c)
      return {
        tipo: (mov.liquidado ? 'ingreso' : 'ingreso_comprometido') as 'ingreso' | 'ingreso_comprometido',
        moneda: 'USD', monto: mov.monto, fecha: mov.fecha,
        obraId: (c.contratos_venta as unknown as { obra_id: string } | null)?.obra_id ?? null,
      }
    }),
    ...(contratos ?? []).filter(c => (c.entrega_efectiva ?? 0) > 0).map(c => ({
      tipo: 'ingreso' as const, moneda: 'USD', monto: c.entrega_efectiva ?? 0,
      fecha: c.fecha_firma, obraId: c.obra_id,
    })),
    ...(cobrosProyecto ?? []).flatMap(c => expandirCobro(c).map(mov => ({
      tipo: (mov.liquidado ? 'ingreso' : 'ingreso_comprometido') as 'ingreso' | 'ingreso_comprometido',
      moneda: c.moneda, monto: mov.monto, fecha: mov.fecha, obraId: c.obra_id,
    }))),
    ...(gastos ?? []).flatMap(g => expandirGasto(g).map(mov => ({
      tipo: (mov.liquidado ? 'egreso' : 'comprometido') as 'egreso' | 'comprometido',
      moneda: g.moneda, monto: mov.monto, fecha: mov.fecha, obraId: g.obra_id,
    }))),
  ]

  const gastosPendientes = (gastos ?? [])
    .flatMap(g => {
      const pagos = (g.pagos ?? []) as PagoConFecha[]
      if (pagos.length > 0) {
        return pagos.filter(p => p.estado !== 'Pagado').map((p, idx) => ({
          id: `${g.id}-cuota-${idx}`,
          descripcion: `${g.descripcion} (cuota)`,
          monto: p.monto,
          moneda: g.moneda,
          fecha_vencimiento: p.fecha_pago,
          proveedor: g.proveedores?.razon_social ?? null,
          categoria: g.categorias_costo?.nombre ?? null,
          categoria_color: g.categorias_costo?.color ?? null,
          obraId: g.obra_id,
        }))
      }
      return g.estado === 'Pendiente' ? [{
        id: g.id,
        descripcion: g.descripcion,
        monto: g.monto,
        moneda: g.moneda,
        fecha_vencimiento: g.fecha_vencimiento,
        proveedor: g.proveedores?.razon_social ?? null,
        categoria: g.categorias_costo?.nombre ?? null,
        categoria_color: g.categorias_costo?.color ?? null,
        obraId: g.obra_id,
      }] : []
    })
    .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))

  const ingresosPendientes = ingresosConsolidados
    .filter(i => !i.pagado)
    .sort((a, b) => (a.fechaVencimiento ?? '').localeCompare(b.fechaVencimiento ?? ''))
    .map(i => ({
      id: i.id,
      descripcion: i.clienteNombre ? `${i.descripcion} — ${i.clienteNombre}` : i.descripcion,
      monto: i.monto,
      moneda: i.moneda,
      fecha_vencimiento: i.fechaVencimiento,
      obraId: i.obraId,
    }))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Caja</h1>
        <p className="text-slate-500 text-sm mt-1">Saldos por cuenta y flujo de caja mensual — todos los proyectos</p>
      </div>
      <TesoreriaView
        cuentas={cuentasConSaldo}
        movimientos={movimientos}
        meses={meses}
        proyectos={obras ?? []}
        gastosPendientes={gastosPendientes}
        ingresosPendientes={ingresosPendientes}
      />
    </div>
  )
}
