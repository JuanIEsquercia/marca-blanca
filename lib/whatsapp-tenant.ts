import { createAdminClient } from '@/lib/supabase/admin'

export interface WhatsappPerfil {
  perfilId: string
  perfilNombre: string
  perfilRol: 'admin' | 'operador'
}

// El webhook de Kapso no trae sesión de browser (es server-to-server), así
// que no podemos usar getConstructoraContext() (depende de auth.getUser()).
// Acá el tenant se resuelve por el número RECEPTOR (phone_number_id) y el
// usuario por el número EMISOR (perfiles.telefono) — ambos vía admin client.
export async function resolverConstructoraPorNumero(kapsoPhoneId: string): Promise<{ id: string; nombre: string } | null> {
  const admin = createAdminClient()

  // Embed simple: whatsapp_numeros -> constructoras tiene una única FK, sin ambigüedad.
  const { data: numero, error } = await admin
    .from('whatsapp_numeros')
    .select('constructora_id, constructoras(nombre)')
    .eq('kapso_phone_id', kapsoPhoneId)
    .eq('activo', true)
    .maybeSingle()

  if (error) {
    console.error('resolverConstructoraPorNumero:', error)
    return null
  }
  if (!numero) return null

  return {
    id: numero.constructora_id,
    nombre: (numero.constructoras as unknown as { nombre: string } | null)?.nombre ?? 'Constructora',
  }
}

export async function resolverPerfilPorTelefono(constructoraId: string, telefono: string): Promise<WhatsappPerfil | null> {
  const admin = createAdminClient()

  // Sin embed de constructoras acá: perfiles<->constructoras tiene 3
  // relaciones posibles (constructora_id, constructoras.owner_id, miembros),
  // así que un embed sin desambiguar (constructoras!fk_name) tira PGRST201.
  // El nombre de la constructora ya lo tiene el caller vía resolverConstructoraPorNumero.
  const { data: perfil, error } = await admin
    .from('perfiles')
    .select('id, nombre, rol')
    .eq('constructora_id', constructoraId)
    .eq('telefono', telefono)
    .maybeSingle()

  if (error) {
    console.error('resolverPerfilPorTelefono:', error)
    return null
  }
  if (!perfil) return null

  return {
    perfilId: perfil.id,
    perfilNombre: perfil.nombre,
    perfilRol: perfil.rol as 'admin' | 'operador',
  }
}

export interface ProyectoAccesible {
  obraId: string
  nombre: string
  tipo: 'desarrollo' | 'obra'
  modoCuentas: 'empresa' | 'especificas'
}

export interface AccesoCaja {
  general: boolean // puede ver /admin/tesoreria (caja consolidada de la empresa)
  proyectos: ProyectoAccesible[]
}

// 'tesoreria' es un permiso de bucket EMPRESA (perfiles.permisos), no un
// módulo por-proyecto (ver lib/permisos.ts: MODULOS_EMPRESA) — puedeAcceder()
// lo resuelve igual sin importar el obraId. Por eso acá no se filtra por
// perfil_proyectos.permisos: si el operador tiene 'tesoreria' en su bucket
// empresa, ve la caja general Y la de CADA proyecto que tenga asignado
// (esté o no ese módulo en el array específico de ese proyecto) — mismo
// comportamiento que el sidebar del panel.
export async function obtenerAccesoCaja(constructoraId: string, perfil: WhatsappPerfil): Promise<AccesoCaja> {
  const admin = createAdminClient()

  if (perfil.perfilRol === 'admin') {
    const { data: obras } = await admin
      .from('obras')
      .select('id, nombre, tipo, modo_cuentas')
      .eq('constructora_id', constructoraId)
      .order('nombre')

    return {
      general: true,
      proyectos: (obras ?? []).map(o => ({
        obraId: o.id, nombre: o.nombre, tipo: o.tipo as 'desarrollo' | 'obra', modoCuentas: (o.modo_cuentas ?? 'empresa') as 'empresa' | 'especificas',
      })),
    }
  }

  const { data: miPerfil } = await admin.from('perfiles').select('permisos').eq('id', perfil.perfilId).maybeSingle()
  if (!(miPerfil?.permisos ?? []).includes('tesoreria')) {
    return { general: false, proyectos: [] }
  }

  const { data: proyectos } = await admin
    .from('perfil_proyectos')
    .select('obra_id, obras(id, nombre, tipo, modo_cuentas)')
    .eq('perfil_id', perfil.perfilId)
    .eq('constructora_id', constructoraId)

  return {
    general: true,
    proyectos: (proyectos ?? [])
      .map(p => {
        const obra = p.obras as unknown as { id: string; nombre: string; tipo: string; modo_cuentas: string | null } | null
        return obra ? { obraId: obra.id, nombre: obra.nombre, tipo: obra.tipo as 'desarrollo' | 'obra', modoCuentas: (obra.modo_cuentas ?? 'empresa') as 'empresa' | 'especificas' } : null
      })
      .filter((p): p is ProyectoAccesible => p !== null),
  }
}
