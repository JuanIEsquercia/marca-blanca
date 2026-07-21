import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import PresupuestosManager from '@/components/admin/PresupuestosManager'
import type { Metadata } from 'next'
import type { Presupuesto } from '@/types/database'

export const metadata: Metadata = { title: 'Presupuestos' }
export const dynamic = 'force-dynamic'

export default async function PresupuestosPage() {
  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')

  const supabase = await createClient()

  const [{ data: presupuestos }, { data: obras }, { data: contratosExistentes }] = await Promise.all([
    supabase
      .from('presupuestos')
      .select('*, presupuesto_items(*), obras(id, nombre)')
      .eq('constructora_id', ctx.constructoraId)
      .order('created_at', { ascending: false }),
    supabase
      .from('obras')
      .select('id, nombre')
      .eq('constructora_id', ctx.constructoraId)
      .eq('tipo', 'obra')
      .order('nombre'),
    supabase
      .from('contratos_obra')
      .select('obra_id')
      .eq('constructora_id', ctx.constructoraId),
  ])

  // Solo se puede vincular un presupuesto aceptado a un proyecto tipo Obra
  // que todavía no tenga contrato cargado (mismo chequeo que hace
  // aceptar_presupuesto() en la base, acá es solo para no ofrecerlo en el
  // selector).
  const obrasConContrato = new Set((contratosExistentes ?? []).map(c => c.obra_id))
  const obrasDisponibles = (obras ?? []).filter(o => !obrasConContrato.has(o.id))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Presupuestos</h1>
        <p className="text-slate-500 text-sm mt-1">
          Cotizá un trabajo por ítems — si se acepta, se convierte en el contrato de un proyecto nuevo o existente
        </p>
      </div>
      <PresupuestosManager
        presupuestos={(presupuestos ?? []) as unknown as Presupuesto[]}
        obrasDisponibles={obrasDisponibles}
        constructoraId={ctx.constructoraId}
      />
    </div>
  )
}
