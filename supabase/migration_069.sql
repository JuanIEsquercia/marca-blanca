-- ------------------------------------------------------------
-- migration_069.sql — chat_uso: registro de consumo de tokens del
-- asistente conversacional (lib/chat/agente.ts), un renglón por cada
-- llamada real a la API de Anthropic (una conversación puede generar
-- varias si el modelo encadena tools de solo lectura antes de responder).
-- Es el primer paso de "calcular el consumo" — todavía no hay ningún
-- límite/bloqueo que lo use, solo el registro. La política de límites
-- (por usuario, por tenant, ventana de tiempo) se decide después de tener
-- datos reales para calibrar contra.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_uso (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id         UUID NOT NULL REFERENCES constructoras(id),
  perfil_id               UUID NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  modelo                  TEXT NOT NULL,
  tokens_entrada          INTEGER NOT NULL DEFAULT 0,
  tokens_salida           INTEGER NOT NULL DEFAULT 0,
  tokens_cache_lectura    INTEGER NOT NULL DEFAULT 0,
  tokens_cache_escritura  INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_uso_constructora_fecha ON chat_uso(constructora_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_uso_perfil_fecha        ON chat_uso(perfil_id, created_at);

ALTER TABLE chat_uso ENABLE ROW LEVEL SECURITY;

-- Un usuario solo inserta sus propias filas (el servidor las genera con su
-- propio perfil_id, nunca a nombre de otro). Lectura: cada uno ve su propio
-- consumo, y un admin ve el de toda su constructora (para un futuro panel
-- de consumo agregado por tenant).
DROP POLICY IF EXISTS "chat_uso_insert_propio" ON chat_uso;
CREATE POLICY "chat_uso_insert_propio" ON chat_uso
  FOR INSERT TO authenticated
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras())
    AND perfil_id = auth.uid()
  );

DROP POLICY IF EXISTS "chat_uso_select" ON chat_uso;
CREATE POLICY "chat_uso_select" ON chat_uso
  FOR SELECT TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras())
    AND (perfil_id = auth.uid() OR es_admin())
  );
