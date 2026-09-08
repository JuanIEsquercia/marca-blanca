import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getProyectoContext } from '@/lib/tenant'
import { puedeAcceder } from '@/lib/permisos'
import { cn, formatCurrency, redondear2 } from '@/lib/utils'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Control de obra' }
export const dynamic = 'force-dynamic'

// Una fila por rubro, ya agregada en Postgres (resumen_rubros_obra,
// migration_073) — nunca se traen los gastos crudos para sumarlos acá.
interface FilaRubro {
  rubro: string | null
  moneda_contrato: string | null
  monto_contratado: number
  monto_certificado: number
  pct_certificado: number
  costo_ars: number
  costo_usd: number
  costo_pendiente_ars: number
  costo_pendiente_usd: number
  cantidad_gastos: number
}

function Kpi({ label, valor, detalle, tono = 'neutro' }: {
  label: string
  valor: string
  detalle?: string
  tono?: 'neutro' | 'bueno' | 'malo'
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={cn(
        'text-xl sm:text-2xl font-bold mt-1 truncate',
        tono === 'bueno' ? 'text-emerald-600' : tono === 'malo' ? 'text-red-600' : 'text-slate-900'
      )} title={valor}>{valor}</p>
      {detalle && <p className="text-xs text-slate-400 mt-0.5">{detalle}</p>}
    </div>
  )
}

