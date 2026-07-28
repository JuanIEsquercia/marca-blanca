import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ProyectoAsignado } from '@/lib/permisos'

export interface ConstructoraContext {
  userId: string
  constructoraId: string
  constructoraNombre: string
  perfilNombre: string
  perfilRol: 'admin' | 'operador'
  perfilPermisos: string[]
  perfilProyectos: ProyectoAsignado[]
}

// Cacheado por request con React cache(): sin esto, cada layout/página que
// necesita el usuario autenticado dispara su propio round-trip a Supabase
// Auth. Con esto, todos los llamados dentro del mismo render comparten 1 sola
// llamada real a getUser().
export const getAuthUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

export interface ProyectoContext extends ConstructoraContext {
  obraId: string
  obraNombre: string
  obraTipo: 'desarrollo' | 'obra'
  obraModo: 'empresa' | 'especificas'
  obraEstado: 'activa' | 'pausada' | 'finalizada'
}

const resolveConstructora = cache(async (): Promise<ConstructoraContext | null> => {
  const user = await getAuthUser()
  if (!user) return null

  // Usar admin client para bypassear RLS en la resolución del tenant.
  // Seguridad: filtramos siempre por user.id del usuario autenticado.
  const admin = createAdminClient()

  // Una sola query a perfiles trae constructora_id + datos del perfil del usuario
  const { data: perfil } = await admin
    .from('perfiles')
    .select('constructora_id, nombre, rol, permisos')
    .eq('id', user.id)
    .maybeSingle()

  let constructoraId: string | null = (perfil as any)?.constructora_id ?? null

  // Fallback: miembros (compatible con cualquier estado de migración)
  if (!constructoraId) {
    const { data: miembro } = await admin
      .from('miembros')
      .select('constructora_id')
      .eq('user_id', user.id)
      .maybeSingle()
    constructoraId = miembro?.constructora_id ?? null
  }

  if (!constructoraId) return null

  // Nombre de la constructora + árbol de proyectos asignados (paralelo).
  const [{ data: constructora }, { data: proyectos }] = await Promise.all([
    admin.from('constructoras').select('id, nombre').eq('id', constructoraId).maybeSingle(),
    admin.from('perfil_proyectos').select('obra_id, permisos').eq('perfil_id', user.id),
  ])

  const rol = ((perfil as any)?.rol ?? 'operador') as 'admin' | 'operador'

  return {
    userId: user.id,
    constructoraId,
    constructoraNombre: constructora?.nombre ?? 'Constructora',
    perfilNombre: (perfil as any)?.nombre ?? '',
    perfilRol: rol,
    perfilPermisos: (perfil as any)?.permisos ?? [],
    perfilProyectos: (proyectos ?? []).map(p => ({ obraId: p.obra_id, permisos: p.permisos ?? [] })),
  }
})

export const getConstructoraContext = cache(async (): Promise<ConstructoraContext | null> => {
  return resolveConstructora()
})

export const getProyectoContext = cache(async (obraId: string): Promise<ProyectoContext | null> => {
  const resolved = await resolveConstructora()
  if (!resolved) return null

  // Enforcement central: un operador solo puede resolver el contexto de un
  // proyecto que tenga asignado en su árbol. Todas las páginas de proyecto
  // (dashboard, certificados, cobros, contratos, caja, etc.) redirigen a
  // /admin cuando este helper devuelve null, así que este único chequeo
  // las cubre a todas.
  if (resolved.perfilRol !== 'admin' && !resolved.perfilProyectos.some(p => p.obraId === obraId)) return null

  const admin = createAdminClient()
  const { data: obra } = await admin
    .from('obras')
    .select('id, nombre, tipo, estado, modo_cuentas')
    .eq('id', obraId)
    .eq('constructora_id', resolved.constructoraId)
    .maybeSingle()

  if (!obra) return null

  return {
    userId: resolved.userId,
    constructoraId: resolved.constructoraId,
    constructoraNombre: resolved.constructoraNombre,
    perfilNombre: resolved.perfilNombre,
    perfilRol: resolved.perfilRol,
    perfilPermisos: resolved.perfilPermisos,
    perfilProyectos: resolved.perfilProyectos,
    obraId: obra.id,
    obraNombre: obra.nombre,
    obraTipo: (obra.tipo ?? 'desarrollo') as 'desarrollo' | 'obra',
    obraModo: ((obra as any).modo_cuentas ?? 'empresa') as 'empresa' | 'especificas',
    obraEstado: ((obra as any).estado ?? 'activa') as 'activa' | 'pausada' | 'finalizada',
  }
})
