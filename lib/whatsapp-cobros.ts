import { createAdminClient } from '@/lib/supabase/admin'
import type { WhatsappPerfil } from '@/lib/whatsapp-tenant'
import { obtenerCuentasPropias, type CuentaSimple } from '@/lib/tesoreria'

export interface ProyectoConCobros {
  obraId: string
  nombre: string
  modoCuentas: 'empresa' | 'especificas'
}

// 'cobros' es un módulo por-proyecto exclusivo de obras tipo OBRA
// (soloTipo: 'obra' en lib/permisos.ts) — cobros_proyecto.obra_id es NOT
// NULL en el schema, no existe la variante "de empresa" que sí tiene gastos.
export async function obtenerAccesoCobros(constructoraId: string, perfil: WhatsappPerfil): Promise<ProyectoConCobros[]> {
  const admin = createAdminClient()

  if (perfil.perfilRol === 'admin') {
    const { data: obras } = await admin
      .from('obras')
      .select('id, nombre, modo_cuentas')
      .eq('constructora_id', constructoraId)
      .eq('tipo', 'obra')
      .order('nombre')
    return (obras ?? []).map(o => ({ obraId: o.id, nombre: o.nombre, modoCuentas: (o.modo_cuentas ?? 'empresa') as 'empresa' | 'especificas' }))
  }

  const { data: proyectos } = await admin
    .from('perfil_proyectos')
    .select('obra_id, permisos, obras(id, nombre, tipo, modo_cuentas)')
    .eq('perfil_id', perfil.perfilId)
    .eq('constructora_id', constructoraId)

  return (proyectos ?? [])
    .filter(p => (p.permisos ?? []).includes('cobros'))
    .map(p => {
      const obra = p.obras as unknown as { id: string; nombre: string; tipo: string; modo_cuentas: string | null } | null
      return obra && obra.tipo === 'obra' ? { obraId: obra.id, nombre: obra.nombre, modoCuentas: (obra.modo_cuentas ?? 'empresa') as 'empresa' | 'especificas' } : null
    })
    .filter((p): p is ProyectoConCobros => p !== null)
}

export async function obtenerCuentasParaCobro(constructoraId: string, obraId: string, modoCuentas: 'empresa' | 'especificas', moneda?: string): Promise<CuentaSimple[]> {
  return obtenerCuentasPropias(createAdminClient(), constructoraId, obraId, modoCuentas, moneda)
}

export interface DatosCobro {
  monto: number
  moneda: 'ARS' | 'USD'
  obraId: string
  obraNombre: string
  cuentaPropiaId: string
  cuentaPropiaNombre: string
}

export async function registrarCobro(constructoraId: string, perfilId: string, datos: DatosCobro): Promise<void> {
  const admin = createAdminClient()
  const hoy = new Date().toISOString().slice(0, 10)

  const { error } = await admin.from('cobros_proyecto').insert({
    constructora_id: constructoraId,
    obra_id: datos.obraId,
    fecha: hoy,
    fecha_pago: hoy,
    monto: datos.monto,
    moneda: datos.moneda,
    estado: 'cobrado',
    cuenta_propia_id: datos.cuentaPropiaId,
    created_by: perfilId,
  })

  if (error) throw error
}
