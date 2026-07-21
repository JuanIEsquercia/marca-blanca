-- ============================================================
-- MIGRATION 025: Borrador de acción en curso por WhatsApp
--
-- El flujo de "Consultar caja" es 100% stateless (cada opción de lista
-- lleva su propio id, no hace falta recordar en qué paso está el usuario).
-- Pero "Registrar gasto" necesita texto libre (monto, descripción), así
-- que sí hace falta memoria server-side: una fila por perfil con el paso
-- actual y los datos acumulados hasta confirmar o cancelar.
--
-- Un solo borrador activo por perfil (perfil_id es PK) — si el usuario
-- arranca una acción nueva, pisa cualquier borrador anterior sin terminar.
--
-- RLS: sin policies para 'authenticated' — solo se toca desde el webhook
-- con el admin client (service role), mismo patrón que whatsapp_numeros.
--
-- Idempotente.
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_borradores (
  perfil_id       UUID PRIMARY KEY REFERENCES perfiles(id) ON DELETE CASCADE,
  constructora_id UUID NOT NULL REFERENCES constructoras(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL,
  paso            TEXT NOT NULL,
  datos           JSONB NOT NULL DEFAULT '{}',
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE whatsapp_borradores ENABLE ROW LEVEL SECURITY;
