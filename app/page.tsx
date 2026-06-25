import { createClient } from '@/lib/supabase/server'
import Hero from '@/components/landing/Hero'
import AmenitiesSection from '@/components/landing/Amenities'
import StockCatalog from '@/components/landing/StockCatalog'
import Contacto from '@/components/landing/Contacto'
import Footer from '@/components/landing/Footer'

export const revalidate = 60

export default async function LandingPage() {
  const supabase = await createClient()

  const [{ data: unidades }, { data: amenities }] = await Promise.all([
    supabase
      .from('vista_stock_publico')
      .select('*')
      .order('piso', { ascending: true })
      .order('numero', { ascending: true }),
    supabase
      .from('amenities')
      .select('*, amenity_imagenes(*)')
      .eq('activo', true)
      .order('orden'),
  ])

  return (
    <main className="bg-slate-950">
      <Hero />
      <AmenitiesSection amenities={amenities ?? []} />
      <StockCatalog unidades={unidades ?? []} />
      <Contacto />
      <Footer />
    </main>
  )
}
