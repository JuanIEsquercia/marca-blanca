import type { DefinicionModulo, ModuloConocimientoKey } from './tipos'

// Conocimiento curado a mano de cómo funciona cada módulo por dentro — no
// es toda la documentación posible, son los puntos donde alguien nuevo se
// traba: qué sub-secciones tiene, y cómo elegir entre ellas cuando hay más
// de una forma de cargar algo parecido (ej. orden de compra vs. acopio).
// Solo se completan los módulos donde esa ambigüedad existe de verdad —
// no hace falta "decisiones" en todos.
export const CATALOGO_MODULOS: Partial<Record<ModuloConocimientoKey, DefinicionModulo>> = {
  compras: {
    key: 'compras',
    label: 'Compras',
    resumen: 'Pedir materiales a proveedores, recibirlos, y llevar el stock repartido entre las obras.',
    subsecciones: [
      { nombre: 'Órdenes', descripcion: 'Se pide material a uno o varios proveedores. La orden se cumple de a partes: cada vez que llega mercadería se carga una "recepción" con lo efectivamente entregado, y recién ahí se genera el gasto real y se suma stock. Puede no tener obra fija al crearse (queda en el pool de la empresa) y repartirse a una o varias obras después.' },
      { nombre: 'Stock', descripcion: 'Cuánto hay de cada producto, por obra o sin asignar (pool de empresa). Se puede repartir entre obras o devolver al pool en cualquier momento.' },
      { nombre: 'Acopios', descripcion: 'Crédito prepago con un proveedor: se le paga una suma grande por adelantado a cambio de una cantidad de un producto de referencia (ej. 100kg de acero al precio de hoy). Después se van retirando materiales con el tiempo — el mismo producto de referencia, o cualquier otro que el proveedor también cubra (ahí el proveedor indexa el valor retirado al precio actual del producto de referencia). El saldo se lleva en cantidad del producto de referencia, no en pesos, para no perder poder de compra si sube el precio.' },
    ],
    decisiones: [
      '¿Orden de compra o Acopio? Orden: cuando se sabe de antemano qué material se pide y a qué proveedor — es el flujo normal de compra puntual. Acopio: cuando ya se le pagó (o se le va a pagar) a un proveedor una suma grande por adelantado para ir retirando materiales después, sin saber todavía exactamente cuánto de cada cosa se va a sacar — típico con cemento o acero, donde el precio sube seguido y hay que protegerse de la inflación.',
    ],
  },
  gastos: {
    key: 'gastos',
    label: 'Gastos',
    resumen: 'Egresos a proveedores u otros conceptos, con seguimiento de pendiente/pagado.',
    subsecciones: [
      { nombre: 'Pago único', descripcion: 'Marcar un gasto como pagado de una sola vez, eligiendo la cuenta desde la que salió la plata y la fecha.' },
      { nombre: 'Pago en lote', descripcion: 'Seleccionar varios gastos pendientes y pagarlos todos juntos desde la misma cuenta y fecha, en un solo paso — útil cuando se paga a varios proveedores el mismo día.' },
      { nombre: 'Plan de pago (cuotas/cheques)', descripcion: 'En vez de un pago único, se programan varias cuotas (por ejemplo, una serie de cheques a distintas fechas) — cada cuota se marca pagada por separado a medida que se efectiviza, y puede quedar "rechazada" si un cheque no se cobra.' },
    ],
    decisiones: [
      '¿Pago único, en lote, o plan de pago? Pago único: se paga todo de una vez. Pago en lote: hay varios gastos distintos que se pagan juntos el mismo día. Plan de pago: un solo gasto se va a saldar en varias partes a lo largo del tiempo (ej. varios cheques a fecha).',
    ],
  },
  certificados: {
    key: 'certificados',
    label: 'Contratos de obra y certificados de avance',
    resumen: 'Contratos de una obra de construcción y la certificación de su avance, rubro por rubro.',
    subsecciones: [
      { nombre: 'Contrato con el cliente', descripcion: 'El comitente que paga la obra. Certificar avance acá genera Cobros (plata que entra).' },
      { nombre: 'Contrato con subcontratista', descripcion: 'Un tercero al que se le subcontrata un rubro de la obra. Certificar avance acá genera Gastos (plata que sale). Una obra puede tener el contrato con el cliente y, al mismo tiempo, uno o varios contratos con subcontratistas distintos, cada uno con su propia certificación independiente.' },
      { nombre: 'Certificado de avance', descripcion: 'Por cada período se carga qué porcentaje de cada rubro se avanzó, y el sistema calcula el monto certificado. Pasa por los estados: borrador → presentado → aprobado.' },
    ],
    decisiones: [
      '¿Contrato con el cliente o con subcontratista? Depende de quién paga y quién cobra en esa relación puntual: si la obra le va a cobrar a alguien, es contrato con cliente; si la obra le va a pagar a alguien por un trabajo subcontratado, es con subcontratista.',
    ],
  },
  cobros: {
    key: 'cobros',
    label: 'Cobros',
    resumen: 'Cobros al cliente asociados a los certificados de avance de una obra — puede ser un cobro único o, igual que en Gastos, un plan de cobro en cuotas.',
    subsecciones: [],
  },
  presupuestos: {
    key: 'presupuestos',
    label: 'Presupuestos',
    resumen: 'Cotizaciones por rubro para un cliente, antes de convertirse en un contrato de obra.',
    subsecciones: [],
    decisiones: [
      'Al aceptar un presupuesto se genera automáticamente el contrato de obra correspondiente, con todos sus ítems (rubros y montos) ya cargados — no hace falta volver a tipearlos.',
    ],
  },
  personal: {
    key: 'personal',
    label: 'Personal',
    resumen: 'Personal individual y cuadrillas.',
    subsecciones: [
      { nombre: 'Personal', descripcion: 'Cada persona, con su tipo de contratación, jornal, y la trazabilidad de a qué obra está asignada (y el historial de asignaciones anteriores).' },
      { nombre: 'Cuadrillas', descripcion: 'Agrupación simple de personas para asignarlas juntas a un proyecto de una — no tienen trazabilidad propia (eso vive en cada persona), asignar una cuadrilla completa asigna a todos sus integrantes de una vez.' },
    ],
  },
  contratos: {
    key: 'contratos',
    label: 'Ventas',
    resumen: 'Contratos de venta de una unidad (flujo Desarrollo), con su plan de cuotas.',
    subsecciones: [],
  },
  reservas: {
    key: 'reservas',
    label: 'Reservas',
    resumen: 'Señas sobre una unidad antes de firmar la venta — se pueden convertir en venta después, o caerse y liberar la unidad.',
    subsecciones: [],
  },
  inventario: {
    key: 'inventario',
    label: 'Inventario',
    resumen: 'Maquinaria y equipos de la empresa, con su asignación vigente a una obra y el historial de asignaciones anteriores.',
    subsecciones: [],
  },
  cuentas: {
    key: 'cuentas',
    label: 'Cuentas',
    resumen: 'Cuentas bancarias o cajas donde entra y sale la plata.',
    subsecciones: [],
    decisiones: [
      'Una cuenta puede ser compartida por toda la empresa (pool, visible desde cualquier proyecto) o específica de un proyecto puntual, según cómo esté configurado ese proyecto ("modo de cuentas"). Una cuenta de empresa (sin proyecto asignado) solo la puede crear un administrador.',
    ],
  },
}
