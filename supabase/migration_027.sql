-- ============================================================
-- MIGRATION 027: WhatsApp Flows — formulario nativo para "Cobro de obra"
--
-- Reemplaza el step-machine de texto (whatsapp_borradores, tipo='cobro')
-- por un WhatsApp Flow: una sola pantalla con todos los campos, en vez de
-- 4 mensajes de ida y vuelta (monto -> moneda -> proyecto -> cuenta ->
-- confirmar). El Flow se abre desde el mismo menú de acciones de siempre.
--
-- whatsapp_flow_sesiones: a diferencia de whatsapp_borradores (que guarda
-- el paso actual porque el texto libre necesita memoria server-side entre
-- mensajes), acá el ESTADO del formulario lo guarda WhatsApp del lado del
-- cliente — nosotros solo necesitamos saber A QUIÉN pertenece cada
-- data_exchange que llega al endpoint. El endpoint de un Flow (a diferencia
-- del webhook normal) NO recibe el teléfono del remitente, solo
-- flow.id + data_exchange.flow_token — por eso flow_token es la PK acá:
-- lo generamos nosotros al enviar el Flow (no lo asigna WhatsApp) y viaja
-- en cada intercambio, incluida la finalización.
--
-- flow_id_cobro en whatsapp_numeros: en Kapso los Flows se publican POR
-- NÚMERO (WABA aislada por tenant, confirmado en el dashboard: al crear un
-- Flow te pide elegir a qué número asignarlo) — no hay un flow_id global
-- para toda la plataforma. Mismo patrón que kapso_phone_id/numero: lo
-- carga el superadmin en /api/superadmin/constructoras, el admin de la
-- constructora no lo toca.
--
-- RLS: sin policies para 'authenticated' — solo se toca desde
-- app/api/whatsapp/flow/route.ts y el webhook con el admin client (service
-- role), mismo patrón que whatsapp_borradores/whatsapp_numeros.
--
-- Idempotente.
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================

ALTER TABLE whatsapp_numeros ADD COLUMN IF NOT EXISTS flow_id_cobro TEXT;

CREATE TABLE IF NOT EXISTS whatsapp_flow_sesiones (
  flow_token      TEXT PRIMARY KEY,
  perfil_id       UUID NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  constructora_id UUID NOT NULL REFERENCES constructoras(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL,
  expira_en       TIMESTAMPTZ NOT NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_flow_sesiones_expira
  ON whatsapp_flow_sesiones (expira_en);

ALTER TABLE whatsapp_flow_sesiones ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- SELECT flow_id_cobro FROM whatsapp_numeros — debe existir la columna (NULL hasta que el superadmin la cargue).
-- SELECT * FROM whatsapp_flow_sesiones — vacía hasta el primer Flow enviado.
