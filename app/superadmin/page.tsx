import { createAdminClient } from '@/lib/supabase/admin'
import ConstructorasManager from './ConstructorasManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Panel de Administración' }
export const dynamic = 'force-dynamic'

export default async function SuperAdminPage() {
  const adminClient = createAdminClient()

  const [
    { data: constructoras },
    { data: perfiles },
    { data: authData },
  ] = await Promise.all([
    adminClient.from('constructoras').select('id, nombre, owner_id, created_at').order('created_at', { ascending: false }),
    adminClient.from('perfiles').select('id, nombre, rol, constructora_id').not('constructora_id', 'is', null),
    adminClient.auth.admin.listUsers(),
  ])

  const data = (constructoras ?? []).map(c => {
    const perfilesDeEsta = (perfiles ?? []).filter(p => p.constructora_id === c.id)
    const usuarios = perfilesDeEsta.map(p => {
      const authUser = authData?.users?.find(u => u.id === p.id)
      return { id: p.id, nombre: p.nombre, email: authUser?.email ?? null, rol: p.rol }
    })
    return { id: c.id, nombre: c.nombre, createdAt: c.created_at, usuarios }
  })

  return <ConstructorasManager initialData={data} />
}
