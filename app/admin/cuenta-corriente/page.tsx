import { createClient } from '@/lib/supabase/server'
import CuentaCorriente from '@/components/admin/CuentaCorriente'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Cuenta Corriente' }
export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ contrato?: string }>
}

export default async function CuentaCorrientePage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { contrato: initialContratoId } = await searchParams

  const [{ data: contratos }, { data: cuentasPropias }] = await Promise.all([
    supabase
      .from('contratos_venta')
      .select('*, compradores(*), unidades(*, tipologias(*)), cuotas(*)')
      .order('fecha_firma', { ascending: false }),
    supabase.from('cuentas_propias').select('*').eq('activa', true).order('nombre'),
  ])

  return (
    <div className="h-full flex flex-col">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Cuenta Corriente</h1>
        <p className="text-slate-500 text-sm mt-1">Seguimiento de cuotas y registro de pagos</p>
      </div>
      <div className="flex-1 min-h-0">
        <CuentaCorriente
          contratos={contratos ?? []}
          cuentasPropias={cuentasPropias ?? []}
          initialContratoId={initialContratoId}
        />
      </div>
    </div>
  )
}
