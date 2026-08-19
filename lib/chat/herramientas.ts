import type Anthropic from '@anthropic-ai/sdk'
import { CATALOGO_ENTIDADES } from './catalogo-entidades'
import { SECCIONES_EMPRESA, SECCIONES_PROYECTO } from './catalogo-secciones'
import { CATALOGO_MODULOS } from './catalogo-modulos'
import type { EntidadKey, NombreHerramienta, MetadataHerramienta } from './tipos'

const ENTIDADES = Object.keys(CATALOGO_ENTIDADES) as EntidadKey[]
const SECCIONES_EMPRESA_KEYS = SECCIONES_EMPRESA.map(s => s.key)
const SECCIONES_PROYECTO_KEYS = SECCIONES_PROYECTO.map(s => s.key)
const MODULOS_CONOCIMIENTO_KEYS = Object.keys(CATALOGO_MODULOS)

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
    name: 'consultar_modulo',
    description: 'Devuelve cómo está organizado un módulo del sistema por dentro: sus sub-secciones o formas de trabajar, y las decisiones típicas entre ellas (ej. "orden de compra vs. acopio", "pago único vs. plan de pago"). Uso OBLIGATORIO antes de explicar la estructura interna de un módulo, ayudar a elegir entre sus distintas formas de cargar algo, o cuando el usuario pregunte "cómo funciona" un módulo — nunca inventar esto de memoria, solo con lo que devuelve esta tool. Si el módulo no tiene entrada acá, no insistas con suposiciones: decí que no tenés el detalle y ofrecé navegar a esa sección.',
    input_schema: {
      type: 'object',
      properties: {
        modulo: { type: 'string', enum: MODULOS_CONOCIMIENTO_KEYS, description: 'Qué módulo del sistema' },
      },
      required: ['modulo'],
    },
  },
  {
    name: 'navegar_a',
    description: 'Uso OBLIGATORIO cada vez que el usuario pida ir a una sección de la empresa (no un proyecto puntual — para eso usá navegar_a_proyecto), o cuando ofrezcas navegar a una. Nunca reemplaces esto por describir la ruta o un link en el texto. Esta tool es la que hace aparecer el botón real de navegación; no ejecuta la navegación en sí (eso lo hace el usuario al tocar ese botón), solo lo genera. Algunas secciones tienen pestañas internas navegables directamente (ej. Compras: Órdenes/Stock/Acopios) — llamá primero a consultar_modulo para saber si la sección que pedís tiene esas pestañas y cuáles son sus claves exactas, antes de mandar "subseccion".',
    input_schema: {
      type: 'object',
      properties: {
        seccion: { type: 'string', enum: SECCIONES_EMPRESA_KEYS, description: 'A qué sección de la empresa navegar' },
        subseccion: { type: 'string', description: 'Pestaña interna puntual dentro de esa sección, si la tiene y el usuario la pidió (ej. "acopios" dentro de compras) — opcional, omitir si no aplica' },
      },
      required: ['seccion'],
    },
  },
  {
    name: 'listar_proyectos',
    description: 'Devuelve los proyectos (obras/desarrollos) a los que el usuario tiene acceso, con su id, nombre y tipo. Usar SIEMPRE antes de navegar_a_proyecto cuando no sepas el id exacto del proyecto que mencionó el usuario — buscá el que coincide por nombre (tolerá errores de tipeo y variantes) en vez de inventar un id.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'navegar_a_proyecto',
    description: 'Uso OBLIGATORIO para llevar al usuario a un proyecto puntual o a una sección dentro de un proyecto puntual (ej. "Gastos de la obra Norte") — nunca inventes la ruta en texto. Necesita el id real del proyecto (conseguilo con listar_proyectos primero, nunca lo inventes). Si no se especifica sección, lleva al Dashboard del proyecto.',
    input_schema: {
      type: 'object',
      properties: {
        obraId: { type: 'string', description: 'Id real del proyecto, obtenido de listar_proyectos — nunca inventado' },
        seccion: { type: 'string', enum: SECCIONES_PROYECTO_KEYS, description: 'Sección dentro del proyecto (opcional, default dashboard)' },
      },
      required: ['obraId'],
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
  consultar_modulo: { requiereConfirmacion: false },
  navegar_a: { requiereConfirmacion: false },
  listar_proyectos: { requiereConfirmacion: false },
  navegar_a_proyecto: { requiereConfirmacion: false },
  crear_proveedor: { requiereConfirmacion: true, entidad: 'proveedor' },
  crear_cliente: { requiereConfirmacion: true, entidad: 'cliente' },
  crear_cuenta_propia: { requiereConfirmacion: true, entidad: 'cuenta_propia' },
}
