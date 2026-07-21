import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProyectoContext } from '@/lib/tenant'
import AmenitiesManager from '@/components/admin/AmenitiesManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Amenities' }
export const dynamic = 'force-dynamic'

export default async function AmenitiesPage({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params
  const ctx = await getProyectoContext(obraId)
  if (!ctx) redirect('/admin')

  const supabase = await createClient()
  const { data: amenities } = await supabase
    .from('amenities')
    .select('*, amenity_imagenes(*)')
    .eq('obra_id', obraId)
    .order('orden')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Amenities</h1>
        <p className="text-slate-500 text-sm mt-1">Servicios del proyecto con íconos e imágenes</p>
      </div>
      <AmenitiesManager
        amenities={amenities ?? []}
        obraId={obraId}
        constructoraId={ctx.constructoraId}
        readOnly={ctx.obraEstado === 'finalizada'}
      />
    </div>
  )
}
