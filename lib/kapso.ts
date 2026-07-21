import crypto from 'crypto'

const KAPSO_API_BASE = 'https://api.kapso.ai/meta/whatsapp/v24.0'

// Verifica X-Webhook-Signature: HMAC-SHA256 del body crudo (no el JSON
// parseado), comparado con timing-safe compare para evitar timing attacks.
export function verificarFirmaWebhook(rawBody: string, firma: string | null): boolean {
  const secret = process.env.KAPSO_WEBHOOK_SECRET
  if (!secret || !firma) return false

  const esperada = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const bufFirma = Buffer.from(firma)
  const bufEsperada = Buffer.from(esperada)
  if (bufFirma.length !== bufEsperada.length) return false
  return crypto.timingSafeEqual(bufFirma, bufEsperada)
}

async function enviarPayload(phoneNumberId: string, payload: Record<string, unknown>): Promise<void> {
  const apiKey = process.env.KAPSO_API_KEY
  if (!apiKey) {
    throw new Error('Kapso no configurado. Revisá KAPSO_API_KEY en .env.local')
  }

  const res = await fetch(`${KAPSO_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const detalle = await res.text()
    throw new Error(`Kapso rechazó el envío (${res.status}): ${detalle}`)
  }
}

export async function enviarMensajeWhatsapp(params: {
  phoneNumberId: string
  to: string
  body: string
  replyToMessageId?: string
}): Promise<void> {
  return enviarPayload(params.phoneNumberId, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.to,
    type: 'text',
    ...(params.replyToMessageId ? { context: { message_id: params.replyToMessageId } } : {}),
    text: { body: params.body, preview_url: false },
  })
}

// Lista nativa de WhatsApp — navegación por tap, sin ambigüedad de texto
// libre. Máx. 10 filas por sección (límite de WhatsApp).
export async function enviarListaWhatsapp(params: {
  phoneNumberId: string
  to: string
  texto: string
  tituloBoton: string
  filas: { id: string; title: string; description?: string }[]
}): Promise<void> {
  return enviarPayload(params.phoneNumberId, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: params.texto },
      action: {
        button: params.tituloBoton,
        sections: [{ title: 'Opciones', rows: params.filas }],
      },
    },
  })
}

// Botones nativos — máx. 3 por mensaje (límite de WhatsApp). Usado para
// confirmar/cancelar una escritura antes de que impacte la base.
export async function enviarBotonesWhatsapp(params: {
  phoneNumberId: string
  to: string
  texto: string
  botones: { id: string; title: string }[]
}): Promise<void> {
  return enviarPayload(params.phoneNumberId, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: params.texto },
      action: {
        buttons: params.botones.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
      },
    },
  })
}
