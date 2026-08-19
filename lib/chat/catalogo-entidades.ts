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
}
