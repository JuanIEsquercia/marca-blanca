import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProyectoContext } from '@/lib/tenant'
import { puedeAcceder } from '@/lib/permisos'
import InventoryGrid from '@/components/admin/InventoryGrid'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Unidades' }
export const dynamic = 'force-dynamic'

export default async function UnidadesPage({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params
  const ctx = await getProyectoContext(obraId)
  if (!ctx) redirect('/admin')

  const supabase = await createClient()

  const [{ data: unidades }, { data: tipologias }, { data: compradores }] = await Promise.all([
    supabase
      .from('unidades')
      .select('*, tipologias(*), reservas(*, compradores(*))')
      .eq('obra_id', obraId)
      .order('piso')
      .order('numero'),
    supabase
      .from('tipologias')
      .select('*')
      .eq('obra_id', obraId)
      .order('nombre'),
    supabase.from('compradores').select('*').eq('constructora_id', ctx.constructoraId).order('nombre_completo'),
  ])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Unidades</h1>
        <p className="text-slate-500 text-sm mt-1">Gestioná el stock, precios y estados de todas las unidades</p>
      </div>
      <InventoryGrid
        unidades={unidades ?? []}
        tipologias={tipologias ?? []}
        obraId={obraId}
        constructoraId={ctx.constructoraId}
        readOnly={ctx.obraEstado === 'finalizada'}
        puedeCrearCuenta={puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'cuentas', obraId)}
        compradores={compradores ?? []}
      />
    </div>
  )
}
