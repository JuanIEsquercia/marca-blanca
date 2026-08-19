import type Anthropic from '@anthropic-ai/sdk'
import { CATALOGO_ENTIDADES } from './catalogo-entidades'
import type { EntidadKey, NombreHerramienta, MetadataHerramienta } from './tipos'

const ENTIDADES = Object.keys(CATALOGO_ENTIDADES) as EntidadKey[]

// El input_schema de "crear_X" se arma desde el mismo catálogo que
// consultar_estructura lee — así lo que el modelo puede escribir y lo que
// explica que hace falta nunca se desincronizan.
function schemaDesdeEntidad(entidad: EntidadKey): Anthropic.Tool.InputSchema {
  const def = CATALOGO_ENTIDADES[entidad]
  const properties: Record<string, { type: string; description?: string }> = {}
  for (const campo of def.campos) {
    properties[campo.nombre] = { type: 'string', description: campo.descripcion ?? campo.label }
  }
  return {
    type: 'object',
    properties,
    required: def.campos.filter(c => c.requerido).map(c => c.nombre),
  }
}

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'consultar_estructura',
    description: 'Devuelve qué campos hacen falta para dar de alta una entidad del sistema (cuáles son obligatorios y cuáles opcionales). Usar SIEMPRE esta tool antes de explicar cómo cargar algo — nunca inventar campos de memoria.',
    input_schema: {
      type: 'object',
      properties: {
        entidad: { type: 'string', enum: ENTIDADES, description: 'Qué entidad del sistema' },
      },
      required: ['entidad'],
    },
  },
  {
    name: 'navegar_a',
    description: 'Sugiere llevar al usuario a la pantalla del sistema donde se gestiona una entidad. No ejecuta la navegación (eso lo hace el usuario tocando el botón que se le muestra) — solo la propone.',
    input_schema: {
      type: 'object',
      properties: {
        entidad: { type: 'string', enum: ENTIDADES, description: 'A qué sección navegar' },
      },
      required: ['entidad'],
    },
  },
  {
    name: 'crear_proveedor',
    description: 'Da de alta un proveedor nuevo con los datos que indique el usuario. Requiere confirmación explícita del usuario antes de ejecutarse de verdad — armá el input completo con lo que el usuario ya dijo, la confirmación la maneja el sistema, no preguntes vos "¿confirmás?" en el texto.',
    input_schema: schemaDesdeEntidad('proveedor'),
  },
]

// Único lugar que decide, por nombre de tool, si ejecuta sola o si el
// loop agéntico tiene que cortar y pedir confirmación al usuario antes de
// tocar la base — ver lib/chat/agente.ts.
export const METADATA_HERRAMIENTAS: Record<NombreHerramienta, MetadataHerramienta> = {
  consultar_estructura: { requiereConfirmacion: false },
  navegar_a: { requiereConfirmacion: false },
  crear_proveedor: { requiereConfirmacion: true, entidad: 'proveedor' },
}
