import { redirect } from 'next/navigation'
import { createAdminClient, listarTodosLosUsuarios } from '@/lib/supabase/admin'
import { getConstructoraContext } from '@/lib/tenant'
import UsuariosManager from '@/components/admin/UsuariosManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Usuarios' }
export const dynamic = 'force-dynamic'

export default async function UsuariosPage() {
  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')
  if (ctx.perfilRol !== 'admin') redirect('/admin')

  const adminClient = createAdminClient()

  // Todos los perfiles que pertenecen a esta constructora, en paralelo con
  // obras/perfil_proyectos/listado de usuarios de auth (antes eran 3 awaits
  // en cascada más una llamada a listUsers() sin paginar).
  const [authUsers, { data: perfiles }, { data: obras }, { data: perfilProyectos }] = await Promise.all([
    listarTodosLosUsuarios(adminClient),
    adminClient
      .from('perfiles')
      .select('id, nombre, rol, activo, permisos, constructora_id, created_at')
      .eq('constructora_id', ctx.constructoraId)
      .order('created_at', { ascending: true }),
    adminClient
      .from('obras')
      .select('id, nombre, tipo')
      .eq('constructora_id', ctx.constructoraId)
      .order('nombre', { ascending: true }),
    adminClient
      .from('perfil_proyectos')
      .select('perfil_id, obra_id, permisos')
      .eq('constructora_id', ctx.constructoraId),
  ])

  const perfilesConEmail = (perfiles ?? []).map(p => ({
    ...p,
    email: authUsers.find(u => u.id === p.id)?.email ?? '',
    proyectos: (perfilProyectos ?? [])
      .filter(pp => pp.perfil_id === p.id)
      .map(pp => ({ obraId: pp.obra_id, permisos: pp.permisos ?? [] })),
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
        currentUserId={ctx.userId}
        constructoraId={ctx.constructoraId}
      />
    </div>
  )
}
