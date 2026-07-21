import { createAdminClient } from '@/lib/supabase/admin'
import type { WhatsappPerfil } from '@/lib/whatsapp-tenant'
import { obtenerCuentasPropias, type CuentaSimple } from '@/lib/tesoreria'

export async function obtenerCategorias(constructoraId: string): Promise<{ id: string; nombre: string }[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('categorias_costo')
    .select('id, nombre')
    .eq('constructora_id', constructoraId)
    .order('nombre')
  return data ?? []
}

export interface ProyectoConGastos {
  obraId: string
  nombre: string
  modoCuentas: 'empresa' | 'especificas'
}

// A diferencia de 'tesoreria' (bucket Empresa), 'gastos' SÍ es un módulo
// por-proyecto real (no está en MODULOS_EMPRESA) — un operador solo ve los
// proyectos donde tiene 'gastos' en su perfil_proyectos.permisos. Un gasto
// sin proyecto (obra_id NULL, overhead administrativo) es exclusivo del
// admin — ver lib/permisos.ts y la memoria de decisiones de producto.
export async function obtenerAccesoGastos(constructoraId: string, perfil: WhatsappPerfil): Promise<{ general: boolean; proyectos: ProyectoConGastos[] }> {
  const admin = createAdminClient()

  if (perfil.perfilRol === 'admin') {
    const { data: obras } = await admin
      .from('obras')
      .select('id, nombre, modo_cuentas')
      .eq('constructora_id', constructoraId)
      .order('nombre')
    return {
      general: true,
      proyectos: (obras ?? []).map(o => ({ obraId: o.id, nombre: o.nombre, modoCuentas: (o.modo_cuentas ?? 'empresa') as 'empresa' | 'especificas' })),
    }
  }

  const { data: proyectos } = await admin
    .from('perfil_proyectos')
    .select('obra_id, permisos, obras(id, nombre, modo_cuentas)')
    .eq('perfil_id', perfil.perfilId)
    .eq('constructora_id', constructoraId)

  return {
    general: false,
    proyectos: (proyectos ?? [])
      .filter(p => (p.permisos ?? []).includes('gastos'))
      .map(p => {
        const obra = p.obras as unknown as { id: string; nombre: string; modo_cuentas: string | null } | null
        return obra ? { obraId: obra.id, nombre: obra.nombre, modoCuentas: (obra.modo_cuentas ?? 'empresa') as 'empresa' | 'especificas' } : null
      })
      .filter((p): p is ProyectoConGastos => p !== null),
  }
}

export async function obtenerCuentasParaGasto(constructoraId: string, obraId: string | null, modoCuentas: 'empresa' | 'especificas', moneda?: string): Promise<CuentaSimple[]> {
  return obtenerCuentasPropias(createAdminClient(), constructoraId, obraId, modoCuentas, moneda)
}

export interface DatosGasto {
  monto: number
  moneda: 'ARS' | 'USD'
  descripcion: string
  categoriaId: string | null
  categoriaNombre: string | null
  obraId: string | null
  obraNombre: string | null
  cuentaPropiaId: string
  cuentaPropiaNombre: string
}

export async function registrarGasto(constructoraId: string, perfilId: string, datos: DatosGasto): Promise<void> {
  const admin = createAdminClient()
  const hoy = new Date().toISOString().slice(0, 10)

  const { error } = await admin.from('gastos').insert({
    constructora_id: constructoraId,
    obra_id: datos.obraId,
    categoria_id: datos.categoriaId,
    cuenta_propia_id: datos.cuentaPropiaId,
    descripcion: datos.descripcion,
    monto: datos.monto,
    moneda: datos.moneda,
    fecha_vencimiento: hoy,
    fecha_pago: hoy,
    estado: 'Pagado',
    created_by: perfilId,
  })

  if (error) throw error
}
