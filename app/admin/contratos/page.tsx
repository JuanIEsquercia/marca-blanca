import { createClient } from '@/lib/supabase/server'
import ContratosManager from '@/components/admin/ContratosManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Contratos' }
export const dynamic = 'force-dynamic'

export default async function ContratosPage() {
  const supabase = await createClient()

  const [{ data: contratos }, { data: unidadesDisponibles }] = await Promise.all([
    supabase
      .from('contratos_venta')
      .select(`
        *,
        compradores(*),
        unidades(piso, numero, letra, tipologias(nombre)),
        cuotas(id, estado_pago, fecha_vencimiento)
      `)
      .order('fecha_firma', { ascending: false }),
    supabase
      .from('unidades')
      .select('*, tipologias(*)')
      .eq('estado_comercial', 'Disponible')
      .order('piso')
      .order('numero'),
  ])

  return (
    <ContratosManager
      contratos={contratos ?? []}
      unidadesDisponibles={unidadesDisponibles ?? []}
    />
  )
}
