import { createClient } from '@/lib/supabase/server'
import AmenitiesManager from '@/components/admin/AmenitiesManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Amenities' }
export const dynamic = 'force-dynamic'

export default async function AmenitiesPage() {
  const supabase = await createClient()
  const { data: amenities } = await supabase
    .from('amenities')
    .select('*, amenity_imagenes(*)')
    .order('orden')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Amenities</h1>
        <p className="text-slate-500 text-sm mt-1">
          Cargá los servicios del edificio con íconos e imágenes para mostrar en la landing
        </p>
      </div>
      <AmenitiesManager amenities={amenities ?? []} />
    </div>
  )
}
