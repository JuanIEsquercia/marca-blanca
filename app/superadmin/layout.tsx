import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LogoutButton from './LogoutButton'

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL
  if (!SUPERADMIN_EMAIL || user.email !== SUPERADMIN_EMAIL) {
    redirect('/admin')
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16" />
            </svg>
          </div>
          <span className="text-white font-semibold text-sm">Panel de Administración</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-500 text-xs">{user.email}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="max-w-4xl mx-auto p-6">
        {children}
      </main>
    </div>
  )
}
