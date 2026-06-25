import { createClient } from '@/lib/supabase/server'
import ReservasManager from '@/components/admin/ReservasManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Reservas' }
export const dynamic = 'force-dynamic'

export default async function ReservasPage() {
  const supabase = await createClient()

  const [{ data: reservas }, { data: cuentasPropias }] = await Promise.all([
    supabase
      .from('reservas')
      .select('*, compradores(*), unidades(*, tipologias(*)), cuentas_propias(*)')
      .order('created_at', { ascending: false }),
    supabase.from('cuentas_propias').select('*').eq('activa', true).order('nombre'),
  ])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Reservas</h1>
        <p className="text-slate-500 text-sm mt-1">
          Gestioná reservas vigentes — convertí a venta o liberá la unidad
        </p>
      </div>
      <ReservasManager reservas={reservas ?? []} cuentasPropias={cuentasPropias ?? []} />
    </div>
  )
}
