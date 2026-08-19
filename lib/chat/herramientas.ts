import type Anthropic from '@anthropic-ai/sdk'
import { CATALOGO_ENTIDADES } from './catalogo-entidades'
import type { EntidadKey, NombreHerramienta, MetadataHerramienta } from './tipos'

const ENTIDADES = Object.keys(CATALOGO_ENTIDADES) as EntidadKey[]

// El input_schema de "crear_X" se arma desde el mismo catálogo que
// consultar_estructura lee — así lo que el modelo puede escribir y lo que
// explica que hace falta nunca se desincronizan.
function schemaDesdeEntidad(entidad: EntidadKey): Anthropic.Tool.InputSchema {
  const def = CATALOGO_ENTIDADES[entidad]
  const properties: Record<string, { type: string; description?: string; enum?: string[] }> = {}
  for (const campo of def.campos) {
    properties[campo.nombre] = {
      type: 'string',
      description: campo.descripcion ?? campo.label,
      ...(campo.opciones ? { enum: campo.opciones } : {}),
    }
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
    description: 'Devuelve qué campos hacen falta para dar de alta una entidad del sistema (cuáles son obligatorios y cuáles opcionales, y valores válidos si el campo es de opción fija). Usar SIEMPRE esta tool antes de explicar cómo cargar algo — nunca inventar campos de memoria.',
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
    description: 'Uso OBLIGATORIO cada vez que el usuario pida ir a una pantalla, o cuando ofrezcas navegar a una — nunca lo reemplaces por describir la ruta o un link en el texto. Esta tool es la que hace aparecer el botón real de navegación; no ejecuta la navegación en sí (eso lo hace el usuario al tocar ese botón), solo lo genera.',
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
  {
    name: 'crear_cliente',
    description: 'Da de alta un cliente/comprador nuevo con los datos que indique el usuario (no busca ni reusa uno existente — para eso el usuario tiene que ir a la pantalla de Clientes). Requiere confirmación explícita antes de ejecutarse de verdad, igual que crear_proveedor.',
    input_schema: schemaDesdeEntidad('cliente'),
  },
  {
    name: 'crear_cuenta_propia',
    description: 'Da de alta una cuenta propia (banco o caja) de la empresa, sin asignar a ningún proyecto puntual. Solo un administrador puede hacer esto — si el usuario no lo es, avisá que no puede desde acá y ofrecé navegar a Cuentas dentro del proyecto que corresponda. Requiere confirmación explícita antes de ejecutarse de verdad.',
    input_schema: schemaDesdeEntidad('cuenta_propia'),
  },
]

// Único lugar que decide, por nombre de tool, si ejecuta sola o si el
// loop agéntico tiene que cortar y pedir confirmación al usuario antes de
// tocar la base — ver lib/chat/agente.ts.
export const METADATA_HERRAMIENTAS: Record<NombreHerramienta, MetadataHerramienta> = {
  consultar_estructura: { requiereConfirmacion: false },
  navegar_a: { requiereConfirmacion: false },
  crear_proveedor: { requiereConfirmacion: true, entidad: 'proveedor' },
  crear_cliente: { requiereConfirmacion: true, entidad: 'cliente' },
  crear_cuenta_propia: { requiereConfirmacion: true, entidad: 'cuenta_propia' },
}
