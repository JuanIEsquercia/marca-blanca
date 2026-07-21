import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProyectoContext } from '@/lib/tenant'
import { calcularSaldosDeCuentas } from '@/lib/tesoreria'
import CuentasPropiasManager from '@/components/admin/CuentasPropiasManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Cuentas del proyecto' }
export const dynamic = 'force-dynamic'

export default async function CuentasProyectoPage({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params
  const ctx = await getProyectoContext(obraId)
  if (!ctx) redirect('/admin')

  const supabase = await createClient()
  const { data: cuentas } = await supabase
    .from('cuentas_propias')
    .select('*')
    .eq('constructora_id', ctx.constructoraId)
    .eq('obra_id', obraId)
    .order('nombre')

  const saldos = await calcularSaldosDeCuentas(supabase, ctx.constructoraId, cuentas ?? [])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Cuentas del proyecto</h1>
        <p className="text-slate-500 text-sm mt-1">
          {ctx.obraNombre} — cuentas bancarias y cajas específicas de este proyecto
        </p>
      </div>
      <CuentasPropiasManager
        cuentas={cuentas ?? []}
        saldos={saldos}
        constructoraId={ctx.constructoraId}
        obraId={obraId}
        readOnly={ctx.obraEstado === 'finalizada'}
      />
    </div>
  )
}
