import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import InventarioManager from '@/components/admin/InventarioManager'
import type { Metadata } from 'next'
import type { Equipo } from '@/types/database'

export const metadata: Metadata = { title: 'Inventario' }
export const dynamic = 'force-dynamic'

export default async function InventarioPage() {
  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')

  const supabase = await createClient()

  const [{ data: equipos }, { data: obras }] = await Promise.all([
    supabase
      .from('equipos')
      .select('*, equipo_asignaciones(*)')
      .eq('constructora_id', ctx.constructoraId)
      .order('nombre'),
    supabase
      .from('obras')
      .select('id, nombre')
      .eq('constructora_id', ctx.constructoraId)
      .eq('estado', 'activa')
      .order('nombre'),
  ])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Inventario</h1>
        <p className="text-slate-500 text-sm mt-1">
          Maquinaria y equipos — asigná cada uno a un proyecto y llevá el rastreo de dónde estuvo
        </p>
      </div>
      <InventarioManager
        equipos={(equipos ?? []) as unknown as Equipo[]}
        obras={obras ?? []}
        constructoraId={ctx.constructoraId}
      />
    </div>
  )
}
