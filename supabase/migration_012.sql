-- ============================================================
-- MIGRATION 012: obras.modo_cuentas
-- Persiste la decisión de cuentas tomada al crear el proyecto.
-- Idempotente — seguro de ejecutar múltiples veces.
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================

-- Columna que indica si el proyecto usa cuentas de empresa
-- (compartidas, obra_id IS NULL) o cuentas específicas del proyecto
-- (obra_id = obras.id). Default 'empresa' para proyectos existentes.

ALTER TABLE obras
  ADD COLUMN IF NOT EXISTS modo_cuentas TEXT NOT NULL DEFAULT 'empresa'
  CHECK (modo_cuentas IN ('empresa', 'especificas'));

-- Backfill: si una obra ya tiene cuentas_propias con obra_id asignado,
-- marcamos como 'especificas'.
UPDATE obras o
SET modo_cuentas = 'especificas'
WHERE EXISTS (
  SELECT 1 FROM cuentas_propias c
  WHERE c.obra_id = o.id
);
