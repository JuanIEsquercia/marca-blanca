import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProyectoContext } from '@/lib/tenant'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

export default async function DashboardPage({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params
  const ctx = await getProyectoContext(obraId)
  if (!ctx) redirect('/admin')

  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]
  const en7Dias = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  if (ctx.obraTipo === 'obra') {
    // Dashboard para OBRA de construcción
    const [{ data: contrato }, { data: certificados }, { data: cobros }] = await Promise.all([
      supabase
        .from('contratos_obra')
        .select('*')
        .eq('obra_id', obraId)
        .maybeSingle(),
      supabase
        .from('certificados_avance')
        .select('*')
        .eq('obra_id', obraId)
        .order('numero', { ascending: false }),
      supabase
        .from('cobros_proyecto')
        .select('monto')
        .eq('obra_id', obraId),
    ])

    const totalCobrado = (cobros ?? []).reduce((s, c) => s + Number(c.monto), 0)
    const ultimoCertif = certificados?.[0] ?? null
    const totalCertificados = (certificados ?? []).reduce((s, c) => s + Number(c.monto_certificado), 0)

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">{ctx.obraNombre} — Obra de construcción</p>
        </div>

        {!contrato ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
            <p className="text-amber-800 font-medium">Sin contrato de obra cargado</p>
            <p className="text-amber-600 text-sm mt-1">
              Ingresá a <Link href={`/admin/proyectos/${obraId}/certificados`} className="underline">Certificados</Link> para comenzar.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500 mb-1">Monto del contrato</p>
              <p className="text-2xl font-bold text-slate-900">{formatCurrency(contrato.monto_total)}</p>
              <p className="text-xs text-slate-400 mt-1">{contrato.cliente_nombre}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500 mb-1">Total certificado</p>
              <p className="text-2xl font-bold text-slate-900">{formatCurrency(totalCertificados)}</p>
              <p className="text-xs text-slate-400 mt-1">
                {contrato.monto_total > 0
                  ? `${Math.round((totalCertificados / contrato.monto_total) * 100)}% del contrato`
                  : '—'}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500 mb-1">Total cobrado</p>
              <p className="text-2xl font-bold text-emerald-700">{formatCurrency(totalCobrado)}</p>
              <p className="text-xs text-slate-400 mt-1">
                Pendiente: {formatCurrency(totalCertificados - totalCobrado)}
              </p>
            </div>
          </div>
        )}

        {ultimoCertif && (
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="text-sm font-semibold text-slate-700 mb-3">Último certificado</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900">N°{ultimoCertif.numero} — {ultimoCertif.periodo}</p>
                <p className="text-sm text-slate-500 mt-0.5">{ultimoCertif.porcentaje_avance}% de avance</p>
              </div>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                ultimoCertif.estado === 'cobrado' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
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
  }

  // Dashboard para DESARROLLO inmobiliario
  // Las cuotas no tienen obra_id directo; se obtienen via contratos_venta (que sí tiene obra_id)
  const [
    unidadesRes,
    contratosRes,
    reservasVigenteRes,
    reservasPorVencerRes,
  ] = await Promise.all([
    supabase.from('unidades').select('estado_comercial').eq('obra_id', obraId),
    supabase
      .from('contratos_venta')
      .select('id, precio_final, fecha_firma, compradores(nombre_completo), unidades(piso, numero, letra), cuotas(monto_base, estado_pago, fecha_vencimiento)')
      .eq('obra_id', obraId)
      .order('fecha_firma', { ascending: false }),
    supabase.from('reservas').select('*', { count: 'exact', head: true }).eq('obra_id', obraId).eq('estado', 'Vigente'),
    supabase.from('reservas').select('*', { count: 'exact', head: true }).eq('obra_id', obraId).eq('estado', 'Vigente').lte('fecha_vencimiento', en7Dias),
  ])

  const unidades = unidadesRes.data ?? []
  const contratos = contratosRes.data ?? []

  // Flatten cuotas de todos los contratos de esta obra
  type CuotaBasic = { monto_base: number; estado_pago: string; fecha_vencimiento: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allCuotas = contratos.flatMap(c => ((c.cuotas ?? []) as any[]) as CuotaBasic[])
  const cuotasPendientes = allCuotas.filter(c => c.estado_pago === 'Pendiente')
  const cuotasVencidas = cuotasPendientes.filter(c => c.fecha_vencimiento < today)

  const stats = {
    total: unidades.length,
    disponibles: unidades.filter(u => u.estado_comercial === 'Disponible').length,
    reservadas: unidades.filter(u => u.estado_comercial === 'Reservado').length,
    vendidas: unidades.filter(u => u.estado_comercial === 'Vendido').length,
    ingresos_contratos: contratos.reduce((acc, c) => acc + Number(c.precio_final), 0),
    cuotas_pendientes: cuotasPendientes.reduce((acc, c) => acc + Number(c.monto_base), 0),
    cuotas_vencidas: cuotasVencidas.length,
    reservas_vigentes: reservasVigenteRes.count ?? 0,
    reservas_por_vencer: reservasPorVencerRes.count ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ultimos_contratos: contratos.slice(0, 5) as any[],
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

      {(stats.cuotas_vencidas > 0 || stats.reservas_por_vencer > 0) && (
        <div className="space-y-2">
          {stats.cuotas_vencidas > 0 && (
            <Link href={`${base}/contratos`} className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
              <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <p className="text-sm text-red-800 flex-1"><strong>{stats.cuotas_vencidas} cuota{stats.cuotas_vencidas > 1 ? 's' : ''}</strong> vencida{stats.cuotas_vencidas > 1 ? 's' : ''} sin cobrar</p>
              <span className="text-xs text-red-500">Ver →</span>
            </Link>
          )}
          {stats.reservas_por_vencer > 0 && (
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
          <p className="text-3xl font-bold text-slate-900">{formatCurrency(stats.ingresos_contratos)}</p>
          <p className="text-xs text-slate-400 mt-2">Suma de precios finales firmados</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <p className="text-sm font-medium text-slate-500 mb-1">Saldo en cuotas pendientes</p>
          <p className="text-3xl font-bold text-orange-600">{formatCurrency(stats.cuotas_pendientes)}</p>
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
            <Link href={`${base}/contratos`} className="text-xs text-indigo-600 hover:text-indigo-800">Ver todas →</Link>
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
          <Link href={`${base}/unidades`} className="flex items-center gap-3 p-4 bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-colors">
            <svg className="w-5 h-5 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
            <div>
              <p className="text-white font-medium text-sm">Registrar venta</p>
              <p className="text-indigo-200 text-xs">Desde Unidades</p>
            </div>
          </Link>
          <Link href={`${base}/reservas`} className="flex items-center gap-3 p-4 bg-white border border-slate-200 hover:border-slate-300 rounded-xl transition-colors">
            <svg className="w-5 h-5 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <div>
              <p className="text-slate-800 font-medium text-sm">Ver reservas</p>
              <p className="text-slate-400 text-xs">{stats.reservas_vigentes} vigente{stats.reservas_vigentes !== 1 ? 's' : ''}</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
