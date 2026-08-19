import type Anthropic from '@anthropic-ai/sdk'
import type { ModuloKey } from '@/lib/permisos'

// Catálogo de entidades — una sola fuente de verdad para "qué campos pide
// crear tal cosa": alimenta tanto el input_schema de las tools de
// escritura como la respuesta de consultar_estructura, para que nunca
// puedan desincronizarse (ver lib/chat/catalogo-entidades.ts).
export type EntidadKey = 'proveedor' | 'cliente' | 'cuenta_propia' | 'categoria_gasto' | 'persona' | 'cuadrilla'

export interface CampoEntidad {
  nombre: string
  label: string
  requerido: boolean
  descripcion?: string
  // Si el campo solo acepta valores fijos (ej. tipo de cuenta, moneda), se
  // declara acá para que el JSON schema de la tool lo exija con un enum
  // real — más confiable que solo describirlo en texto y esperar que el
  // modelo lo respete.
  opciones?: string[]
}

export interface DefinicionEntidad {
  key: EntidadKey
  label: string
  // Módulo de lib/permisos.ts que gatea poder crear esta entidad — el
  // ejecutor de la tool de escritura lo chequea con puedeAcceder() antes
  // de tocar la base (la RLS es el backstop real; esto es para devolver
  // un mensaje de chat prolijo en vez de un error crudo de Postgres).
  modulo: ModuloKey
  rutaNavegacion: string
  campos: CampoEntidad[]
}

// Secciones de empresa navegables (calcadas de buildConstructoraNav en
// AdminSidebar.tsx) — catálogo separado de CATALOGO_ENTIDADES porque no
// todo lo navegable es "creable" (Dashboard, Caja, Usuarios no tienen un
// alta rápida) y viceversa.
export type SeccionEmpresaKey =
  | 'inicio' | 'presupuestos' | 'proveedores' | 'clientes' | 'inventario'
  | 'personal' | 'cuentas' | 'ingresos' | 'gastos' | 'compras' | 'tesoreria' | 'usuarios'

export interface SubseccionNavegable {
  key: string
  label: string
}

export interface DefinicionSeccionEmpresa {
  key: SeccionEmpresaKey
  label: string
  ruta: string
  modulo: ModuloKey | null // null = sin gate de módulo (ej. inicio)
  soloAdmin?: boolean
  // Algunos módulos tienen pestañas internas que no son rutas propias (ej.
  // Compras: Órdenes/Stock/Acopios, un solo useState en ComprasManager.tsx)
  // — cuando existen, se navega agregando ?tab=<key> a `ruta` (ver la
  // página del módulo correspondiente, que tiene que leer ese query param).
  // Mismos nombres que las subsecciones de CATALOGO_MODULOS para esa
  // sección — a propósito no se unifican los dos catálogos: uno describe
  // para explicar (prosa), este es para armar la URL (clave técnica).
  subsecciones?: SubseccionNavegable[]
}

// Secciones dentro de un proyecto (calcadas de buildDesarrolloNav /
// buildObraNav) — un mismo segmento de URL puede aplicar a los dos tipos
// de proyecto, o a uno solo.
export type SeccionProyectoKey =
  | 'dashboard' | 'tipologias' | 'amenities' | 'unidades' | 'asignado'
  | 'reservas' | 'contratos' | 'certificados' | 'cobros' | 'cuentas' | 'gastos' | 'caja'

export interface DefinicionSeccionProyecto {
  key: SeccionProyectoKey
  label: string
  segmento: string
  modulo: ModuloKey | null
  tipos: ('desarrollo' | 'obra')[]
  soloModoCuentas?: 'especificas'
}

// Conocimiento curado de cómo está organizado cada módulo por dentro
// (pestañas/sub-flujos y cuándo usar cada uno) — el mismo criterio que
// CATALOGO_ENTIDADES, pero un escalón más arriba: acá no son campos de un
// formulario, es "¿orden de compra o acopio?", "¿pago único o plan de
// pago?". Reusa el vocabulario de SeccionEmpresaKey/SeccionProyectoKey
// para no inventar una tercera lista de nombres de módulo.
export type ModuloConocimientoKey = SeccionEmpresaKey | SeccionProyectoKey

export interface SubseccionModulo {
  nombre: string
  descripcion: string
  // Si esta sub-sección también es navegable directo (ver subsecciones en
  // DefinicionSeccionEmpresa), la clave exacta a pasarle a navegar_a va
  // acá — así el modelo la lee de la respuesta en vez de adivinarla del
  // nombre en prosa.
  key?: string
}

export interface DefinicionModulo {
  key: ModuloConocimientoKey
  label: string
  resumen: string
  subsecciones: SubseccionModulo[]
  // Guías cortas para las decisiones que más se repiten dentro del módulo
  // (ej. cuándo usar una cosa vs. la otra) — no es una lista exhaustiva de
  // todo lo que se puede hacer, son los puntos donde un usuario nuevo se
  // traba más seguido.
  decisiones?: string[]
}

// Nombres de tool válidos — METADATA_HERRAMIENTAS (herramientas.ts) es el
// único lugar que decide, por nombre, si una tool ejecuta sola o necesita
// confirmación explícita del usuario antes de escribir.
export type NombreHerramienta =
  | 'consultar_estructura' | 'consultar_modulo' | 'navegar_a' | 'listar_proyectos' | 'navegar_a_proyecto'
  | 'crear_proveedor' | 'crear_cliente' | 'crear_cuenta_propia'
  | 'crear_categoria_gasto' | 'crear_personal' | 'crear_cuadrilla'

export interface MetadataHerramienta {
  requiereConfirmacion: boolean
  entidad?: EntidadKey
}

// Contexto de sesión resuelto server-side (getConstructoraContext) — nunca
// viaja desde el cliente, así ningún tool puede operar fuera de la
// constructora/usuario real de la request.
export interface ContextoChat {
  constructoraId: string
  constructoraNombre: string
  perfilRol: 'admin' | 'operador'
  perfilPermisos: string[]
  perfilProyectos: { obraId: string; permisos: string[] }[]
  perfilNombre: string
}

// Eventos NDJSON que el endpoint de streaming emite, uno por línea. No se
// reenvía el stream crudo de Anthropic tal cual porque acá se mezclan
// deltas de texto con eventos de control propios (propuesta pendiente,
// tool ejecutada) — ver app/api/admin/chat/route.ts.
export type ChatStreamEvent =
  | { type: 'texto'; delta: string }
  | { type: 'herramienta_ejecutada'; nombre: string; resultado: unknown }
  | {
      type: 'propuesta_pendiente'
      toolUseId: string
      herramienta: NombreHerramienta
      entidad: EntidadKey
      input: Record<string, unknown>
      historial: Anthropic.MessageParam[]
    }
  | { type: 'fin'; historial: Anthropic.MessageParam[] }
  | { type: 'error'; mensaje: string }
