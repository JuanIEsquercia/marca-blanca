-- ============================================================
-- MIGRATION 024: Vínculo de WhatsApp (Kapso) — un teléfono por constructora
--
-- whatsapp_numeros: mapea el número de WhatsApp Business que RECIBE
-- mensajes (phone_number_id de Kapso) a la constructora dueña. El webhook
-- lo usa para saber en qué tenant buscar antes de mirar quién escribe.
-- Se crea/reemplaza SOLO vía PATCH /api/superadmin/constructoras (acción
-- autenticada del superadmin de la plataforma — sistema white-label, el
-- número lo contrata/asigna la plataforma por tenant, no lo carga el admin
-- de la constructora). El webhook NUNCA escribe esta tabla, solo la lee
-- para validar que un código se redime en el número correcto. Si el
-- webhook pudiera crear el vínculo a partir de un mensaje entrante, un
-- código robado/adivinado se podría redimir en cualquier número (incluso
-- el público de la propia constructora atacada) y secuestrar la cuenta
-- reasignando su admin.telefono — ver auditoría 2026-07-13.
--
-- perfiles.telefono: el ÚNICO teléfono personal autorizado a operar por
-- WhatsApp para esa constructora — decisión de producto: un teléfono por
-- constructora, no uno por operador. Las dos constraints de abajo hacen
-- cumplir esto en ambos sentidos (una constructora no puede tener dos
-- teléfonos vinculados, y un teléfono no puede estar vinculado a dos
-- constructoras).
--
-- whatsapp_vinculos_pendientes: código de un solo uso generado desde el
-- panel (sesión ya autenticada, sabemos constructora_id + perfil_id) que
-- el admin confirma escribiéndolo por WhatsApp AL NÚMERO YA CONFIGURADO
-- de su constructora (whatsapp_numeros). El webhook rechaza el código si
-- el número receptor no está configurado o pertenece a otra constructora.
--
-- RLS: sin policies para 'authenticated' — estas tablas solo se tocan
-- server-side con el admin client (service role), igual que perfil_proyectos
-- vía API routes (/api/admin/whatsapp, /api/whatsapp/webhook).
--
-- Idempotente.
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================

ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS telefono TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_perfiles_telefono_por_constructora
  ON perfiles (constructora_id) WHERE telefono IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_perfiles_telefono_unico
  ON perfiles (telefono) WHERE telefono IS NOT NULL;

CREATE TABLE IF NOT EXISTS whatsapp_numeros (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id UUID NOT NULL REFERENCES constructoras(id) ON DELETE CASCADE,
  kapso_phone_id  TEXT NOT NULL UNIQUE,
  numero          TEXT,
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE whatsapp_numeros ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS whatsapp_vinculos_pendientes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id UUID NOT NULL REFERENCES constructoras(id) ON DELETE CASCADE,
  perfil_id       UUID NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  codigo          TEXT NOT NULL,
  expira_en       TIMESTAMPTZ NOT NULL,
  usado_en        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_vinculos_codigo
  ON whatsapp_vinculos_pendientes (codigo) WHERE usado_en IS NULL;

ALTER TABLE whatsapp_vinculos_pendientes ENABLE ROW LEVEL SECURITY;
