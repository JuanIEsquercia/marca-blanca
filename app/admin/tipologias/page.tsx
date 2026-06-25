import { createClient } from '@/lib/supabase/server'
import TipologiasManager from '@/components/admin/TipologiasManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Tipologías' }
export const dynamic = 'force-dynamic'

export default async function TipologiasPage() {
  const supabase = await createClient()
  const { data: tipologias } = await supabase
    .from('tipologias')
    .select('*')
    .order('nombre')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Tipologías</h1>
        <p className="text-slate-500 text-sm mt-1">
          Definí los tipos de unidades: m², descripción y recorrido virtual 360°
        </p>
      </div>
      <TipologiasManager tipologias={tipologias ?? []} />
    </div>
  )
}
