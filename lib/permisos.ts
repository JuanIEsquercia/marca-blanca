export const MODULOS = [
  { key: 'tipologias',  label: 'Tipologías',  seccion: 'Proyecto' },
  { key: 'amenities',   label: 'Amenities',   seccion: 'Proyecto' },
  { key: 'unidades',    label: 'Unidades',    seccion: 'Proyecto' },
  { key: 'reservas',    label: 'Reservas',    seccion: 'Comercial' },
  { key: 'contratos',   label: 'Ventas',      seccion: 'Comercial' },
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
