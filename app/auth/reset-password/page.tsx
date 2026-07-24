import { redirect } from 'next/navigation'
import Image from 'next/image'
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
          <Image src="/logo.png" alt="" width={56} height={56} className="mx-auto mb-4 rounded-2xl" />
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
