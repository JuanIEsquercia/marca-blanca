import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import WhatsappManager from '@/components/admin/WhatsappManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'WhatsApp' }
export const dynamic = 'force-dynamic'

export default async function WhatsappPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const adminClient = createAdminClient()
  const { data: perfil } = await adminClient
    .from('perfiles')
    .select('rol, telefono, constructora_id')
    .eq('id', user.id)
    .single()

  if (perfil?.rol !== 'admin') redirect('/admin')

  const { data: numero } = await adminClient
    .from('whatsapp_numeros')
    .select('kapso_phone_id, numero')
    .eq('constructora_id', perfil.constructora_id)
    .eq('activo', true)
    .maybeSingle()

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">WhatsApp</h1>
        <p className="text-slate-500 text-sm mt-1">
          Vinculá un teléfono para hacer consultas del ERP directamente por WhatsApp
        </p>
      </div>
      <WhatsappManager
        telefonoInicial={perfil?.telefono ?? null}
        kapsoPhoneIdInicial={numero?.kapso_phone_id ?? null}
        numeroWhatsappInicial={numero?.numero ?? null}
      />
    </div>
  )
}
