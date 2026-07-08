import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export interface ConstructoraContext {
  constructoraId: string
  constructoraNombre: string
  perfilNombre: string
  perfilRol: 'admin' | 'operador'
  perfilPermisos: string[] | null
  perfilObraId: string | null
}

export interface ProyectoContext extends ConstructoraContext {
  obraId: string
  obraNombre: string
  obraTipo: 'desarrollo' | 'obra'
  obraModo: 'empresa' | 'especificas'
  obraEstado: 'activa' | 'pausada' | 'finalizada'
}

const resolveConstructora = cache(async (): Promise<ConstructoraContext | null> => {
  // Verificar autenticación con cliente normal
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Usar admin client para bypassear RLS en la resolución del tenant.
  // Seguridad: filtramos siempre por user.id del usuario autenticado.
  const admin = createAdminClient()

  // Una sola query a perfiles trae constructora_id + datos del perfil del usuario
  const { data: perfil } = await admin
    .from('perfiles')
    .select('constructora_id, nombre, rol, permisos, obra_id')
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

  // Obtener nombre de la constructora (paralelo — no necesita datos previos)
  const { data: constructora } = await admin
    .from('constructoras')
    .select('id, nombre')
    .eq('id', constructoraId)
    .maybeSingle()

  const rol = ((perfil as any)?.rol ?? 'operador') as 'admin' | 'operador'

  return {
    constructoraId,
    constructoraNombre: constructora?.nombre ?? 'Constructora',
    perfilNombre: (perfil as any)?.nombre ?? '',
    perfilRol: rol,
    perfilPermisos: (perfil as any)?.permisos ?? null,
    // Un admin nunca queda acotado a un proyecto, sea cual sea el dato crudo.
    perfilObraId: rol === 'admin' ? null : ((perfil as any)?.obra_id ?? null),
  }
})

export const getConstructoraContext = cache(async (): Promise<ConstructoraContext | null> => {
  return resolveConstructora()
})

export const getProyectoContext = cache(async (obraId: string): Promise<ProyectoContext | null> => {
  const resolved = await resolveConstructora()
  if (!resolved) return null

  // Enforcement central: un operador acotado a un proyecto no puede resolver
  // el contexto de ningún otro. Todas las páginas de proyecto (dashboard,
  // certificados, cobros, contratos, caja, etc.) redirigen a /admin cuando
  // este helper devuelve null, así que este único chequeo las cubre a todas.
  if (resolved.perfilObraId && resolved.perfilObraId !== obraId) return null

  const admin = createAdminClient()
  const { data: obra } = await admin
    .from('obras')
    .select('id, nombre, tipo, estado, modo_cuentas')
    .eq('id', obraId)
    .eq('constructora_id', resolved.constructoraId)
    .maybeSingle()

  if (!obra) return null

  return {
    constructoraId: resolved.constructoraId,
    constructoraNombre: resolved.constructoraNombre,
    perfilNombre: resolved.perfilNombre,
    perfilRol: resolved.perfilRol,
    perfilPermisos: resolved.perfilPermisos,
    perfilObraId: resolved.perfilObraId,
    obraId: obra.id,
    obraNombre: obra.nombre,
    obraTipo: (obra.tipo ?? 'desarrollo') as 'desarrollo' | 'obra',
    obraModo: ((obra as any).modo_cuentas ?? 'empresa') as 'empresa' | 'especificas',
    obraEstado: ((obra as any).estado ?? 'activa') as 'activa' | 'pausada' | 'finalizada',
  }
})
