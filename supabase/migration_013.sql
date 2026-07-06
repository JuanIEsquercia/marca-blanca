-- ============================================================
-- MIGRATION 013: Flujo obra — reestructura cobros_proyecto
-- Separa el ciclo del certificado (documento) del ciclo de pago
-- Idempotente — seguro de ejecutar múltiples veces.
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================


-- ============================================================
-- PASO 1: cobros_proyecto — agregar fecha_vencimiento, fecha_pago,
--         estado y numero.
-- El campo 'fecha' existente pasará a ser fecha_vencimiento (backfill).
-- ============================================================

ALTER TABLE cobros_proyecto
  ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE,
  ADD COLUMN IF NOT EXISTS fecha_pago        DATE,
  ADD COLUMN IF NOT EXISTS numero            INTEGER,
  ADD COLUMN IF NOT EXISTS estado            TEXT NOT NULL DEFAULT 'cobrado'
    CHECK (estado IN ('pendiente', 'cobrado'));

-- Backfill: todos los cobros existentes tenían 'fecha' = fecha de cobro efectivo.
-- Los marcamos cobrado y copiamos fecha a ambas columnas.
UPDATE cobros_proyecto
SET
  fecha_vencimiento = fecha,
  fecha_pago        = fecha,
  estado            = 'cobrado'
WHERE fecha_vencimiento IS NULL;


-- ============================================================
-- PASO 2: certificados_avance — quitar 'cobrado' del estado.
-- El ciclo de pago ahora vive en cobros_proyecto.estado.
-- ============================================================

-- Migrar registros cobrado → aprobado antes de modificar constraint
UPDATE certificados_avance
SET estado = 'aprobado'
WHERE estado = 'cobrado';

ALTER TABLE certificados_avance
  DROP CONSTRAINT IF EXISTS certificados_avance_estado_check;

ALTER TABLE certificados_avance
  ADD CONSTRAINT certificados_avance_estado_check
  CHECK (estado IN ('borrador', 'presentado', 'aprobado'));


-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- SELECT id, estado, fecha, fecha_vencimiento, fecha_pago FROM cobros_proyecto LIMIT 5;
-- SELECT id, estado FROM certificados_avance LIMIT 5;
