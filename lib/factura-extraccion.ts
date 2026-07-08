import Anthropic from '@anthropic-ai/sdk'

export interface FacturaExtraida {
  descripcion: string | null
  monto: number | null
  moneda: 'ARS' | 'USD' | null
  fecha: string | null
  numero_comprobante: string | null
  proveedor_razon_social: string | null
  proveedor_cuit: string | null
  monto_neto: number | null
  iva: number | null
  percepciones: number | null
}

const EXTRACCION_TOOL: Anthropic.Tool = {
  name: 'extraer_factura',
  description: 'Registra los datos extraídos de una factura o comprobante argentino.',
  input_schema: {
    type: 'object',
    properties: {
      descripcion: { type: ['string', 'null'], description: 'Breve descripción del gasto (ej: "Compra de hierro ø12", concepto principal de la factura)' },
      monto: { type: ['number', 'null'], description: 'Monto TOTAL de la factura, tal cual figura impreso (no recalcular a partir de neto+IVA)' },
      moneda: { type: ['string', 'null'], enum: ['ARS', 'USD', null], description: 'Moneda de la factura. Por defecto ARS salvo que figure U$D/USD explícitamente' },
      fecha: { type: ['string', 'null'], description: 'Fecha de la factura en formato YYYY-MM-DD' },
      numero_comprobante: { type: ['string', 'null'], description: 'Número de comprobante tal cual figura impreso (ej: "Factura A 0001-00012345")' },
      proveedor_razon_social: { type: ['string', 'null'], description: 'Razón social del emisor de la factura' },
      proveedor_cuit: { type: ['string', 'null'], description: 'CUIT del emisor, solo dígitos (sin guiones ni espacios)' },
      monto_neto: { type: ['number', 'null'], description: 'Importe neto gravado (subtotal antes de impuestos), si figura desglosado' },
      iva: { type: ['number', 'null'], description: 'Monto de IVA, si figura desglosado' },
      percepciones: { type: ['number', 'null'], description: 'Suma de percepciones (IIBB, etc.), si figuran desglosadas' },
    },
    required: ['descripcion', 'monto', 'moneda', 'fecha', 'numero_comprobante', 'proveedor_razon_social', 'proveedor_cuit', 'monto_neto', 'iva', 'percepciones'],
    additionalProperties: false,
  },
}

function campoVacio(): FacturaExtraida {
  return {
    descripcion: null, monto: null, moneda: null, fecha: null, numero_comprobante: null,
    proveedor_razon_social: null, proveedor_cuit: null, monto_neto: null, iva: null, percepciones: null,
  }
}

export async function extraerDatosFactura(url: string): Promise<FacturaExtraida> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('Anthropic no configurado. Revisá ANTHROPIC_API_KEY en .env.local')
  }

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error('No se pudo descargar la imagen del comprobante para analizarla')
  }
  const contentType = res.headers.get('content-type') ?? 'image/jpeg'
  const buffer = Buffer.from(await res.arrayBuffer())
  const data = buffer.toString('base64')

  const client = new Anthropic({ apiKey })

  const documentBlock: Anthropic.ContentBlockParam = contentType.includes('pdf')
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: contentType as 'image/jpeg' | 'image/png' | 'image/webp', data } }

  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    tools: [EXTRACCION_TOOL],
    tool_choice: { type: 'tool', name: 'extraer_factura' },
    messages: [
      {
        role: 'user',
        content: [
          documentBlock,
          { type: 'text', text: 'Extraé los datos de esta factura o comprobante de gasto argentino usando la herramienta extraer_factura. Si un campo no es legible o no figura, dejalo en null — no inventes valores.' },
        ],
      },
    ],
  })

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!toolUse) return campoVacio()

  return { ...campoVacio(), ...(toolUse.input as Partial<FacturaExtraida>) }
}
