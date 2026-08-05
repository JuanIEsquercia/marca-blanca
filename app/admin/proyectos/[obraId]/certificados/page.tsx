import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProyectoContext } from '@/lib/tenant'
import { puedeAcceder } from '@/lib/permisos'
import { obtenerRubros } from '@/lib/rubros'
import CertificadosManager from '@/components/admin/CertificadosManager'
import type { Metadata } from 'next'
import type { Gasto } from '@/types/database'

export const metadata: Metadata = { title: 'Contratos' }
export const dynamic = 'force-dynamic'

export default async function CertificadosPage({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params
  const ctx = await getProyectoContext(obraId)
  if (!ctx) redirect('/admin')

  const supabase = await createClient()

  const [
    { data: contratos },
    { data: certificados },
    { data: pagosSubcontratista },
    { data: proveedores },
    { data: cuentasPropias },
    rubros,
  ] = await Promise.all([
    // migration_047: una obra puede tener más de un contrato — ya no
    // se recorta con .limit(1).
    supabase
      .from('contratos_obra')
      .select('*, compradores(*), proveedores(*)')
      .eq('obra_id', obraId)
      .order('created_at', { ascending: true }),
    supabase
      .from('certificados_avance')
      // cobro_pagos anidado: sin esto, esta vista no puede saber si un cobro
      // ya tiene un plan de pago activo y permitía forzarlo a "Cobrado" con
      // las cuotas reales todavía pendientes (ver ContratoObraCard).
      .select('*, cobros_proyecto(*, cobro_pagos(*)), certificado_items(*)')
      .eq('obra_id', obraId)
      .order('numero', { ascending: true }),
    // Pagos a subcontratistas (gastos originados en un certificado) — se
    // trae aparte, no como join anidado, porque gastos tiene varias FK
    // (proveedor/categoria/cuenta) y el embed de PostgREST quedaría
    // ambiguo sin especificar cuál. Se pega a cada certificado abajo.
    supabase
      .from('gastos')
      .select('*, gasto_pagos(*)')
      .eq('obra_id', obraId)
      .not('certificado_id', 'is', null),
    supabase
      .from('proveedores')
      .select('*')
      .eq('constructora_id', ctx.constructoraId)
      .eq('activo', true)
      .order('razon_social'),
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
    obtenerRubros(supabase, ctx.constructoraId),
  ])

  const contratoIds = (contratos ?? []).map(c => c.id)
  const { data: contratoObraItems } = contratoIds.length > 0
    ? await supabase.from('contrato_obra_items').select('*').in('contrato_obra_id', contratoIds).order('orden')
    : { data: [] }

  const pagosPorCertificado = new Map<string, Gasto[]>()
  for (const g of (pagosSubcontratista ?? []) as Gasto[]) {
    if (!g.certificado_id) continue
    const lista = pagosPorCertificado.get(g.certificado_id) ?? []
    lista.push(g)
    pagosPorCertificado.set(g.certificado_id, lista)
  }
  const certificadosConPagos = (certificados ?? []).map(c => ({
    ...c,
    pagos: pagosPorCertificado.get(c.id) ?? [],
  }))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Contratos</h1>
        <p className="text-slate-500 text-sm mt-1">
          {ctx.obraNombre} — contratos, certificados de avance, cobros y pagos a subcontratistas
        </p>
      </div>
      <CertificadosManager
        contratos={contratos ?? []}
        certificados={certificadosConPagos as any}
        contratoObraItems={contratoObraItems ?? []}
        proveedores={proveedores ?? []}
        cuentasPropias={cuentasPropias ?? []}
        constructoraId={ctx.constructoraId}
        obraId={obraId}
        readOnly={ctx.obraEstado === 'finalizada'}
        rubros={rubros}
        puedeCrearProveedor={puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'proveedores', null)}
        puedeCrearCuenta={puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'cuentas', obraId)}
      />
    </div>
  )
}
