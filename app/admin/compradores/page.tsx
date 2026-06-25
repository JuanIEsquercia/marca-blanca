import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Compradores' }
export const dynamic = 'force-dynamic'

export default async function CompradoresPage() {
  const supabase = await createClient()

  const { data: compradores } = await supabase
    .from('compradores')
    .select(`
      *,
      contratos_venta (
        id,
        precio_final,
        cantidad_cuotas,
        fecha_firma,
        unidades ( piso, numero, letra )
      )
    `)
    .order('created_at', { ascending: false })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Compradores</h1>
        <p className="text-slate-500 text-sm mt-1">Listado de todos los compradores registrados</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Nombre</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">DNI / CUIT</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Email</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Teléfono</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Unidad</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Firma</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(compradores ?? []).map(c => {
              const contrato = c.contratos_venta?.[0]
              const unidad = contrato?.unidades
              return (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{c.nombre_completo}</td>
                  <td className="px-4 py-3 text-slate-600 font-mono text-xs">{c.dni_cuit}</td>
                  <td className="px-4 py-3 text-slate-600">{c.email ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{c.telefono ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {unidad ? `P${unidad.piso} - ${unidad.numero}${unidad.letra ?? ''}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {contrato ? formatDate(contrato.fecha_firma) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {(!compradores || compradores.length === 0) && (
          <div className="text-center py-12 text-slate-400">No hay compradores registrados aún.</div>
        )}
      </div>
    </div>
  )
}
