import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProyectoContext } from '@/lib/tenant'
import CobrosObraManager from '@/components/admin/CobrosObraManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Cobros' }
export const dynamic = 'force-dynamic'

export default async function CobrosPage({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params
  const ctx = await getProyectoContext(obraId)
  if (!ctx) redirect('/admin')

  const supabase = await createClient()

  const [
    { data: cobros },
    { data: cuentasPropias },
    { data: contrato },
    { data: certificados },
  ] = await Promise.all([
    supabase
      .from('cobros_proyecto')
      .select('*, certificados_avance(numero, periodo), cuentas_propias(id, nombre, moneda)')
      .eq('obra_id', obraId)
      .order('fecha_vencimiento', { ascending: true, nullsFirst: false }),
    ctx.obraModo === 'especificas'
      ? supabase.from('cuentas_propias').select('*')
          .eq('constructora_id', ctx.constructoraId)
          .eq('obra_id', obraId)
          .eq('activa', true)
          .order('nombre')
      : supabase.from('cuentas_propias').select('*')
          .eq('constructora_id', ctx.constructoraId)
          .is('obra_id', null)
          .eq('activa', true)
          .order('nombre'),
    supabase
      .from('contratos_obra')
      .select('id, moneda')
      .eq('obra_id', obraId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('certificados_avance')
      .select('id, numero, periodo, monto_certificado')
      .eq('obra_id', obraId)
      .order('numero'),
  ])

  const moneda = contrato?.moneda ?? 'ARS'

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Cobros</h1>
        <p className="text-slate-500 text-sm mt-1">
          {ctx.obraNombre} — seguimiento de cobros pendientes y realizados
        </p>
      </div>
      <CobrosObraManager
        cobros={(cobros ?? []) as any}
        cuentasPropias={cuentasPropias ?? []}
        certificados={(certificados ?? []) as any}
        obraId={obraId}
        constructoraId={ctx.constructoraId}
        moneda={moneda}
        readOnly={ctx.obraEstado === 'finalizada'}
      />
    </div>
  )
}
