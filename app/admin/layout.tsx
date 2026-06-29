import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/admin/AdminSidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const perfilRes = await supabase
    .from('perfiles')
    .select('nombre, rol')
    .eq('id', user.id)
    .single()

  const perfil = perfilRes.data

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden admin-typography-system">
      <AdminSidebar
        userName={perfil?.nombre ?? user.email ?? 'Usuario'}
        userRole={perfil?.rol ?? 'operador'}
      />
      <main className="flex-1 overflow-auto admin-scroll">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
