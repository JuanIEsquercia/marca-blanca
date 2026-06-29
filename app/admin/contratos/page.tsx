import { createClient } from '@/lib/supabase/server'
import ContratosManager from '@/components/admin/ContratosManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Contratos' }
export const dynamic = 'force-dynamic'

export default async function ContratosPage() {
  const supabase = await createClient()

  const [{ data: contratos }, { data: unidadesDisponibles }, { data: cuentasPropias }] = await Promise.all([
    supabase
      .from('contratos_venta')
      .select(`
        *,
        compradores(*),
        unidades(piso, numero, letra, tipologias(nombre)),
        cuotas(id, numero_cuota, monto_base, monto_cobrado, fecha_vencimiento, estado_pago, fecha_pago, cuenta_propia_id)
      `)
      .order('fecha_firma', { ascending: false }),
    supabase
      .from('unidades')
      .select('*, tipologias(*)')
      .eq('estado_comercial', 'Disponible')
      .order('piso')
      .order('numero'),
    supabase.from('cuentas_propias').select('*').eq('activa', true).order('nombre'),
  ])

  return (
    <ContratosManager
      contratos={contratos ?? []}
      unidadesDisponibles={unidadesDisponibles ?? []}
      cuentasPropias={cuentasPropias ?? []}
    />
  )
}
