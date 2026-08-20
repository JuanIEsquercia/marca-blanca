-- ------------------------------------------------------------
-- migration_070.sql — límite mensual de uso del chat, por constructora
-- (decisión del usuario 2026-08-20: alcance = tenant, no por usuario;
-- ventana = mensual; comportamiento al llegar al tope = bloquear el chat
-- hasta el próximo mes). $100/mes es un default de arranque para calibrar
-- contra datos reales de chat_uso (migration_069.sql) — no un número
-- derivado de uso real todavía. Ajustable por fila sin código nuevo
-- (falta la UI de admin para editarlo, se hace a mano por ahora).
-- ------------------------------------------------------------
ALTER TABLE constructoras ADD COLUMN IF NOT EXISTS chat_limite_mensual_usd NUMERIC(10,2) NOT NULL DEFAULT 100.00;
