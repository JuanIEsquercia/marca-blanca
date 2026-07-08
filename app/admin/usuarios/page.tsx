import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getConstructoraContext } from '@/lib/tenant'
import UsuariosManager from '@/components/admin/UsuariosManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Usuarios' }
export const dynamic = 'force-dynamic'

export default async function UsuariosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const adminClient = createAdminClient()

  const { data: miPerfil } = await adminClient
    .from('perfiles')
    .select('rol')
    .eq('id', user.id)
    .single()

  if (miPerfil?.rol !== 'admin') redirect('/admin')

  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/admin')

  const { data: authUsers } = await adminClient.auth.admin.listUsers()

  // Todos los perfiles que pertenecen a esta constructora
  const [{ data: perfiles }, { data: obras }] = await Promise.all([
    adminClient
      .from('perfiles')
      .select('id, nombre, rol, activo, permisos, constructora_id, obra_id, created_at')
      .eq('constructora_id', ctx.constructoraId)
      .order('created_at', { ascending: true }),
    adminClient
      .from('obras')
      .select('id, nombre, tipo')
      .eq('constructora_id', ctx.constructoraId)
      .order('nombre', { ascending: true }),
  ])

  const perfilesConEmail = (perfiles ?? []).map(p => ({
    ...p,
    email: authUsers?.users.find(u => u.id === p.id)?.email ?? '',
  }))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Usuarios</h1>
        <p className="text-slate-500 text-sm mt-1">
          Creá operadores, asignalos a un proyecto y controlá a qué módulos puede acceder cada uno
        </p>
      </div>
      <UsuariosManager
        perfiles={perfilesConEmail}
        obras={obras ?? []}
        currentUserId={user.id}
        constructoraId={ctx.constructoraId}
      />
    </div>
  )
}
