// Kapso Function — proxy del data endpoint de los WhatsApp Flows.
//
// NO tiene lógica de negocio. Kapso ya desencriptó el data_exchange del
// Flow para cuando esto se ejecuta; esta función solo lo reenvía, firmado,
// a nuestro propio backend (app/api/whatsapp/flow/route.ts), donde vive
// toda la lógica real (permisos, cuentas, registrarCobro/registrarGasto).
//
// Es UNA sola función, compartida por los 5 Flows (uno por constructora) —
// no hace falta una por tenant, porque no toma ninguna decisión de negocio,
// solo reenvía.
//
// CÓMO DESPLEGAR (Kapso: Build > Functions):
//   1. Crear una función nueva, pegar este código como handler.
//   2. En la pestaña "Secrets" de la función, cargar:
//        WHATSAPP_FLOW_INTERNAL_SECRET = <un secreto random, ej. openssl rand -hex 32>
//        APP_FLOW_ENDPOINT_URL         = https://<tu-dominio>/api/whatsapp/flow
//      (el mismo valor de WHATSAPP_FLOW_INTERNAL_SECRET va en el .env de la
//      app, en Vercel, como WHATSAPP_FLOW_INTERNAL_SECRET — así el endpoint
//      puede verificar la firma con verificarFirmaFlowInterno de lib/kapso.ts)
//   3. Deployar la función (dashboard o API — el CLI de Kapso todavía no
//      administra funciones).
//   4. En cada Flow (WhatsApp > Flows, uno por número/constructora),
//      configurar su "Data endpoint" apuntando a ESTA función ya deployada.

async function hmacHex(secret, mensaje) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const firma = await crypto.subtle.sign('HMAC', key, enc.encode(mensaje))
  return Array.from(new Uint8Array(firma)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function handler(request, env) {
  const rawBody = await request.text()

  if (!env.WHATSAPP_FLOW_INTERNAL_SECRET || !env.APP_FLOW_ENDPOINT_URL) {
    return new Response(
      JSON.stringify({ version: '3.0', screen: 'COBRO_FORM', data: { error_message: 'Función mal configurada (faltan secrets).' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const firma = await hmacHex(env.WHATSAPP_FLOW_INTERNAL_SECRET, rawBody)

  try {
    const res = await fetch(env.APP_FLOW_ENDPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Signature': firma },
      body: rawBody,
    })
    const texto = await res.text()
    return new Response(texto, { status: res.status, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    // Meta espera 200 con {version, screen, data} incluso ante un error —
    // devolver un error HTTP real deja al usuario con el Flow colgado.
    return new Response(
      JSON.stringify({ version: '3.0', screen: 'COBRO_FORM', data: { error_message: 'No se pudo conectar con el servidor. Probá de nuevo en un rato.' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
