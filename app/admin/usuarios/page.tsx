import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import UsuariosManager from '@/components/admin/UsuariosManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Usuarios' }
export const dynamic = 'force-dynamic'

export default async function UsuariosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: miPerfil } = await supabase
    .from('perfiles')
    .select('rol')
    .eq('id', user.id)
    .single()

  if (miPerfil?.rol !== 'admin') redirect('/admin/dashboard')

  // Obtener todos los perfiles + emails via admin client
  const adminClient = createAdminClient()
  const { data: authUsers } = await adminClient.auth.admin.listUsers()

  const { data: perfiles } = await supabase
    .from('perfiles')
    .select('*')
    .order('created_at', { ascending: true })

  const perfilesConEmail = (perfiles ?? []).map(p => ({
    ...p,
    email: authUsers?.users.find(u => u.id === p.id)?.email ?? '',
  }))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Gestión de Usuarios</h1>
        <p className="text-slate-500 text-sm mt-1">
          Creá y administrá los usuarios que pueden acceder al panel
        </p>
      </div>

      <UsuariosManager perfiles={perfilesConEmail} currentUserId={user.id} />
    </div>
  )
}
