import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/admin/AdminSidebar'
import { MODULOS } from '@/lib/permisos'
import type { ModuloKey } from '@/lib/permisos'

const MODULO_KEYS = MODULOS.map(m => m.key)

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const perfilRes = await supabase
    .from('perfiles')
    .select('nombre, rol, permisos')
    .eq('id', user.id)
    .single()

  const perfil = perfilRes.data
  const rol = perfil?.rol ?? 'operador'
  const permisos: string[] | null = perfil?.permisos ?? null

  // Route guard: si es operador con permisos explícitos, bloquear rutas no permitidas
  if (rol !== 'admin' && permisos !== null) {
    const headersList = await headers()
    const pathname = headersList.get('x-pathname') ?? ''
    const segmento = pathname.split('/')[2] as ModuloKey | undefined

    if (segmento && MODULO_KEYS.includes(segmento as ModuloKey) && !permisos.includes(segmento)) {
      redirect('/admin/dashboard')
    }
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden admin-typography-system">
      <AdminSidebar
        userName={perfil?.nombre ?? user.email ?? 'Usuario'}
        userRole={rol}
        userPermisos={permisos}
      />
      <main className="flex-1 overflow-auto admin-scroll">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
