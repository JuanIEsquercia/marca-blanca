import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProyectoContext } from '@/lib/tenant'
import { estaVencido, formatCurrency, formatDate, redondear2 } from '@/lib/utils'
import { puedeAcceder, type ModuloKey } from '@/lib/permisos'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

export default async function DashboardPage({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params
  const ctx = await getProyectoContext(obraId)
  if (!ctx) redirect('/admin')

  // El dashboard en sí no está gateado por módulo (muestra métricas
  // agregadas), pero varios de sus links de acción sí llevan a un módulo
  // específico — no deben mostrarse si el operador no lo tiene en ESTE
  // proyecto, aunque la ruta destino ya esté protegida por el layout/RLS.
  const puede = (modulo: ModuloKey) => puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, modulo, obraId)

  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]
  const en7Dias = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  if (ctx.obraTipo === 'obra') {
    // Dashboard para OBRA de construcción — muestra los contratos con el
    // CLIENTE (migration_048: puede haber más de uno, ej. una etapa cada
    // uno — los de subcontratistas no son lo que este resumen mide, esos
    // se ven como gastos). Una card por contrato, no un total agregado:
    // certificar/cobrar es independiente por contrato.
    const { data: contratos } = await supabase
      .from('contratos_obra')
      .select('*, compradores(*)')
      .eq('obra_id', obraId)
      .eq('tipo', 'cliente')
      .order('fecha_inicio', { ascending: true, nullsFirst: false })

    const contratoIds = (contratos ?? []).map(c => c.id)

    // Contratos con SUBCONTRATISTAS de la misma obra — plata que sale, no
    // que entra, por eso se muestran en una sección aparte con otra
    // paleta (rojo en vez de verde) en vez de mezclarse con las cards de
    // arriba. Certifican hacia `gastos` (certificado_id), no hacia
    // cobros_proyecto.
    const { data: contratosSub } = await supabase
      .from('contratos_obra')
      .select('*, proveedores(razon_social)')
      .eq('obra_id', obraId)
      .eq('tipo', 'subcontratista')
      .order('fecha_inicio', { ascending: true, nullsFirst: false })
    const contratoIdsSub = (contratosSub ?? []).map(c => c.id)

    // cobros/gastos ya no filtran por estado en la query — antes solo se
    // traía lo cobrado/pagado, así que no había forma de detectar vencidos
    // sin otro round-trip. Con estado+fecha_vencimiento en el select se
    // derivan ambos (total cobrado/pagado y vencidos) de la misma consulta.
    type PagoConFecha = { estado: string; monto: number; fecha_pago: string }

    const [{ data: certificados }, { data: cobros }, { data: certificadosSub }, { data: pagos }] = await Promise.all([
      contratoIds.length > 0
        ? supabase.from('certificados_avance').select('*').in('contrato_obra_id', contratoIds).order('numero', { ascending: false })
        : Promise.resolve({ data: [] as { id: string; contrato_obra_id: string; numero: number; periodo: string; porcentaje_avance: number; monto_certificado: number; estado: string; created_at: string }[] }),
      // pagos:cobro_pagos — un cobro con plan de pago (migration_064) sigue
      // "Pendiente" a nivel de fila hasta que TODAS las cuotas cierran; sin
      // esto, "Total cobrado" no sumaba nada de un plan parcialmente
      // cumplido y "vencido" se evaluaba contra la fecha del padre en vez
      // de la fecha real de cada cheque.
      contratoIds.length > 0
        ? supabase.from('cobros_proyecto').select('monto, moneda, contrato_obra_id, estado, fecha_vencimiento, pagos:cobro_pagos(estado, monto, fecha_pago)').in('contrato_obra_id', contratoIds)
        : Promise.resolve({ data: [] as { monto: number; moneda: string; contrato_obra_id: string | null; estado: string; fecha_vencimiento: string | null; pagos?: PagoConFecha[] }[] }),
      contratoIdsSub.length > 0
        ? supabase.from('certificados_avance').select('*').in('contrato_obra_id', contratoIdsSub).order('numero', { ascending: false })
        : Promise.resolve({ data: [] as { id: string; contrato_obra_id: string; numero: number; periodo: string; porcentaje_avance: number; monto_certificado: number; estado: string; created_at: string }[] }),
      contratoIdsSub.length > 0
        ? supabase.from('gastos').select('monto, moneda, certificado_id, estado, fecha_vencimiento, certificados_avance!inner(contrato_obra_id), pagos:gasto_pagos(estado, monto, fecha_pago)').in('certificados_avance.contrato_obra_id', contratoIdsSub)
        : Promise.resolve({ data: [] as { monto: number; moneda: string; certificado_id: string | null; estado: string; fecha_vencimiento: string | null; certificados_avance: { contrato_obra_id: string } | null; pagos?: PagoConFecha[] }[] }),
    ])

    // Alertas agregadas (todas los contratos, cliente + subcontratistas) —
    // antes este dashboard no avisaba de nada, a diferencia del de
    // DESARROLLO (cuotas vencidas/reservas por vencer). Un operador tenía
    // que entrar módulo por módulo para descubrir un atraso.
    const DIAS_CERTIFICADO_ESTANCADO = 14
    const diasDesde = (fecha: string) => Math.floor((Date.now() - new Date(fecha).getTime()) / (1000 * 60 * 60 * 24))

    // Con plan de pago, cada cuota cuenta por su propio estado/fecha en vez
    // del padre — así un plan parcialmente cumplido aporta lo ya
    // liquidado y "vencido" mira la fecha real de la cuota, no la del padre
    // (que puede seguir mostrando una fecha vieja aunque haya un plan
    // vigente con cuotas a fecha futura).
    function montosLiquidados(pagos: PagoConFecha[] | undefined, estado: string, estadoLiquidado: string, montoPadre: number): number[] {
      if (pagos && pagos.length > 0) return pagos.filter(p => p.estado === estadoLiquidado).map(p => p.monto)
      return estado === estadoLiquidado ? [montoPadre] : []
    }
    function algunaVencida(pagos: PagoConFecha[] | undefined, estado: string, fechaVencimiento: string | null, estadoPendiente: string): boolean {
      if (pagos && pagos.length > 0) return pagos.some(p => estaVencido(p.fecha_pago, p.estado, estadoPendiente))
      return estaVencido(fechaVencimiento, estado, estadoPendiente)
    }

    const certificadosEstancados = [...(certificados ?? []), ...(certificadosSub ?? [])]
      .filter(c => c.estado === 'borrador' && diasDesde(c.created_at) > DIAS_CERTIFICADO_ESTANCADO)
    const cobrosVencidos = (cobros ?? []).filter(c => algunaVencida(c.pagos, c.estado, c.fecha_vencimiento, 'Pendiente'))
    const pagosVencidos = (pagos ?? []).filter(g => algunaVencida(g.pagos, g.estado, g.fecha_vencimiento, 'Pendiente'))

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">{ctx.obraNombre} — Obra de construcción</p>
        </div>

        {(certificadosEstancados.length > 0 || cobrosVencidos.length > 0 || pagosVencidos.length > 0) && (
          <div className="space-y-2">
            {certificadosEstancados.length > 0 && puede('certificados') && (
              <Link href={`/admin/proyectos/${obraId}/certificados`} className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors">
                <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p className="text-sm text-amber-800 flex-1"><strong>{certificadosEstancados.length} certificado{certificadosEstancados.length > 1 ? 's' : ''}</strong> en borrador hace más de {DIAS_CERTIFICADO_ESTANCADO} días sin presentar</p>
                <span className="text-xs text-amber-600">Ver →</span>
              </Link>
            )}
            {cobrosVencidos.length > 0 && puede('cobros') && (
              <Link href={`/admin/proyectos/${obraId}/cobros`} className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
                <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <p className="text-sm text-red-800 flex-1"><strong>{cobrosVencidos.length} cobro{cobrosVencidos.length > 1 ? 's' : ''}</strong> vencido{cobrosVencidos.length > 1 ? 's' : ''} sin cobrar</p>
                <span className="text-xs text-red-500">Ver →</span>
              </Link>
            )}
            {pagosVencidos.length > 0 && puede('gastos') && (
              <Link href={`/admin/proyectos/${obraId}/gastos`} className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
                <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <p className="text-sm text-red-800 flex-1"><strong>{pagosVencidos.length} pago{pagosVencidos.length > 1 ? 's' : ''} a subcontratistas</strong> vencido{pagosVencidos.length > 1 ? 's' : ''} sin pagar</p>
                <span className="text-xs text-red-500">Ver →</span>
              </Link>
            )}
          </div>
        )}

        {!contratos || contratos.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
            <p className="text-amber-800 font-medium">Sin contrato de obra cargado</p>
            {puede('certificados') && (
              <p className="text-amber-600 text-sm mt-1">
                Ingresá a <Link href={`/admin/proyectos/${obraId}/certificados`} className="underline">Contratos</Link> para comenzar.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {contratos.map(contrato => {
              const certifDelContrato = (certificados ?? []).filter(c => c.contrato_obra_id === contrato.id)
              const cobrosDelContrato = (cobros ?? []).filter(c => c.contrato_obra_id === contrato.id)
              const totalCobradoPorMoneda = cobrosDelContrato.reduce<Record<string, number>>((acc, c) => {
                for (const monto of montosLiquidados(c.pagos, c.estado, 'Cobrado', c.monto)) {
                  acc[c.moneda] = redondear2((acc[c.moneda] ?? 0) + Number(monto))
                }
                return acc
              }, {})
              const ultimoCertif = certifDelContrato[0] ?? null
              // Los certificados no tienen columna moneda propia: son un %
              // del contrato, siempre en contrato.moneda.
              const totalCertificados = redondear2(certifDelContrato.reduce((s, c) => s + Number(c.monto_certificado), 0))

              return (
                <div key={contrato.id} className="space-y-3">
                  {contratos.length > 1 && (
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {contrato.compradores?.nombre_completo}{contrato.descripcion ? ` — ${contrato.descripcion}` : ''}
                    </p>
                  )}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="bg-white border border-slate-200 rounded-xl p-5">
                      <p className="text-xs font-medium text-slate-500 mb-1">Monto del contrato</p>
                      <p className="text-xl sm:text-2xl font-bold text-slate-900 truncate" title={formatCurrency(contrato.monto_total, contrato.moneda)}>{formatCurrency(contrato.monto_total, contrato.moneda)}</p>
                      <p className="text-xs text-slate-400 mt-1">{contrato.compradores?.nombre_completo}</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-5">
                      <p className="text-xs font-medium text-slate-500 mb-1">Total certificado</p>
                      <p className="text-xl sm:text-2xl font-bold text-slate-900 truncate" title={formatCurrency(totalCertificados, contrato.moneda)}>{formatCurrency(totalCertificados, contrato.moneda)}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {contrato.monto_total > 0
                          ? `${Math.round((totalCertificados / contrato.monto_total) * 100)}% del contrato`
                          : '—'}
                      </p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-5">
                      <p className="text-xs font-medium text-slate-500 mb-1">Total cobrado</p>
                      {Object.keys(totalCobradoPorMoneda).length === 0 ? (
                        <p className="text-xl sm:text-2xl font-bold text-emerald-700 truncate" title={formatCurrency(0, contrato.moneda)}>{formatCurrency(0, contrato.moneda)}</p>
                      ) : (
                        Object.entries(totalCobradoPorMoneda).map(([moneda, monto]) => (
                          <p key={moneda} className="text-xl sm:text-2xl font-bold text-emerald-700 truncate" title={formatCurrency(monto, moneda)}>{formatCurrency(monto, moneda)}</p>
                        ))
                      )}
                      <p className="text-xs text-slate-400 mt-1">
                        Pendiente: {formatCurrency(redondear2(totalCertificados - (totalCobradoPorMoneda[contrato.moneda] ?? 0)), contrato.moneda)}
                      </p>
                    </div>
                  </div>

                  {ultimoCertif && (
                    <div className="bg-white border border-slate-200 rounded-xl p-5">
                      <p className="text-sm font-semibold text-slate-700 mb-3">Último certificado</p>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-slate-900">N°{ultimoCertif.numero} — {ultimoCertif.periodo}</p>
                          <p className="text-sm text-slate-500 mt-0.5">{ultimoCertif.porcentaje_avance}% de avance</p>
                        </div>
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                          ultimoCertif.estado === 'aprobado' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                          ultimoCertif.estado === 'presentado' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          'bg-slate-50 text-slate-600 border-slate-200'
                        }`}>
                          {ultimoCertif.estado.charAt(0).toUpperCase() + ultimoCertif.estado.slice(1)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {contratosSub && contratosSub.length > 0 && (
          <div className="space-y-5 pt-2 border-t border-slate-100">
            <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400" />
              Subcontratistas
            </p>
            {contratosSub.map(contrato => {
              const certifDelContrato = (certificadosSub ?? []).filter(c => c.contrato_obra_id === contrato.id)
              const pagosDelContrato = (pagos ?? []).filter(g => (g.certificados_avance as any)?.contrato_obra_id === contrato.id)
              const totalPagadoPorMoneda = pagosDelContrato.reduce<Record<string, number>>((acc, g) => {
                for (const monto of montosLiquidados(g.pagos, g.estado, 'Pagado', g.monto)) {
                  acc[g.moneda] = redondear2((acc[g.moneda] ?? 0) + Number(monto))
                }
                return acc
              }, {})
              const ultimoCertif = certifDelContrato[0] ?? null
              const totalCertificados = redondear2(certifDelContrato.reduce((s, c) => s + Number(c.monto_certificado), 0))

              return (
                <div key={contrato.id} className="space-y-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {contrato.proveedores?.razon_social}{contrato.descripcion ? ` — ${contrato.descripcion}` : ''}
                  </p>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="bg-white border border-slate-200 rounded-xl p-5">
                      <p className="text-xs font-medium text-slate-500 mb-1">Monto del contrato</p>
                      <p className="text-xl sm:text-2xl font-bold text-slate-900 truncate" title={formatCurrency(contrato.monto_total, contrato.moneda)}>{formatCurrency(contrato.monto_total, contrato.moneda)}</p>
                      <p className="text-xs text-slate-400 mt-1">{contrato.proveedores?.razon_social}</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-5">
                      <p className="text-xs font-medium text-slate-500 mb-1">Total certificado</p>
                      <p className="text-xl sm:text-2xl font-bold text-slate-900 truncate" title={formatCurrency(totalCertificados, contrato.moneda)}>{formatCurrency(totalCertificados, contrato.moneda)}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {contrato.monto_total > 0
                          ? `${Math.round((totalCertificados / contrato.monto_total) * 100)}% del contrato`
                          : '—'}
                      </p>
                    </div>
                    <div className="bg-white border border-red-100 rounded-xl p-5">
                      <p className="text-xs font-medium text-slate-500 mb-1">Total pagado</p>
                      {Object.keys(totalPagadoPorMoneda).length === 0 ? (
                        <p className="text-xl sm:text-2xl font-bold text-red-700 truncate" title={formatCurrency(0, contrato.moneda)}>{formatCurrency(0, contrato.moneda)}</p>
                      ) : (
                        Object.entries(totalPagadoPorMoneda).map(([moneda, monto]) => (
                          <p key={moneda} className="text-xl sm:text-2xl font-bold text-red-700 truncate" title={formatCurrency(monto, moneda)}>{formatCurrency(monto, moneda)}</p>
                        ))
                      )}
                      <p className="text-xs text-slate-400 mt-1">
                        Pendiente: {formatCurrency(redondear2(totalCertificados - (totalPagadoPorMoneda[contrato.moneda] ?? 0)), contrato.moneda)}
                      </p>
                    </div>
                  </div>

                  {ultimoCertif && (
                    <div className="bg-white border border-slate-200 rounded-xl p-5">
                      <p className="text-sm font-semibold text-slate-700 mb-3">Último certificado</p>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-slate-900">N°{ultimoCertif.numero} — {ultimoCertif.periodo}</p>
                          <p className="text-sm text-slate-500 mt-0.5">{ultimoCertif.porcentaje_avance}% de avance</p>
                        </div>
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                          ultimoCertif.estado === 'aprobado' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                          ultimoCertif.estado === 'presentado' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          'bg-slate-50 text-slate-600 border-slate-200'
                        }`}>
                          {ultimoCertif.estado.charAt(0).toUpperCase() + ultimoCertif.estado.slice(1)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // Dashboard para DESARROLLO inmobiliario
  // Antes esto traía TODOS los contratos_venta de la obra con joins anidados
  // a compradores/unidades/cuotas (filas completas) solo para mostrar 5 en
  // "Últimas ventas" y sumar dos agregados en JS — con muchos contratos esa
  // única query pesaba mucho más de lo que hacía falta. Se separa en 3
  // queries angostas: la de display ya viene limitada a 5 desde la DB, y los
  // dos agregados solo piden las columnas que suman (sin joins anidados).
  // Las cuotas no tienen obra_id directo; se obtienen via contratos_venta (que sí tiene obra_id).
  const [
    unidadesRes,
    ultimasVentasRes,
    precioFinalRes,
    cuotasPendientesRes,
    reservasVigenteRes,
    reservasPorVencerRes,
  ] = await Promise.all([
    supabase.from('unidades').select('estado_comercial').eq('obra_id', obraId),
    supabase
      .from('contratos_venta')
      .select('id, precio_final, fecha_firma, compradores(nombre_completo), unidades(piso, numero, letra)')
      .eq('obra_id', obraId)
      .eq('estado', 'vigente')
      .order('fecha_firma', { ascending: false })
      .limit(5),
    supabase.from('contratos_venta').select('precio_final').eq('obra_id', obraId).eq('estado', 'vigente'),
    supabase
      .from('cuotas')
      .select('monto_base, fecha_vencimiento, contratos_venta!inner(obra_id, estado)')
      .eq('estado_pago', 'Pendiente')
      .eq('contratos_venta.obra_id', obraId)
      .eq('contratos_venta.estado', 'vigente'),
    supabase.from('reservas').select('*', { count: 'exact', head: true }).eq('obra_id', obraId).eq('estado', 'Vigente'),
    supabase.from('reservas').select('*', { count: 'exact', head: true }).eq('obra_id', obraId).eq('estado', 'Vigente').lte('fecha_vencimiento', en7Dias),
  ])

  const unidades = unidadesRes.data ?? []
  const cuotasPendientes = cuotasPendientesRes.data ?? []
  const cuotasVencidas = cuotasPendientes.filter(c => c.fecha_vencimiento < today)

  const stats = {
    total: unidades.length,
    disponibles: unidades.filter(u => u.estado_comercial === 'Disponible').length,
    reservadas: unidades.filter(u => u.estado_comercial === 'Reservado').length,
    vendidas: unidades.filter(u => u.estado_comercial === 'Vendido').length,
    ingresos_contratos: (precioFinalRes.data ?? []).reduce((acc, c) => acc + Number(c.precio_final), 0),
    cuotas_pendientes: cuotasPendientes.reduce((acc, c) => acc + Number(c.monto_base), 0),
    cuotas_vencidas: cuotasVencidas.length,
    reservas_vigentes: reservasVigenteRes.count ?? 0,
    reservas_por_vencer: reservasPorVencerRes.count ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ultimos_contratos: (ultimasVentasRes.data ?? []) as any[],
  }

  const kpis = [
    { label: 'Disponibles', value: stats.disponibles, color: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    { label: 'Reservadas', value: stats.reservadas, color: 'bg-amber-50 text-amber-700 border-amber-100' },
    { label: 'Vendidas', value: stats.vendidas, color: 'bg-slate-100 text-slate-700 border-slate-200' },
    { label: 'Total', value: stats.total, color: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  ]

  const base = `/admin/proyectos/${obraId}`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">{ctx.obraNombre}</p>
      </div>

      {((stats.cuotas_vencidas > 0 && puede('contratos')) || (stats.reservas_por_vencer > 0 && puede('reservas'))) && (
        <div className="space-y-2">
          {stats.cuotas_vencidas > 0 && puede('contratos') && (
            <Link href={`${base}/contratos`} className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
              <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <p className="text-sm text-red-800 flex-1"><strong>{stats.cuotas_vencidas} cuota{stats.cuotas_vencidas > 1 ? 's' : ''}</strong> vencida{stats.cuotas_vencidas > 1 ? 's' : ''} sin cobrar</p>
              <span className="text-xs text-red-500">Ver →</span>
            </Link>
          )}
          {stats.reservas_por_vencer > 0 && puede('reservas') && (
            <Link href={`${base}/reservas`} className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors">
              <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              <p className="text-sm text-amber-800 flex-1"><strong>{stats.reservas_por_vencer} reserva{stats.reservas_por_vencer > 1 ? 's' : ''}</strong> vence{stats.reservas_por_vencer > 1 ? 'n' : ''} en los próximos 7 días</p>
              <span className="text-xs text-amber-600">Ver →</span>
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(card => (
          <div key={card.label} className={`p-5 rounded-xl border ${card.color}`}>
            <p className="text-3xl font-bold">{card.value}</p>
            <p className="text-sm font-medium mt-1 opacity-80">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <p className="text-sm font-medium text-slate-500 mb-1">Ingresos totales por contratos</p>
          <p className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 truncate" title={formatCurrency(stats.ingresos_contratos)}>{formatCurrency(stats.ingresos_contratos)}</p>
          <p className="text-xs text-slate-400 mt-2">Suma de precios finales firmados</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <p className="text-sm font-medium text-slate-500 mb-1">Saldo en cuotas pendientes</p>
          <p className="text-xl sm:text-2xl md:text-3xl font-bold text-orange-600 truncate" title={formatCurrency(stats.cuotas_pendientes)}>{formatCurrency(stats.cuotas_pendientes)}</p>
          <p className="text-xs text-slate-400 mt-2">Total de cuotas en estado Pendiente</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex justify-between items-center mb-3">
          <p className="text-sm font-medium text-slate-700">Ocupación del desarrollo</p>
          <p className="text-sm text-slate-500">
            {stats.total > 0 ? Math.round(((stats.vendidas + stats.reservadas) / stats.total) * 100) : 0}% comprometido
          </p>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden flex">
          {stats.total > 0 && (
            <>
              <div className="bg-slate-400 transition-all" style={{ width: `${(stats.vendidas / stats.total) * 100}%` }} />
              <div className="bg-amber-400 transition-all" style={{ width: `${(stats.reservadas / stats.total) * 100}%` }} />
              <div className="bg-emerald-400 transition-all" style={{ width: `${(stats.disponibles / stats.total) * 100}%` }} />
            </>
          )}
        </div>
        <div className="flex gap-4 mt-2">
          {[{ color: 'bg-slate-400', label: 'Vendido' }, { color: 'bg-amber-400', label: 'Reservado' }, { color: 'bg-emerald-400', label: 'Disponible' }].map(l => (
            <div key={l.label} className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
              {l.label}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <p className="font-semibold text-slate-800 text-sm">Últimas ventas</p>
            {puede('contratos') && (
              <Link href={`${base}/contratos`} className="text-xs text-indigo-600 hover:text-indigo-800">Ver todas →</Link>
            )}
          </div>
          {stats.ultimos_contratos.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">Aún no hay ventas registradas.</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {stats.ultimos_contratos.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{c.compradores?.nombre_completo}</p>
                    <p className="text-xs text-slate-400">P{c.unidades?.piso} - {c.unidades?.numero}{c.unidades?.letra ?? ''} &bull; {formatDate(c.fecha_firma)}</p>
                  </div>
                  <p className="font-semibold text-slate-900 text-sm">{formatCurrency(c.precio_final)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1">Acciones rápidas</p>
          {puede('unidades') && (
            <Link href={`${base}/unidades`} className="flex items-center gap-3 p-4 bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-colors">
              <svg className="w-5 h-5 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
              <div>
                <p className="text-white font-medium text-sm">Registrar venta</p>
                <p className="text-indigo-200 text-xs">Desde Unidades</p>
              </div>
            </Link>
          )}
          {puede('reservas') && (
            <Link href={`${base}/reservas`} className="flex items-center gap-3 p-4 bg-white border border-slate-200 hover:border-slate-300 rounded-xl transition-colors">
              <svg className="w-5 h-5 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              <div>
                <p className="text-slate-800 font-medium text-sm">Ver reservas</p>
                <p className="text-slate-400 text-xs">{stats.reservas_vigentes} vigente{stats.reservas_vigentes !== 1 ? 's' : ''}</p>
              </div>
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
