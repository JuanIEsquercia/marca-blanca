import type { EntidadKey, DefinicionEntidad } from './tipos'

// Mismos campos que las funciones "rápidas" ya existentes (lib/proveedores.ts,
// lib/compradores.ts, lib/cuentasPropias.ts) — a propósito el mismo shape
// que ya usan los selectores del panel, para no mantener dos descripciones
// de "qué es un proveedor/cliente/cuenta" que puedan divergir.
export const CATALOGO_ENTIDADES: Record<EntidadKey, DefinicionEntidad> = {
  proveedor: {
    key: 'proveedor',
    label: 'Proveedor',
    modulo: 'proveedores',
    rutaNavegacion: '/admin/proveedores',
    campos: [
      { nombre: 'razon_social', label: 'Razón social', requerido: true, descripcion: 'Nombre o razón social del proveedor' },
      { nombre: 'cuit', label: 'CUIT', requerido: false, descripcion: 'Formato 20-12345678-9' },
      { nombre: 'telefono', label: 'Teléfono', requerido: false },
      { nombre: 'email', label: 'Email', requerido: false },
      { nombre: 'direccion', label: 'Dirección', requerido: false },
      { nombre: 'notas', label: 'Notas', requerido: false },
    ],
  },
  cliente: {
    key: 'cliente',
    label: 'Cliente',
    modulo: 'clientes',
    rutaNavegacion: '/admin/clientes',
    campos: [
      { nombre: 'nombre_completo', label: 'Nombre completo', requerido: true, descripcion: 'Nombre y apellido, o razón social' },
      { nombre: 'dni_cuit', label: 'CUIT/DNI', requerido: false },
      { nombre: 'telefono', label: 'Teléfono', requerido: false },
      { nombre: 'email', label: 'Email', requerido: false },
    ],
  },
  cuenta_propia: {
    key: 'cuenta_propia',
    label: 'Cuenta propia',
    modulo: 'cuentas',
    rutaNavegacion: '/admin/cuentas',
    campos: [
      { nombre: 'nombre', label: 'Nombre', requerido: true, descripcion: 'Ej: "Banco Galicia", "Caja obra Norte"' },
      { nombre: 'tipo', label: 'Tipo', requerido: true, opciones: ['banco', 'caja'] },
      { nombre: 'moneda', label: 'Moneda', requerido: true, opciones: ['ARS', 'USD'] },
    ],
  },
  categoria_gasto: {
    key: 'categoria_gasto',
    label: 'Categoría de gasto',
    modulo: 'gastos',
    rutaNavegacion: '/admin/gastos',
    campos: [
      { nombre: 'nombre', label: 'Nombre', requerido: true, descripcion: 'Ej: "Materiales", "Honorarios profesionales"' },
    ],
  },
  persona: {
    key: 'persona',
    label: 'Persona',
    modulo: 'personal',
    rutaNavegacion: '/admin/personal',
    campos: [
      { nombre: 'nombre', label: 'Nombre', requerido: true },
      { nombre: 'dni', label: 'DNI', requerido: false },
      { nombre: 'cuil', label: 'CUIL', requerido: false },
      { nombre: 'telefono', label: 'Teléfono', requerido: false },
      { nombre: 'tipo_contratacion', label: 'Tipo de contratación', requerido: false, opciones: ['relacion_dependencia', 'contratado', 'subcontratista'] },
      { nombre: 'categoria', label: 'Categoría/oficio', requerido: false, descripcion: 'Ej: "Albañil", "Electricista"' },
      { nombre: 'jornal', label: 'Jornal', requerido: false, descripcion: 'Monto del jornal diario' },
    ],
  },
  cuadrilla: {
    key: 'cuadrilla',
    label: 'Cuadrilla',
    modulo: 'personal',
    rutaNavegacion: '/admin/personal',
    campos: [
      { nombre: 'nombre', label: 'Nombre', requerido: true, descripcion: 'Ej: "Cuadrilla 1", "Equipo de albañilería"' },
      { nombre: 'notas', label: 'Notas', requerido: false },
    ],
  },
  gasto: {
    key: 'gasto',
    label: 'Gasto',
    modulo: 'gastos',
    rutaNavegacion: '/admin/gastos',
    campos: [
      { nombre: 'descripcion', label: 'Descripción', requerido: true },
      { nombre: 'monto', label: 'Monto', requerido: true, descripcion: 'Monto total del gasto (número)' },
      { nombre: 'moneda', label: 'Moneda', requerido: false, opciones: ['ARS', 'USD'], descripcion: 'Si se omite, ARS' },
      { nombre: 'obra_id', label: 'Proyecto', requerido: false, descripcion: 'Id real del proyecto al que se imputa, obtenido de listar_proyectos. Si se omite queda como gasto administrativo de la empresa (sin proyecto) — eso solo lo puede cargar un administrador.' },
      { nombre: 'proveedor_id', label: 'Proveedor', requerido: false, descripcion: 'Id real del proveedor, obtenido de listar_proveedores' },
      { nombre: 'categoria_id', label: 'Categoría', requerido: false, descripcion: 'Id real de la categoría de gasto, obtenido de listar_categorias_gasto' },
      { nombre: 'fecha_vencimiento', label: 'Fecha de vencimiento', requerido: false, descripcion: 'Formato YYYY-MM-DD — si se omite, hoy' },
      { nombre: 'notas', label: 'Notas', requerido: false },
    ],
  },
  orden_compra: {
    key: 'orden_compra',
    label: 'Orden de compra',
    modulo: 'compras',
    rutaNavegacion: '/admin/compras?tab=ordenes',
    campos: [
      { nombre: 'obra_id', label: 'Proyecto', requerido: false, descripcion: 'Id real del proyecto, obtenido de listar_proyectos. Si se omite, la orden queda en el pool de la empresa para repartir después entre obras.' },
      { nombre: 'items', label: 'Ítems', requerido: true, descripcion: 'Lista de productos pedidos, cada uno con nombre y cantidad (y unidad de medida si corresponde) — al menos uno. Si el producto no existe todavía en el sistema, se crea solo.' },
      { nombre: 'fecha_emision', label: 'Fecha de emisión', requerido: false, descripcion: 'Formato YYYY-MM-DD — si se omite, hoy' },
      { nombre: 'notas', label: 'Notas', requerido: false },
    ],
  },
}
