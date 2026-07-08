'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { sanitizarRedirect, crearRateLimiter, getOrigin } from '@/lib/auth-helpers'

interface LoginState {
  error: string | null
}

interface SolicitarResetState {
  error: string | null
  enviado: boolean
}

interface ActualizarPasswordState {
  error: string | null
}

const loginLimiter = crearRateLimiter(5, 15 * 60 * 1000)
const resetLimiter = crearRateLimiter(3, 15 * 60 * 1000)

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const redirectTo = sanitizarRedirect(formData.get('redirectTo') as string | null)

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { error: 'Error de configuración: variables de entorno de Supabase no están definidas en el servidor.' }
  }

  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rateLimitKey = `${ip}:${email.toLowerCase()}`

  if (!loginLimiter.chequear(rateLimitKey)) {
    return { error: 'Demasiados intentos fallidos. Esperá 15 minutos e intentá de nuevo.' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      return { error: 'Credenciales incorrectas. Verificá tu email y contraseña.' }
    }
  } catch {
    return { error: 'No se pudo conectar con el servidor. Verificá tu conexión a internet.' }
  }

  loginLimiter.limpiar(rateLimitKey)
  redirect(redirectTo)
}

// Envía el email de recuperación de contraseña. Siempre devuelve el mismo
// mensaje de éxito exista o no esa cuenta — evita que alguien use este
// formulario para averiguar qué emails están registrados.
export async function solicitarResetAction(
  _prevState: SolicitarResetState,
  formData: FormData
): Promise<SolicitarResetState> {
  const email = (formData.get('email') as string)?.trim().toLowerCase()

  if (!email) {
    return { error: 'Ingresá tu email.', enviado: false }
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { error: 'Error de configuración: variables de entorno de Supabase no están definidas en el servidor.', enviado: false }
  }

  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rateLimitKey = `${ip}:${email}`

  if (!resetLimiter.chequear(rateLimitKey)) {
    return { error: 'Demasiadas solicitudes. Esperá 15 minutos e intentá de nuevo.', enviado: false }
  }

  try {
    const supabase = await createClient()
    const origin = await getOrigin()
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/auth/reset-password`,
    })
  } catch {
    return { error: 'No se pudo conectar con el servidor. Verificá tu conexión a internet.', enviado: false }
  }

  return { error: null, enviado: true }
}

// Setea la nueva contraseña. Requiere una sesión activa — se establece al
// hacer click en el link del email (ver app/auth/callback/route.ts), que
// intercambia el código de recuperación por una sesión antes de llegar acá.
export async function actualizarPasswordAction(
  _prevState: ActualizarPasswordState,
  formData: FormData
): Promise<ActualizarPasswordState> {
  const password = formData.get('password') as string
  const confirmacion = formData.get('confirmacion') as string

  if (!password || password.length < 8) {
    return { error: 'La contraseña debe tener al menos 8 caracteres.' }
  }
  if (password !== confirmacion) {
    return { error: 'Las contraseñas no coinciden.' }
  }

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'El link de recuperación expiró o ya fue usado. Solicitá uno nuevo.' }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    return { error: 'No se pudo actualizar la contraseña. Intentá de nuevo.' }
  }

  redirect('/admin')
}
