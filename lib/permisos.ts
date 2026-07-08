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
  { key: 'tesoreria',   label: 'Caja',        seccion: 'Finanzas' },
  { key: 'cuentas',     label: 'Cuentas',     seccion: 'Finanzas' },
] as const

export type ModuloKey = typeof MODULOS[number]['key']

export const MAX_OPERADORES = 3

export function tienePermiso(
  rol: string,
  permisos: string[] | null,
  modulo: ModuloKey
): boolean {
  if (rol === 'admin') return true
  if (permisos === null) return true   // legado: sin restricción
  return permisos.includes(modulo)
}

// Un operador "de toda la empresa" (tipoObra null) puede recibir cualquier
// módulo. Un operador acotado a un proyecto solo puede recibir los módulos
// compartidos (sin soloTipo) más los propios del tipo de ESE proyecto —
// no tiene sentido darle "Amenities" a alguien asignado a una obra de
// construcción, ni "Certificados de avance" a alguien en un desarrollo.
export function modulosDisponibles(tipoObra: TipoProyecto | null) {
  if (!tipoObra) return MODULOS
  return MODULOS.filter(m => !('soloTipo' in m) || m.soloTipo === tipoObra)
}
