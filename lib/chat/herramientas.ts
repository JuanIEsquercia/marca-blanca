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
    description: 'Uso OBLIGATORIO para llevar al usuario a un proyecto puntual o a una sección dentro de un proyecto puntual (ej. "Gastos de la obra Norte") — nunca inventes la ruta en texto. Necesita el id real del proyecto (conseguilo con listar_proyectos primero, nunca lo inventes). Si no se especifica sección, lleva al Dashboard del proyecto. Para llevar directo al certificado de un contrato puntual (sección "certificados"), sumá contratoId (obtenido de listar_contratos_obra) — abre ya el formulario de ese contrato en vez de la lista general.',
    input_schema: {
      type: 'object',
      properties: {
        obraId: { type: 'string', description: 'Id real del proyecto, obtenido de listar_proyectos — nunca inventado' },
        seccion: { type: 'string', enum: SECCIONES_PROYECTO_KEYS, description: 'Sección dentro del proyecto (opcional, default dashboard). OJO, no confundir por el nombre: "certificados" es la sección "Contratos" de un proyecto tipo OBRA (contrato con cliente/subcontratista + certificación de avance) — "contratos" es la sección "Ventas" de un proyecto tipo DESARROLLO (venta de unidades por cuotas). Un "contrato de obra" siempre es seccion="certificados", nunca seccion="contratos". Fijate el tipo del proyecto (lo devuelve listar_proyectos) antes de elegir.' },
        contratoId: { type: 'string', description: 'Solo si seccion es "certificados" y el usuario pidió ir directo a un contrato puntual — id real obtenido de listar_contratos_obra' },
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
  {
    name: 'crear_categoria_gasto',
    description: 'Da de alta una categoría de gasto nueva (ej. "Materiales", "Flete"), con un color por default — no se le pide color al usuario salvo que lo dé espontáneamente. Requiere confirmación explícita antes de ejecutarse de verdad.',
    input_schema: schemaDesdeEntidad('categoria_gasto'),
  },
  {
    name: 'crear_personal',
    description: 'Da de alta una persona nueva en Personal. No asigna cuadrilla ni obra en este paso — si el usuario también quiere eso, decile que lo termina de asignar desde la pantalla de Personal una vez creada. Requiere confirmación explícita antes de ejecutarse de verdad.',
    input_schema: schemaDesdeEntidad('persona'),
  },
  {
    name: 'crear_cuadrilla',
    description: 'Da de alta una cuadrilla nueva (agrupación de personal), sin capataz asignado todavía — eso se elige después desde la pantalla de Personal. Requiere confirmación explícita antes de ejecutarse de verdad.',
    input_schema: schemaDesdeEntidad('cuadrilla'),
  },
  {
    name: 'listar_proveedores',
    description: 'Devuelve los proveedores de la empresa (id y razón social). Usar antes de crear_gasto cuando el usuario mencione un proveedor por nombre — buscá el que coincide (tolerá errores de tipeo) en vez de inventar un id; si no hay ninguno que coincida con confianza, dejá el gasto sin proveedor y decilo.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'listar_categorias_gasto',
    description: 'Devuelve las categorías de gasto de la empresa (id y nombre). Usar antes de crear_gasto cuando el usuario mencione una categoría — buscá la que coincide en vez de inventar un id; si ninguna coincide, dejá el gasto sin categoría en vez de forzar una que no corresponde.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'crear_gasto',
    description: 'Da de alta un gasto PENDIENTE (no lo marca como pagado — eso es una acción aparte, más adelante, desde el panel). El usuario puede pedir esto con otras palabras: "cargame una factura", "cargá una FC", "anotá un gasto", "meté un comprobante de X" — todo eso es crear_gasto. No pidas ni inventes desglose de IVA/monto neto, no hace falta. Si el usuario menciona un proyecto, proveedor o categoría, resolvé sus ids reales con listar_proyectos/listar_proveedores/listar_categorias_gasto antes de llamar a esta tool — nunca inventes un id. Si no se indica proyecto, el gasto queda "administrativo" (sin proyecto) y eso solo lo puede hacer un administrador. Requiere confirmación explícita antes de ejecutarse de verdad.',
    input_schema: schemaDesdeEntidad('gasto'),
  },
  {
    name: 'crear_orden_compra',
    description: 'Da de alta una orden de compra (Compras → Órdenes) con uno o más ítems de producto pedidos a proveedor. El producto se busca o se crea solo por nombre — no hace falta averiguar su id de antemano. Si el usuario menciona un proyecto, resolvé su id real con listar_proyectos antes de llamar a esta tool (si no menciona ninguno, la orden queda en el pool de la empresa, sin restricción de admin). Nunca inventes cantidades o productos que el usuario no dijo. Requiere confirmación explícita antes de ejecutarse de verdad.',
    input_schema: {
      type: 'object',
      properties: {
        obra_id: { type: 'string', description: 'Id real del proyecto, obtenido de listar_proyectos — opcional' },
        items: {
          type: 'array',
          description: 'Productos pedidos en esta orden — al menos uno',
          items: {
            type: 'object',
            properties: {
              producto_nombre: { type: 'string', description: 'Nombre del producto tal como lo mencionó el usuario' },
              cantidad: { type: 'string', description: 'Cantidad solicitada (número)' },
              unidad_medida: { type: 'string', description: 'Opcional — ej. "kg", "m3", "unidad". Si se omite, queda la que ya tenga el producto o "unidad" si es nuevo.' },
            },
            required: ['producto_nombre', 'cantidad'],
          },
        },
        fecha_emision: { type: 'string', description: 'Formato YYYY-MM-DD — si se omite, hoy' },
        notas: { type: 'string' },
      },
      required: ['items'],
    },
  },
  {
    name: 'listar_contratos_obra',
    description: 'Devuelve los contratos de un proyecto (id, tipo cliente/subcontratista, con quién, estado). Usar antes de consultar_rubros_contrato o crear_certificado_avance cuando el usuario mencione un contrato por proyecto o por proveedor/cliente — buscá el que coincide en vez de inventar un id. Un proyecto puede tener varios contratos (uno con el cliente y uno por cada subcontratista).',
    input_schema: {
      type: 'object',
      properties: {
        obraId: { type: 'string', description: 'Id real del proyecto, obtenido de listar_proyectos' },
      },
      required: ['obraId'],
    },
  },
  {
    name: 'consultar_rubros_contrato',
    description: 'Devuelve los rubros (ítems) de un contrato con su monto contratado y el % de avance acumulado ya certificado hasta ahora. Uso OBLIGATORIO antes de certificar avance — con esto le preguntás al usuario el nuevo % de cada rubro que cambió, en vez de adivinar.',
    input_schema: {
      type: 'object',
      properties: {
        contratoId: { type: 'string', description: 'Id real del contrato, obtenido de listar_contratos_obra' },
      },
      required: ['contratoId'],
    },
  },
  {
    name: 'crear_certificado_avance',
    description: 'Certifica el avance de un contrato: da de alta un certificado nuevo con el % de avance ACUMULADO (no incremental) de cada rubro que el usuario indicó — llamá antes a consultar_rubros_contrato para saber los rubros, sus ids y su % actual. Los rubros que no se mencionan quedan con el mismo % que ya tenían (sin cambio este período). Nunca bajes el % de un rubro por debajo del que ya tenía. Requiere confirmación explícita antes de ejecutarse de verdad — el certificado queda en estado "borrador", no genera un cobro/pago automáticamente.',
    input_schema: {
      type: 'object',
      properties: {
        contrato_id: { type: 'string', description: 'Id real del contrato, obtenido de listar_contratos_obra' },
        periodo: { type: 'string', description: 'Ej: "Enero 2026", "Semana del 1 al 15/03"' },
        items: {
          type: 'array',
          description: 'Rubros cuyo % de avance acumulado cambió este período — al menos uno',
          items: {
            type: 'object',
            properties: {
              contrato_obra_item_id: { type: 'string', description: 'Id real del rubro, obtenido de consultar_rubros_contrato' },
              pct_avance_acumulado: { type: 'string', description: 'Nuevo % ACUMULADO de este rubro (0 a 100), no el incremento' },
            },
            required: ['contrato_obra_item_id', 'pct_avance_acumulado'],
          },
        },
        descripcion_avances: { type: 'string' },
        notas: { type: 'string' },
      },
      required: ['contrato_id', 'periodo', 'items'],
    },
  },
  {
    name: 'listar_gastos_pendientes',
    description: 'Devuelve los gastos en estado Pendiente (no pagados todavía) que este usuario puede ver, opcionalmente filtrados por proyecto y/o proveedor. El usuario puede pedir esto como "pagar una factura", "saldar una deuda", "cancelarle a X" — usar antes de marcar_gasto_pagado para encontrar el gasto real, nunca inventar un id.',
    input_schema: {
      type: 'object',
      properties: {
        obraId: { type: 'string', description: 'Id real del proyecto, obtenido de listar_proyectos — opcional' },
        proveedorId: { type: 'string', description: 'Id real del proveedor, obtenido de listar_proveedores — opcional' },
      },
    },
  },
  {
    name: 'listar_cuentas_disponibles_gasto',
    description: 'Devuelve las cuentas propias válidas para pagar un gasto puntual — no cualquier cuenta de la empresa sirve, depende del proyecto del gasto y de si ese proyecto usa cuentas propias o el pool de la empresa. Uso OBLIGATORIO antes de marcar_gasto_pagado para elegir una cuenta real.',
    input_schema: {
      type: 'object',
      properties: {
        gastoId: { type: 'string', description: 'Id real del gasto, obtenido de listar_gastos_pendientes' },
      },
      required: ['gastoId'],
    },
  },
  {
    name: 'marcar_gasto_pagado',
    description: 'Marca un gasto pendiente como pagado, con la cuenta desde la que salió la plata. Llamá antes a listar_gastos_pendientes (para el id del gasto) y listar_cuentas_disponibles_gasto (para una cuenta válida para ESE gasto) — nunca inventes ninguno de los dos ids. Requiere confirmación explícita antes de ejecutarse de verdad.',
    input_schema: schemaDesdeEntidad('pago_gasto'),
  },
  {
    name: 'listar_certificados_contrato',
    description: 'Devuelve los certificados de un contrato con su monto certificado, cuánto ya se cobró de cada uno y cuánto queda sin cobrar. Solo tiene sentido para contratos con el cliente (tipo "cliente") — un contrato con subcontratista no se cobra, se paga con un gasto. Uso OBLIGATORIO antes de crear_cobro para saber el id real del certificado y no proponer cobrar de más.',
    input_schema: {
      type: 'object',
      properties: {
        contratoId: { type: 'string', description: 'Id real del contrato, obtenido de listar_contratos_obra' },
      },
      required: ['contratoId'],
    },
  },
  {
    name: 'crear_cobro',
    description: 'Da de alta un cobro PENDIENTE de un contrato con el cliente (no lo marca como cobrado — eso es marcar_cobro_cobrado, un paso aparte). El usuario puede pedir esto como "cobrale al cliente", "registrá un cobro", "facturale el certificado", "cobrá un anticipo/seña". Necesita el contrato (listar_contratos_obra) — el certificado es OPCIONAL: si el usuario menciona un certificado puntual, resolvelo con listar_certificados_contrato, pero un cobro también puede no venir de ningún certificado (anticipos, señas, cobros sueltos) — en ese caso no inventes uno, dejalo sin certificado. No pidas desglose de IVA/monto neto, no hace falta. Requiere confirmación explícita antes de ejecutarse de verdad.',
    input_schema: schemaDesdeEntidad('cobro'),
  },
  {
    name: 'listar_cobros_pendientes',
    description: 'Devuelve los cobros en estado Pendiente (todavía no cobrados) que este usuario puede ver, opcionalmente filtrados por proyecto y/o contrato. Usar antes de marcar_cobro_cobrado para encontrar el cobro real, nunca inventar un id.',
    input_schema: {
      type: 'object',
      properties: {
        obraId: { type: 'string', description: 'Id real del proyecto, obtenido de listar_proyectos — opcional' },
        contratoId: { type: 'string', description: 'Id real del contrato, obtenido de listar_contratos_obra — opcional' },
      },
    },
  },
  {
    name: 'listar_cuentas_disponibles_cobro',
    description: 'Devuelve las cuentas propias válidas para recibir un cobro puntual — depende del proyecto del cobro y de si ese proyecto usa cuentas propias o el pool de la empresa. Uso OBLIGATORIO antes de marcar_cobro_cobrado para elegir una cuenta real.',
    input_schema: {
      type: 'object',
      properties: {
        cobroId: { type: 'string', description: 'Id real del cobro, obtenido de listar_cobros_pendientes' },
      },
      required: ['cobroId'],
    },
  },
  {
    name: 'marcar_cobro_cobrado',
    description: 'Marca un cobro pendiente como efectivamente cobrado, con la cuenta a la que entró la plata. Llamá antes a listar_cobros_pendientes (para el id del cobro) y listar_cuentas_disponibles_cobro (para una cuenta válida) — nunca inventes ninguno de los dos ids. Requiere confirmación explícita antes de ejecutarse de verdad.',
    input_schema: schemaDesdeEntidad('pago_cobro'),
  },
  {
    name: 'listar_pendientes_cobro',
    description: 'Devuelve TODO lo pendiente de cobrar en toda la empresa (o en un proyecto puntual si se indica): cobros de obra sin cobrar y cuotas de venta de unidades sin cobrar, juntos. "origen":"cobro_obra" solo dice que es un cobro de un proyecto de construcción (obra) — NO dice que venga de un certificado. Si viene de un certificado real o no lo indica el campo "certificado" de CADA ítem por separado (N°/período, o "sin certificado"): un mismo proyecto puede tener cobros con certificado y cobros sueltos (anticipos/señas) mezclados, así que nunca rotules un proyecto entero o un grupo como "(certificado de obra)" — el certificado es una propiedad de cada cobro individual, fijate ítem por ítem. Uso OBLIGATORIO cuando el usuario pregunta en general "¿qué tengo pendiente de cobrar?", "¿qué me deben?", sin nombrar un contrato puntual — no le pidas que primero especifique el proyecto o contrato, esta tool ya barre todo lo que puede ver. Si en cambio ya sabés el contrato exacto (el usuario lo nombró), usá mejor listar_certificados_contrato, que da más detalle por certificado.',
    input_schema: {
      type: 'object',
      properties: {
        obraId: { type: 'string', description: 'Id real del proyecto, obtenido de listar_proyectos — opcional, para acotar a un solo proyecto' },
      },
    },
  },
  {
    name: 'consultar_cashflow',
    description: 'Devuelve el estado de caja: saldo actual, ingresos y egresos por cuenta, agrupados por moneda (ARS/USD nunca se suman entre sí). Sin obraId trae el consolidado de TODA la empresa (todas las cuentas activas, de cualquier proyecto o del pool) — con obraId, el detalle de un proyecto puntual. Usar cuando el usuario pregunte por el cashflow, la caja, cuánta plata hay, o el flujo de fondos.',
    input_schema: {
      type: 'object',
      properties: {
        obraId: { type: 'string', description: 'Id real del proyecto, obtenido de listar_proyectos — opcional, omitir para el consolidado de toda la empresa' },
      },
    },
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
  crear_categoria_gasto: { requiereConfirmacion: true, entidad: 'categoria_gasto' },
  crear_personal: { requiereConfirmacion: true, entidad: 'persona' },
  crear_cuadrilla: { requiereConfirmacion: true, entidad: 'cuadrilla' },
  listar_proveedores: { requiereConfirmacion: false },
  listar_categorias_gasto: { requiereConfirmacion: false },
  crear_gasto: { requiereConfirmacion: true, entidad: 'gasto' },
  crear_orden_compra: { requiereConfirmacion: true, entidad: 'orden_compra' },
  listar_contratos_obra: { requiereConfirmacion: false },
  consultar_rubros_contrato: { requiereConfirmacion: false },
  crear_certificado_avance: { requiereConfirmacion: true, entidad: 'certificado_avance' },
  listar_gastos_pendientes: { requiereConfirmacion: false },
  listar_cuentas_disponibles_gasto: { requiereConfirmacion: false },
  marcar_gasto_pagado: { requiereConfirmacion: true, entidad: 'pago_gasto' },
  listar_certificados_contrato: { requiereConfirmacion: false },
  crear_cobro: { requiereConfirmacion: true, entidad: 'cobro' },
  listar_cobros_pendientes: { requiereConfirmacion: false },
  listar_cuentas_disponibles_cobro: { requiereConfirmacion: false },
  marcar_cobro_cobrado: { requiereConfirmacion: true, entidad: 'pago_cobro' },
  listar_pendientes_cobro: { requiereConfirmacion: false },
  consultar_cashflow: { requiereConfirmacion: false },
}

// El catálogo entero es idéntico en cada request (no depende del usuario,
// a diferencia del system prompt) — un solo cache_control en el último tool
// le dice a la API que cachee TODO lo anterior (todas las tools), así un
// mensaje de seguimiento en la misma conversación no vuelve a cobrar ni a
// procesar ~30 definiciones de tool de nuevo. Se computa una vez a nivel de
// módulo, no en cada request.
export const TOOLS_CACHEABLE: Anthropic.Tool[] = TOOLS.map((tool, i) =>
  i === TOOLS.length - 1 ? { ...tool, cache_control: { type: 'ephemeral' } } : tool
)
