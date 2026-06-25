import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/admin/AdminSidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const today = new Date().toISOString().split('T')[0]

  const [perfilRes, vencidasRes] = await Promise.all([
    supabase
      .from('perfiles')
      .select('nombre, rol')
      .eq('id', user.id)
      .single(),
    supabase
      .from('cuotas')
      .select('*', { count: 'exact', head: true })
      .eq('estado_pago', 'Pendiente')
      .lt('fecha_vencimiento', today),
  ])

  const perfil = perfilRes.data
  const cuotasVencidasCount = vencidasRes.count ?? 0

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden admin-typography-system">
      <AdminSidebar
        userName={perfil?.nombre ?? user.email ?? 'Usuario'}
        userRole={perfil?.rol ?? 'operador'}
        cuotasVencidasCount={cuotasVencidasCount}
      />
      <main className="flex-1 overflow-auto admin-scroll">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
