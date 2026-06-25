import { createClient } from '@/lib/supabase/server'
import CuentasPropiasManager from '@/components/admin/CuentasPropiasManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Cuentas propias' }
export const dynamic = 'force-dynamic'

export default async function CuentasPage() {
  const supabase = await createClient()
  const { data: cuentas } = await supabase
    .from('cuentas_propias')
    .select('*')
    .order('nombre')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Cuentas propias</h1>
        <p className="text-slate-500 text-sm mt-1">
          Cuentas bancarias y cajas del desarrollo — desde/hacia donde se registran los movimientos
        </p>
      </div>
      <CuentasPropiasManager cuentas={cuentas ?? []} />
    </div>
  )
}
