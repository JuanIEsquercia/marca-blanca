import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import { obtenerIngresos } from '@/lib/ingresos'
import IngresosManager from '@/components/admin/IngresosManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Ingresos' }
export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ historial?: string }>
}

export default async function IngresosPage({ searchParams }: Props) {
  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')

  const supabase = await createClient()
  const verHistorialCompleto = (await searchParams).historial === 'todo'
  const ingresos = await obtenerIngresos(supabase, ctx.constructoraId, !verHistorialCompleto)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Ingresos</h1>
        <p className="text-slate-500 text-sm mt-1">
          Lo que los clientes deben y ya pagaron — cuotas de venta y cobros de obra, todos los proyectos
        </p>
      </div>
      <IngresosManager ingresos={ingresos} historialAcotado={!verHistorialCompleto} />
    </div>
  )
}
