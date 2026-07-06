import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import CuentasPropiasManager from '@/components/admin/CuentasPropiasManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Cuentas propias' }
export const dynamic = 'force-dynamic'

export default async function CuentasPage() {
  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')

  const supabase = await createClient()
  const { data: cuentas } = await supabase
    .from('cuentas_propias')
    .select('*')
    .eq('constructora_id', ctx.constructoraId)
    .order('nombre')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Cuentas propias</h1>
        <p className="text-slate-500 text-sm mt-1">
          Cuentas bancarias y cajas de la constructora — compartidas entre proyectos o específicas de uno
        </p>
      </div>
      <CuentasPropiasManager
        cuentas={cuentas ?? []}
        constructoraId={ctx.constructoraId}
      />
    </div>
  )
}
