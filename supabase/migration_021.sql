-- ============================================================
-- MIGRATION 021: Desglose impositivo informativo en gastos
--
-- Se agregan monto_neto / iva / percepciones a gastos, pensados
-- para completarse automáticamente al escanear una factura (OCR
-- con Claude vision). Son columnas puramente informativas: monto
-- sigue siendo el total real y la única fuente para los cálculos
-- de tesorería/caja — no se toca ningún cálculo existente.
-- Idempotente — seguro de ejecutar múltiples veces.
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS monto_neto    DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS iva           DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS percepciones  DECIMAL(15,2);
