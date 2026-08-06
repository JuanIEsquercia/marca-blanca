import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import { puedeAcceder } from '@/lib/permisos'
import CompradoresManager from '@/components/admin/CompradoresManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Clientes' }
export const dynamic = 'force-dynamic'

export default async function ClientesPage() {
  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')

  const supabase = await createClient()

  const { data: compradores } = await supabase
    .from('compradores')
    .select('*')
    .eq('constructora_id', ctx.constructoraId)
    .order('nombre_completo')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Clientes</h1>
        <p className="text-slate-500 text-sm mt-1">Compradores de unidades y clientes de obra — datos compartidos con Presupuestos, Contratos, Reservas y Ventas</p>
      </div>
      <CompradoresManager
        compradores={compradores ?? []}
        constructoraId={ctx.constructoraId}
        readOnly={!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'clientes', null)}
      />
    </div>
  )
}
