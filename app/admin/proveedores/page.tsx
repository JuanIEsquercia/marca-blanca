import { createClient } from '@/lib/supabase/server'
import ProveedoresManager from '@/components/admin/ProveedoresManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Proveedores' }
export const dynamic = 'force-dynamic'

export default async function ProveedoresPage() {
  const supabase = await createClient()

  const { data: proveedores } = await supabase
    .from('proveedores')
    .select('*, cuentas_proveedor(*)')
    .order('razon_social')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Proveedores</h1>
        <p className="text-slate-500 text-sm mt-1">Gestión de proveedores y sus cuentas de cobro</p>
      </div>
      <ProveedoresManager proveedores={proveedores ?? []} />
    </div>
  )
}
