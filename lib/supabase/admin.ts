import { createClient, type User } from '@supabase/supabase-js'

// Cliente con service_role — SOLO usar en Server Actions o Route Handlers.
// Nunca exponer al cliente/browser.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// adminClient.auth.admin.createUser() devuelve mensajes de error de Supabase
// Auth en inglés (ej. "User already registered") en una UI que es toda en
// español — esto los traduce a algo que un admin no técnico entienda. Match
// por substring (case-insensitive) porque el texto exacto varía entre
// versiones de GoTrue; si no matchea nada conocido, se muestra el original.
export function traducirErrorAuth(mensaje: string): string {
  const m = mensaje.toLowerCase()
  if (m.includes('already registered') || m.includes('already exists')) {
    return 'Ya existe un usuario con ese email.'
  }
  if (m.includes('password') && (m.includes('at least') || m.includes('short') || m.includes('length'))) {
    return 'La contraseña es demasiado corta.'
  }
  if (m.includes('invalid') && m.includes('email')) {
    return 'El email no tiene un formato válido.'
  }
  if (m.includes('rate limit')) {
    return 'Se hicieron demasiados intentos. Esperá unos minutos y volvé a intentar.'
  }
  if (m.includes('signup') && m.includes('disabled')) {
    return 'La creación de usuarios está deshabilitada en este momento.'
  }
  return mensaje
}

// adminClient.auth.admin.listUsers() sin paginar solo devuelve los primeros
// 50 usuarios de TODA la plataforma (default de perPage) — cruzar
// email-por-perfil contra ese resultado falla en silencio para cualquier
// usuario "de más" a medida que crece la cantidad de constructoras/usuarios.
// Esto pagina hasta agotar la lista completa.
export async function listarTodosLosUsuarios(adminClient: ReturnType<typeof createAdminClient>): Promise<User[]> {
  const usuarios: User[] = []
  const perPage = 1000
  for (let page = 1; ; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage })
    if (error || !data || data.users.length === 0) break
    usuarios.push(...data.users)
    if (data.users.length < perPage) break
  }
  return usuarios
}
