import type Anthropic from '@anthropic-ai/sdk'
import type { ModuloKey } from '@/lib/permisos'

// Catálogo de entidades — una sola fuente de verdad para "qué campos pide
// crear tal cosa": alimenta tanto el input_schema de las tools de
// escritura como la respuesta de consultar_estructura, para que nunca
// puedan desincronizarse (ver lib/chat/catalogo-entidades.ts).
export type EntidadKey = 'proveedor'

export interface CampoEntidad {
  nombre: string
  label: string
  requerido: boolean
  descripcion?: string
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

// Nombres de tool válidos — METADATA_HERRAMIENTAS (herramientas.ts) es el
// único lugar que decide, por nombre, si una tool ejecuta sola o necesita
// confirmación explícita del usuario antes de escribir.
export type NombreHerramienta = 'consultar_estructura' | 'navegar_a' | 'crear_proveedor'

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
