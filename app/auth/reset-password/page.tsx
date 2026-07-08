import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ResetPasswordForm from './ResetPasswordForm'

export const dynamic = 'force-dynamic'

export default async function ResetPasswordPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Sin sesión activa no hay nada que actualizar — el link de recuperación
  // establece la sesión en app/auth/callback/route.ts antes de llegar acá.
  if (!user) redirect('/auth/login')

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Elegí tu nueva contraseña</h1>
          <p className="text-slate-400 text-sm mt-1">{user.email}</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
          <ResetPasswordForm />
        </div>
      </div>
    </div>
  )
}
