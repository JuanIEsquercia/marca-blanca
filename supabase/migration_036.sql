-- ============================================================
-- MIGRATION 036:
-- 1. Backfill de contratos_obra.monto_total para contratos que ya
--    quedaron desincronizados antes de que existiera el trigger de
--    migration_035 (trg_recalcular_monto_total_contrato) — un
--    trigger nuevo NUNCA recalcula datos históricos por sí solo, solo
--    dispara con el próximo INSERT/UPDATE/DELETE. Confirmado en vivo:
--    un contrato con 3 ítems sumando $15.930 seguía en monto_total
--    $10.250 (el monto del presupuesto antes del adicional) porque el
--    adicional se cargó antes de correr esa migración.
-- 2. contrato_obra_items.origen amplía su CHECK para incluir 'directo'
--    — ítems cargados al crear un contrato manualmente (sin
--    presupuesto de origen), que a partir de ahora también se arma
--    por ítems en vez de un monto_total tipeado a mano (ver el nuevo
--    formulario en CertificadosManager.tsx). Unifica los dos caminos
--    que hoy conviven (presupuesto→contrato vs. contrato manual) en
--    un solo esquema: TODO contrato de obra tiene sus ítems, y
--    monto_total siempre es derivado, nunca tipeado.
--
-- Idempotente.
-- ============================================================

-- 1. Backfill — recalcula monto_total para todo contrato que ya
--    tenga ítems cargados (no toca los que siguen sin ítems, el
--    flujo viejo que aún puede existir en datos de prueba).
UPDATE contratos_obra co
SET monto_total = sub.total
FROM (
  SELECT contrato_obra_id, COALESCE(SUM(monto_contratado), 0) AS total
  FROM contrato_obra_items
  GROUP BY contrato_obra_id
) sub
WHERE co.id = sub.contrato_obra_id
  AND co.monto_total IS DISTINCT FROM sub.total;

-- 2. origen amplía a 'directo'
ALTER TABLE contrato_obra_items DROP CONSTRAINT IF EXISTS contrato_obra_items_origen_check;
ALTER TABLE contrato_obra_items ADD CONSTRAINT contrato_obra_items_origen_check
  CHECK (origen IN ('presupuesto', 'adicional', 'directo'));
