import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProyectoContext } from '@/lib/tenant'
import GastosManager from '@/components/admin/GastosManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Gastos' }
export const dynamic = 'force-dynamic'

export default async function GastosProyectoPage({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params
  const ctx = await getProyectoContext(obraId)
  if (!ctx) redirect('/admin')

  const supabase = await createClient()

  const [{ data: gastos }, { data: proveedores }, { data: categorias }, { data: cuentasPropias }] =
    await Promise.all([
      supabase
        .from('gastos')
        .select('*, proveedores(*), cuentas_proveedor(*), categorias_costo(*), cuentas_propias(*)')
        .eq('constructora_id', ctx.constructoraId)
        .eq('obra_id', obraId)
        .order('fecha_vencimiento', { ascending: true }),
      supabase
        .from('proveedores')
        .select('*, cuentas_proveedor(*)')
        .eq('constructora_id', ctx.constructoraId)
        .order('razon_social'),
      supabase
        .from('categorias_costo')
        .select('*')
        .eq('constructora_id', ctx.constructoraId)
        .order('nombre'),
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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Gastos</h1>
        <p className="text-slate-500 text-sm mt-1">Egresos imputados a este proyecto</p>
      </div>
      <GastosManager
        gastos={gastos ?? []}
        proveedores={proveedores ?? []}
        categorias={categorias ?? []}
        cuentasPropias={cuentasPropias ?? []}
        constructoraId={ctx.constructoraId}
        obraId={obraId}
        readOnly={ctx.obraEstado === 'finalizada'}
      />
    </div>
  )
}