export default async function ControlObraPage({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params
  const ctx = await getProyectoContext(obraId)
  if (!ctx) redirect('/admin')
  if (ctx.obraTipo !== 'obra') redirect(`/admin/proyectos/${obraId}/dashboard`)

  // Módulo propio (migration_074), no la suma de 'certificados' + 'gastos':
  // así se puede dar acceso al análisis sin dar permiso de escritura sobre
  // contratos ni gastos. La RPC chequea este mismo módulo por dentro, con
  // SECURITY DEFINER, así que devuelve el análisis completo o falla — nunca
  // la mitad de los datos en silencio.
  if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'control', obraId)) {
    redirect('/admin?motivo=sin-acceso')
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('resumen_rubros_obra', { p_obra_id: obraId })

  const filas = (data ?? []) as FilaRubro[]
  const conRubro = filas.filter(f => f.rubro !== null)
  const sinImputar = filas.find(f => f.rubro === null)

  const monedaContrato = conRubro.find(f => f.moneda_contrato)?.moneda_contrato ?? 'ARS'
  const totalContratado = redondear2(conRubro.reduce((s, f) => s + f.monto_contratado, 0))
  const totalCertificado = redondear2(conRubro.reduce((s, f) => s + f.monto_certificado, 0))
  const pctTotal = totalContratado > 0 ? Math.round((totalCertificado / totalContratado) * 100) : 0

  // ARS y USD nunca se suman entre sí. El margen solo se calcula contra el
  // costo de la MISMA moneda del contrato; si además hay costo en la otra,
  // se avisa aparte en vez de mezclarlo en el número.
  const costoEnMonedaContrato = redondear2(
    filas.reduce((s, f) => s + (monedaContrato === 'USD' ? f.costo_usd : f.costo_ars), 0)
  )
  const costoOtraMoneda = redondear2(
    filas.reduce((s, f) => s + (monedaContrato === 'USD' ? f.costo_ars : f.costo_usd), 0)
  )
  const otraMoneda = monedaContrato === 'USD' ? 'ARS' : 'USD'
  const margen = redondear2(totalContratado - costoEnMonedaContrato)
  const pctMargen = totalContratado > 0 ? Math.round((margen / totalContratado) * 100) : 0

  const costoSinImputar = sinImputar
    ? redondear2(monedaContrato === 'USD' ? sinImputar.costo_usd : sinImputar.costo_ars)
    : 0

  function costoDeFila(f: FilaRubro): number {
    return monedaContrato === 'USD' ? f.costo_usd : f.costo_ars
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Control de obra</h1>
        <p className="text-slate-500 text-sm mt-1">
          Lo presupuestado contra lo ejecutado, rubro por rubro — {ctx.obraNombre}
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          No se pudo calcular el control de obra: {error.message}
        </div>
      )}

      {!error && conRubro.length === 0 && !sinImputar && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <p className="text-slate-600 font-medium">Todavía no hay nada que comparar</p>
          <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
            Esta pantalla cruza los rubros del contrato con el cliente contra los gastos imputados a cada uno.
            Cargá el contrato en Contratos y, al registrar cada gasto, elegí a qué rubro corresponde.
          </p>
          <Link href={`/admin/proyectos/${obraId}/certificados`}
            className="inline-block mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold">
            Ir a Contratos
          </Link>
        </div>
      )}

      {!error && (conRubro.length > 0 || sinImputar) && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Contratado" valor={formatCurrency(totalContratado, monedaContrato)}
              detalle={`${conRubro.length} rubro${conRubro.length === 1 ? '' : 's'} en contrato`} />
            <Kpi label="Certificado" valor={formatCurrency(totalCertificado, monedaContrato)}
              detalle={`${pctTotal}% del contrato`} />
            <Kpi label="Costo imputado" valor={formatCurrency(costoEnMonedaContrato, monedaContrato)}
              detalle={costoOtraMoneda > 0 ? `+ ${formatCurrency(costoOtraMoneda, otraMoneda)} en ${otraMoneda}` : undefined} />
            <Kpi label="Margen estimado" valor={formatCurrency(margen, monedaContrato)}
              detalle={`${pctMargen}% sobre lo contratado`}
              tono={margen < 0 ? 'malo' : 'bueno'} />
          </div>

          {costoSinImputar > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
              <span className="text-amber-500 text-lg leading-none">⚠</span>
              <div className="flex-1">
                <p className="text-sm text-amber-900">
                  Hay <strong>{formatCurrency(costoSinImputar, monedaContrato)}</strong> en{' '}
                  {sinImputar?.cantidad_gastos} gasto{sinImputar?.cantidad_gastos === 1 ? '' : 's'} sin rubro asignado.
                  Ese costo no está repartido entre los rubros de abajo, así que el margen por rubro todavía no es completo.
                </p>
                <Link href={`/admin/proyectos/${obraId}/gastos`}
                  className="text-xs text-amber-700 hover:text-amber-900 font-medium underline mt-1 inline-block">
                  Ir a Gastos para imputarlos
                </Link>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Rubro</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Contratado</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Certificado</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Costo real</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Margen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {conRubro.map(f => {
                    const costo = costoDeFila(f)
                    const margenRubro = redondear2(f.monto_contratado - costo)
                    const sinContrato = f.monto_contratado === 0
                    return (
                      <tr key={f.rubro} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{f.rubro}</p>
                          {sinContrato && (
                            <p className="text-[11px] text-amber-600">
                              Gasto sin este rubro en el contrato — si es un adicional, agregalo al contrato
                            </p>
                          )}
                          {f.cantidad_gastos > 0 && (
                            <p className="text-[11px] text-slate-400">
                              {f.cantidad_gastos} gasto{f.cantidad_gastos === 1 ? '' : 's'}
                              {(f.costo_pendiente_ars > 0 || f.costo_pendiente_usd > 0) && ' · con saldo pendiente de pago'}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">
                          {sinContrato ? <span className="text-slate-300">—</span> : formatCurrency(f.monto_contratado, monedaContrato)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {sinContrato ? <span className="text-slate-300">—</span> : (
                            <>
                              <p className="text-slate-700">{formatCurrency(f.monto_certificado, monedaContrato)}</p>
                              <p className="text-[11px] text-slate-400">{Math.round(f.pct_certificado)}%</p>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">
                          {costo > 0 ? formatCurrency(costo, monedaContrato) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className={cn(
                          'px-4 py-3 text-right font-semibold',
                          sinContrato ? 'text-slate-300' : margenRubro < 0 ? 'text-red-600' : 'text-emerald-600'
                        )}>
                          {sinContrato ? '—' : formatCurrency(margenRubro, monedaContrato)}
                        </td>
                      </tr>
                    )
                  })}

                  {sinImputar && (
                    <tr className="bg-amber-50/60">
                      <td className="px-4 py-3">
                        <p className="font-medium text-amber-900">Sin rubro asignado</p>
                        <p className="text-[11px] text-amber-600">
                          {sinImputar.cantidad_gastos} gasto{sinImputar.cantidad_gastos === 1 ? '' : 's'} todavía sin imputar
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">—</td>
                      <td className="px-4 py-3 text-right text-slate-300">—</td>
                      <td className="px-4 py-3 text-right text-amber-900">{formatCurrency(costoSinImputar, monedaContrato)}</td>
                      <td className="px-4 py-3 text-right text-slate-300">—</td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr className="font-semibold text-slate-900">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(totalContratado, monedaContrato)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(totalCertificado, monedaContrato)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(costoEnMonedaContrato, monedaContrato)}</td>
                    <td className={cn('px-4 py-3 text-right', margen < 0 ? 'text-red-600' : 'text-emerald-600')}>
                      {formatCurrency(margen, monedaContrato)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            El costo incluye los gastos imputados a cada rubro, estén pagados o pendientes.
            El margen es una estimación: compara lo contratado contra lo gastado hasta hoy, no contra el costo final proyectado.
            {costoOtraMoneda > 0 && ` Hay además ${formatCurrency(costoOtraMoneda, otraMoneda)} de costo en ${otraMoneda} que no se suma acá, porque el contrato está en ${monedaContrato}.`}
          </p>
        </div>
      )}
    </div>
  )
}
