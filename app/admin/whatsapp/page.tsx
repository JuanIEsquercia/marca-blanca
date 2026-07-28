import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getConstructoraContext } from '@/lib/tenant'
import WhatsappManager from '@/components/admin/WhatsappManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'WhatsApp' }
export const dynamic = 'force-dynamic'

export default async function WhatsappPage() {
  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')
  if (ctx.perfilRol !== 'admin') redirect('/admin')

  const adminClient = createAdminClient()

  // El teléfono vinculado puede ser el propio o el de OTRO admin de la misma
  // constructora — se busca por constructora, no por el propio user.id, para
  // poder mostrarlo/desvincularlo aunque lo haya vinculado un compañero.
  const [{ data: vinculado }, { data: numero }] = await Promise.all([
    adminClient.from('perfiles').select('id, nombre, telefono').eq('constructora_id', ctx.constructoraId).eq('rol', 'admin').not('telefono', 'is', null).maybeSingle(),
    adminClient.from('whatsapp_numeros').select('kapso_phone_id, numero').eq('constructora_id', ctx.constructoraId).eq('activo', true).maybeSingle(),
  ])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">WhatsApp</h1>
        <p className="text-slate-500 text-sm mt-1">
          Vinculá un teléfono para hacer consultas del ERP directamente por WhatsApp
        </p>
      </div>
      <WhatsappManager
        telefonoInicial={vinculado?.telefono ?? null}
        vinculadoNombre={vinculado ? (vinculado.id === ctx.userId ? null : vinculado.nombre) : null}
        kapsoPhoneIdInicial={numero?.kapso_phone_id ?? null}
        numeroWhatsappInicial={numero?.numero ?? null}
      />
    </div>
  )
}
