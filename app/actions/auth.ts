'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

interface LoginState {
  error: string | null
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const redirectTo = (formData.get('redirectTo') as string | null) || '/admin'

  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      return { error: 'Credenciales incorrectas. Verificá tu email y contraseña.' }
    }
  } catch {
    return { error: 'No se pudo conectar con el servidor. Verificá tu conexión a internet.' }
  }

  redirect(redirectTo)
}
