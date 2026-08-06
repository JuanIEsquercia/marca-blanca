export type TipoProyecto = 'desarrollo' | 'obra'

// `descripcion` se muestra como tooltip en el árbol de permisos (UsuariosManager)
// — sin esto, un admin tiene que adivinar el alcance real de cada checkbox
// (ej. "Caja" y "Cuentas" suenan igual, "Ventas" no deja claro que incluye cuotas).
// `avisoAgregado`, cuando existe, se muestra siempre (no solo en el tooltip):
// son los módulos que, aunque se tildan DENTRO de un proyecto puntual, en
// realidad destraban una vista consolidada de TODA la empresa (ver
// puedeAcceder() más abajo, rama "vista agregada") — el punto de confusión
// más reportado por admins que arman el árbol de permisos.
export const MODULOS = [
  { key: 'tipologias',  label: 'Tipologías',  seccion: 'Proyecto',  soloTipo: 'desarrollo',
    descripcion: 'Plantas y metrajes disponibles para este desarrollo.' },
  { key: 'amenities',   label: 'Amenities',   seccion: 'Proyecto',  soloTipo: 'desarrollo',
    descripcion: 'Espacios comunes del desarrollo (SUM, pileta, cochera, etc.).' },
  { key: 'unidades',    label: 'Unidades',    seccion: 'Proyecto',  soloTipo: 'desarrollo',
    descripcion: 'Inventario de unidades a la venta y su estado comercial.' },
  { key: 'reservas',    label: 'Reservas',    seccion: 'Comercial', soloTipo: 'desarrollo',
    descripcion: 'Señas y reservas de unidades antes de firmar la venta.' },
  { key: 'contratos',   label: 'Ventas',      seccion: 'Comercial', soloTipo: 'desarrollo',
    descripcion: 'Contratos de venta firmados y su plan de cuotas.' },
  { key: 'certificados', label: 'Certificados de avance', seccion: 'Comercial', soloTipo: 'obra',
    descripcion: 'Certificación de avance de obra, rubro por rubro.' },
  { key: 'cobros',      label: 'Cobros de obra', seccion: 'Comercial', soloTipo: 'obra',
    descripcion: 'Cobros al cliente asociados a los certificados de esta obra.' },
  { key: 'gastos',      label: 'Gastos',      seccion: 'Operaciones',
    descripcion: 'Gastos y pagos a proveedores imputados a este proyecto.',
    avisoAgregado: 'También habilita ver el listado de Gastos de TODA la empresa (no solo este proyecto) en el menú principal.' },
  { key: 'proveedores', label: 'Proveedores', seccion: 'Operaciones',
    descripcion: 'Cuenta corriente y datos de contacto de cada proveedor — módulo de toda la empresa, no depende de un proyecto.' },
  { key: 'clientes', label: 'Clientes', seccion: 'Operaciones',
    descripcion: 'Datos de contacto de compradores y clientes de obra — módulo de toda la empresa, compartido entre Presupuestos, Contratos, Reservas y Ventas.' },
  { key: 'presupuestos', label: 'Presupuestos', seccion: 'Operaciones',
    descripcion: 'Cotizaciones y presupuestos por rubro — módulo de toda la empresa.' },
  { key: 'inventario',  label: 'Inventario',  seccion: 'Operaciones',
    descripcion: 'Maquinaria y equipos, su asignación e historial — módulo de toda la empresa.' },
  { key: 'personal',    label: 'Personal',    seccion: 'Operaciones',
    descripcion: 'Cuadrillas y personal asignado a cada obra — módulo de toda la empresa.' },
  { key: 'tesoreria',   label: 'Caja',        seccion: 'Finanzas',
    descripcion: 'Saldo consolidado de todas las cuentas de la empresa, en cualquier moneda — módulo de toda la empresa.' },
  { key: 'cuentas',     label: 'Cuentas',     seccion: 'Finanzas',
    descripcion: 'Alta y edición de cuentas propias (bancos, cajas) de este proyecto.',
    avisoAgregado: 'También habilita ver el listado de Cuentas de TODA la empresa (no solo este proyecto) en el menú principal.' },
  { key: 'ingresos',    label: 'Ingresos',    seccion: 'Finanzas',
    descripcion: 'Registro de ingresos que no provienen de una venta o cobro de obra — módulo de toda la empresa.' },
  { key: 'compras',     label: 'Compras',     seccion: 'Operaciones',
    descripcion: 'Órdenes de compra, recepciones de proveedores y stock repartido entre obras — módulo de toda la empresa.',
    avisoAgregado: 'Confirmar una recepción genera un gasto — quien tenga Compras también necesita Gastos habilitado en el proyecto destino (o ser admin) para poder confirmarla.' },
] as const

export type ModuloKey = typeof MODULOS[number]['key']

export const MAX_OPERADORES = 3

// Bucket "Empresa": módulos que no cuelgan de ningún proyecto — sus datos
// no tienen obra_id (proveedores) o son un agregado cruzado (tesoreria).
// Todo lo demás vive en el árbol por-proyecto (perfil_proyectos).
export const MODULOS_EMPRESA: ModuloKey[] = ['proveedores', 'clientes', 'tesoreria', 'presupuestos', 'inventario', 'personal', 'ingresos', 'compras']

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
