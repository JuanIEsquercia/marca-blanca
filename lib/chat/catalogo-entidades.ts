import type { EntidadKey, DefinicionEntidad } from './tipos'

// Mismos campos que DatosProveedorRapido (lib/proveedores.ts) — a
// propósito el mismo shape que ya usa ProveedorSelect.tsx, para no
// mantener dos descripciones de "qué es un proveedor" que puedan divergir.
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
}
