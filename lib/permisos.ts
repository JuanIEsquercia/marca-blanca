export type TipoProyecto = 'desarrollo' | 'obra'

export const MODULOS = [
  { key: 'tipologias',  label: 'Tipologías',  seccion: 'Proyecto',  soloTipo: 'desarrollo' },
  { key: 'amenities',   label: 'Amenities',   seccion: 'Proyecto',  soloTipo: 'desarrollo' },
  { key: 'unidades',    label: 'Unidades',    seccion: 'Proyecto',  soloTipo: 'desarrollo' },
  { key: 'reservas',    label: 'Reservas',    seccion: 'Comercial', soloTipo: 'desarrollo' },
  { key: 'contratos',   label: 'Ventas',      seccion: 'Comercial', soloTipo: 'desarrollo' },
  { key: 'certificados', label: 'Certificados de avance', seccion: 'Comercial', soloTipo: 'obra' },
  { key: 'cobros',      label: 'Cobros de obra', seccion: 'Comercial', soloTipo: 'obra' },
  { key: 'gastos',      label: 'Gastos',      seccion: 'Operaciones' },
  { key: 'proveedores', label: 'Proveedores', seccion: 'Operaciones' },
  { key: 'presupuestos', label: 'Presupuestos', seccion: 'Operaciones' },
  { key: 'tesoreria',   label: 'Caja',        seccion: 'Finanzas' },
  { key: 'cuentas',     label: 'Cuentas',     seccion: 'Finanzas' },
] as const

export type ModuloKey = typeof MODULOS[number]['key']

export const MAX_OPERADORES = 3

// Bucket "Empresa": módulos que no cuelgan de ningún proyecto — sus datos
// no tienen obra_id (proveedores) o son un agregado cruzado (tesoreria).
// Todo lo demás vive en el árbol por-proyecto (perfil_proyectos).
export const MODULOS_EMPRESA: ModuloKey[] = ['proveedores', 'tesoreria', 'presupuestos']

export const MODULOS_PROYECTO = MODULOS.filter(m => !MODULOS_EMPRESA.includes(m.key))

export interface ProyectoAsignado {
  obraId: string
  permisos: string[]
}

// Punto único de decisión de acceso — usado por app/admin/layout.tsx (guard
// de rutas), AdminSidebar.tsx (qué mostrar en la nav) y cualquier API route
// que necesite el mismo chequeo (ej. extraer-factura). Antes esta lógica
// vivía duplicada en al menos 2 lugares con el array plano de permisos.
export function puedeAcceder(
  rol: string,
  permisosEmpresa: string[],
  proyectos: ProyectoAsignado[],
  modulo: ModuloKey,
  obraIdActual: string | null
): boolean {
  if (rol === 'admin') return true
  if (MODULOS_EMPRESA.includes(modulo)) return permisosEmpresa.includes(modulo)
  if (obraIdActual) {
    return proyectos.find(p => p.obraId === obraIdActual)?.permisos.includes(modulo) ?? false
  }
  // Vista agregada de empresa (ej. /admin/gastos, /admin/cuentas): alcanza
  // con tener el módulo en cualquiera de los proyectos asignados.
  return proyectos.some(p => p.permisos.includes(modulo))
}

// Un operador "de toda la empresa" (tipoObra null) puede recibir cualquier
// módulo de proyecto. Un proyecto concreto solo puede recibir los módulos
// compartidos (sin soloTipo) más los propios del tipo de ESE proyecto —
// no tiene sentido darle "Amenities" a alguien asignado a una obra de
// construcción, ni "Certificados de avance" a alguien en un desarrollo.
export function modulosDisponibles(tipoObra: TipoProyecto | null) {
  if (!tipoObra) return MODULOS_PROYECTO
  return MODULOS_PROYECTO.filter(m => !('soloTipo' in m) || m.soloTipo === tipoObra)
}
