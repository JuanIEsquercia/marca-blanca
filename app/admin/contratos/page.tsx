import { createClient } from '@/lib/supabase/server'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Contratos' }
export const dynamic = 'force-dynamic'

export default async function ContratosPage() {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  const { data: contratos } = await supabase
    .from('contratos_venta')
    .select(`
      *,
      compradores(*),
      unidades(piso, numero, letra, tipologias(nombre)),
      cuotas(id, estado_pago, fecha_vencimiento)
    `)
    .order('fecha_firma', { ascending: false })

  const rows = (contratos ?? []).map(c => {
    const cuotas = c.cuotas ?? []
    const pagadas = cuotas.filter((q: { estado_pago: string }) => q.estado_pago === 'Pagado').length
    const vencidas = cuotas.filter(
      (q: { estado_pago: string; fecha_vencimiento: string }) =>
        q.estado_pago === 'Pendiente' && q.fecha_vencimiento < today
    ).length
    return { ...c, cuotas, pagadas, vencidas }
  })

  const totalIngresos = rows.reduce((acc, c) => acc + Number(c.precio_final), 0)
  const totalVencidas = rows.reduce((acc, c) => acc + c.vencidas, 0)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Contratos</h1>
        <p className="text-slate-500 text-sm mt-1">Todas las ventas firmadas del desarrollo</p>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 mb-1">Contratos firmados</p>
          <p className="text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 mb-1">Ingresos totales</p>
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(totalIngresos)}</p>
        </div>
        <div className={`border rounded-xl p-4 ${totalVencidas > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
          <p className={`text-xs font-medium mb-1 ${totalVencidas > 0 ? 'text-red-600' : 'text-slate-500'}`}>
            Cuotas vencidas sin cobrar
          </p>
          <p className={`text-2xl font-bold ${totalVencidas > 0 ? 'text-red-700' : 'text-slate-900'}`}>
            {totalVencidas}
          </p>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Comprador</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Unidad</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">Precio final</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">Entrega</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Cuotas</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Firma</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(c => {
                const unidad = c.unidades as { piso: number; numero: string; letra: string | null; tipologias: { nombre: string } } | null
                const comprador = c.compradores as { nombre_completo: string; dni_cuit: string } | null
                return (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{comprador?.nombre_completo}</p>
                      <p className="text-xs text-slate-400 font-mono">{comprador?.dni_cuit}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {unidad ? `P${unidad.piso} - ${unidad.numero}${unidad.letra ?? ''}` : '—'}
                      <p className="text-xs text-slate-400">{unidad?.tipologias?.nombre}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {formatCurrency(c.precio_final)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {formatCurrency(c.entrega_efectiva)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-xs text-slate-500">
                          {c.pagadas}/{c.cuotas.length} pagadas
                        </span>
                        {c.vencidas > 0 && (
                          <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
                            {c.vencidas} vencida{c.vencidas > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(c.fecha_firma)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/cuenta-corriente?contrato=${c.id}`}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
                      >
                        Ver cuotas →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {rows.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <p className="text-sm">No hay contratos registrados aún.</p>
              <p className="text-xs mt-1">
                Los contratos se generan al cerrar una venta desde{' '}
                <Link href="/admin/inventario" className="text-indigo-500 hover:text-indigo-700">Inventario</Link>.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
