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
    { data: contratos },
    { data: certificados },
  ] = await Promise.all([
    supabase
      .from('cobros_proyecto')
      .select('*, certificados_avance(numero, periodo), cuentas_propias(id, nombre, moneda), cobro_pagos(*, cuentas_propias(id, nombre, moneda))')
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
    // migration_048: una obra puede tener más de un contrato con el
    // cliente (etapas firmadas por separado) — los cobros (a diferencia
    // de los pagos a subcontratistas) son siempre de UN contrato cliente,
    // que hay que elegir si hay más de uno.
    supabase
      .from('contratos_obra')
      .select('id, moneda, descripcion, fecha_inicio, compradores(nombre_completo)')
      .eq('obra_id', obraId)
      .eq('tipo', 'cliente')
      .order('fecha_inicio', { ascending: true, nullsFirst: false }),
    supabase
      .from('certificados_avance')
      .select('id, numero, periodo, monto_certificado, contrato_obra_id, contratos_obra!inner(tipo)')
      .eq('obra_id', obraId)
      .eq('contratos_obra.tipo', 'cliente')
      .order('numero'),
  ])

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
        contratos={(contratos ?? []) as any}
        obraId={obraId}
        constructoraId={ctx.constructoraId}
        readOnly={ctx.obraEstado === 'finalizada'}
      />
    </div>
  )
}
