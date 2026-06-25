import { createClient } from '@/lib/supabase/server'
import InventoryGrid from '@/components/admin/InventoryGrid'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Inventario' }
export const dynamic = 'force-dynamic'

export default async function InventarioPage() {
  const supabase = await createClient()

  const [{ data: unidades }, { data: tipologias }] = await Promise.all([
    supabase
      .from('unidades')
      .select('*, tipologias(*), reservas(*, compradores(*))')
      .order('piso')
      .order('numero'),
    supabase.from('tipologias').select('*').order('nombre'),
  ])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Inventario</h1>
        <p className="text-slate-500 text-sm mt-1">
          Gestioná el stock, precios y estados de todas las unidades
        </p>
      </div>
      <InventoryGrid unidades={unidades ?? []} tipologias={tipologias ?? []} />
    </div>
  )
}
