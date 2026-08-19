import type { DefinicionSeccionEmpresa, DefinicionSeccionProyecto } from './tipos'

// Calcado 1:1 de buildConstructoraNav() en components/admin/AdminSidebar.tsx
// — mismas rutas, mismos módulos, para que el chat nunca ofrezca una
// sección que en realidad no existe o no está en el sidebar (WhatsApp
// queda afuera a propósito, igual que en el sidebar: "se retoma más
// adelante").
export const SECCIONES_EMPRESA: DefinicionSeccionEmpresa[] = [
  { key: 'inicio', label: 'Proyectos', ruta: '/admin', modulo: null },
  { key: 'presupuestos', label: 'Presupuestos', ruta: '/admin/presupuestos', modulo: 'presupuestos' },
  { key: 'proveedores', label: 'Proveedores', ruta: '/admin/proveedores', modulo: 'proveedores' },
  { key: 'clientes', label: 'Clientes', ruta: '/admin/clientes', modulo: 'clientes' },
  { key: 'inventario', label: 'Inventario', ruta: '/admin/inventario', modulo: 'inventario' },
  { key: 'personal', label: 'Personal', ruta: '/admin/personal', modulo: 'personal' },
  { key: 'cuentas', label: 'Cuentas', ruta: '/admin/cuentas', modulo: 'cuentas' },
  { key: 'ingresos', label: 'Ingresos', ruta: '/admin/ingresos', modulo: 'ingresos' },
  { key: 'gastos', label: 'Gastos', ruta: '/admin/gastos', modulo: 'gastos' },
  {
    key: 'compras', label: 'Compras', ruta: '/admin/compras', modulo: 'compras',
    subsecciones: [
      { key: 'ordenes', label: 'Órdenes' },
      { key: 'stock', label: 'Stock' },
      { key: 'acopios', label: 'Acopios' },
    ],
  },
  { key: 'tesoreria', label: 'Caja', ruta: '/admin/tesoreria', modulo: 'tesoreria' },
  { key: 'usuarios', label: 'Usuarios', ruta: '/admin/usuarios', modulo: null, soloAdmin: true },
]

// Calcado 1:1 de buildDesarrolloNav()/buildObraNav() en AdminSidebar.tsx —
// `tipos` dice a qué tipo de proyecto aplica cada segmento (varios son
// compartidos, algunos exclusivos de desarrollo u obra).
export const SECCIONES_PROYECTO: DefinicionSeccionProyecto[] = [
  { key: 'dashboard', label: 'Dashboard', segmento: 'dashboard', modulo: null, tipos: ['desarrollo', 'obra'] },
  { key: 'tipologias', label: 'Tipologías', segmento: 'tipologias', modulo: 'tipologias', tipos: ['desarrollo'] },
  { key: 'amenities', label: 'Amenities', segmento: 'amenities', modulo: 'amenities', tipos: ['desarrollo'] },
  { key: 'unidades', label: 'Unidades', segmento: 'unidades', modulo: 'unidades', tipos: ['desarrollo'] },
  { key: 'asignado', label: 'Personal, equipos y stock', segmento: 'asignado', modulo: null, tipos: ['desarrollo', 'obra'] },
  { key: 'reservas', label: 'Reservas', segmento: 'reservas', modulo: 'reservas', tipos: ['desarrollo'] },
  { key: 'contratos', label: 'Ventas', segmento: 'contratos', modulo: 'contratos', tipos: ['desarrollo'] },
  { key: 'certificados', label: 'Contratos', segmento: 'certificados', modulo: 'certificados', tipos: ['obra'] },
  { key: 'cobros', label: 'Cobros', segmento: 'cobros', modulo: 'cobros', tipos: ['obra'] },
  { key: 'cuentas', label: 'Cuentas', segmento: 'cuentas', modulo: 'cuentas', tipos: ['desarrollo', 'obra'], soloModoCuentas: 'especificas' },
  { key: 'gastos', label: 'Gastos', segmento: 'gastos', modulo: 'gastos', tipos: ['desarrollo', 'obra'] },
  { key: 'caja', label: 'Caja', segmento: 'caja', modulo: 'tesoreria', tipos: ['desarrollo', 'obra'] },
]
