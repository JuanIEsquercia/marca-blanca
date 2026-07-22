import { redirect } from 'next/navigation'
import { getConstructoraContext } from '@/lib/tenant'
import NuevoPresupuestoForm from '@/components/admin/NuevoPresupuestoForm'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Nuevo presupuesto' }
export const dynamic = 'force-dynamic'

export default async function NuevoPresupuestoPage() {
  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Nuevo presupuesto</h1>
        <p className="text-slate-500 text-sm mt-1">Cargá el cliente y todos los ítems del trabajo cotizado</p>
      </div>
      <NuevoPresupuestoForm constructoraId={ctx.constructoraId} />
    </div>
  )
}
