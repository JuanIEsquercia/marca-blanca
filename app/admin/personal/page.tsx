import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import PersonalManager from '@/components/admin/PersonalManager'
import type { Metadata } from 'next'
import type { Personal, Cuadrilla } from '@/types/database'

export const metadata: Metadata = { title: 'Personal' }
export const dynamic = 'force-dynamic'

export default async function PersonalPage() {
  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')

  const supabase = await createClient()

  const [{ data: personal }, { data: cuadrillas }, { data: obras }] = await Promise.all([
    supabase
      .from('personal')
      .select('*, personal_asignaciones(*)')
      .eq('constructora_id', ctx.constructoraId)
      .order('nombre'),
    supabase
      .from('cuadrillas')
      .select('*')
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
        <h1 className="text-2xl font-bold text-slate-900">Personal</h1>
        <p className="text-slate-500 text-sm mt-1">
          Trabajadores y cuadrillas — asigná a un proyecto y llevá el rastreo de dónde trabajó cada uno
        </p>
      </div>
      <PersonalManager
        personal={(personal ?? []) as unknown as Personal[]}
        cuadrillas={(cuadrillas ?? []) as unknown as Cuadrilla[]}
        obras={obras ?? []}
        constructoraId={ctx.constructoraId}
      />
    </div>
  )
}
