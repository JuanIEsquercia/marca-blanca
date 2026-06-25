import { createClient } from '@/lib/supabase/server'
import GastosManager from '@/components/admin/GastosManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Gastos' }
export const dynamic = 'force-dynamic'

export default async function GastosPage() {
  const supabase = await createClient()

  const [{ data: gastos }, { data: proveedores }, { data: categorias }, { data: cuentasPropias }] =
    await Promise.all([
      supabase
        .from('gastos')
        .select('*, proveedores(*), cuentas_proveedor(*), categorias_costo(*), cuentas_propias(*)')
        .order('fecha_vencimiento', { ascending: true }),
      supabase.from('proveedores').select('*, cuentas_proveedor(*)').order('razon_social'),
      supabase.from('categorias_costo').select('*').order('nombre'),
      supabase.from('cuentas_propias').select('*').eq('activa', true).order('nombre'),
    ])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Gastos</h1>
        <p className="text-slate-500 text-sm mt-1">Registro de egresos y compromisos de pago</p>
      </div>
      <GastosManager
        gastos={gastos ?? []}
        proveedores={proveedores ?? []}
        categorias={categorias ?? []}
        cuentasPropias={cuentasPropias ?? []}
      />
    </div>
  )
}
