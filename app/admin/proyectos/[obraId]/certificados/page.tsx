import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProyectoContext } from '@/lib/tenant'
import CertificadosManager from '@/components/admin/CertificadosManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Certificados de avance' }
export const dynamic = 'force-dynamic'

export default async function CertificadosPage({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params
  const ctx = await getProyectoContext(obraId)
  if (!ctx) redirect('/admin')

  const supabase = await createClient()

  const [
    { data: contratos },
    { data: certificados },
    { data: cuentasPropias },
  ] = await Promise.all([
    supabase
      .from('contratos_obra')
      .select('*, compradores(*)')
      .eq('obra_id', obraId)
      .order('created_at', { ascending: true })
      .limit(1),
    supabase
      .from('certificados_avance')
      .select('*, cobros_proyecto(*), certificado_items(*)')
      .eq('obra_id', obraId)
      .order('numero', { ascending: true }),
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
  ])

  const contrato = contratos?.[0] ?? null

  const { data: contratoObraItems } = contrato
    ? await supabase.from('contrato_obra_items').select('*').eq('contrato_obra_id', contrato.id).order('orden')
    : { data: [] }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Certificados de avance</h1>
        <p className="text-slate-500 text-sm mt-1">
          {ctx.obraNombre} — documentación de avance y cobros al cliente
        </p>
      </div>
      <CertificadosManager
        contrato={contrato ?? null}
        certificados={(certificados ?? []) as any}
        contratoObraItems={contratoObraItems ?? []}
        cuentasPropias={cuentasPropias ?? []}
        constructoraId={ctx.constructoraId}
        obraId={obraId}
        readOnly={ctx.obraEstado === 'finalizada'}
      />
    </div>
  )
}
