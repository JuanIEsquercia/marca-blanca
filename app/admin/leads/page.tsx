import { createClient } from '@/lib/supabase/server'
import LeadsManager from '@/components/admin/LeadsManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Leads / CRM' }
export const dynamic = 'force-dynamic'

export default async function LeadsPage() {
  const supabase = await createClient()

  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Leads / CRM</h1>
        <p className="text-slate-500 text-sm mt-1">
          Seguimiento de contactos hasta la conversión en reserva o venta
        </p>
      </div>
      <LeadsManager leads={leads ?? []} />
    </div>
  )
}
