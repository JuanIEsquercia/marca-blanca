-- ------------------------------------------------------------
-- Auditoría de consistencia (2/4): cuotas (cobros de venta de unidades)
-- no tenía el desglose contable que cobros_proyecto/gastos ya tienen.
-- Mismo criterio: informativo, no afecta ningún cálculo de tesorería/caja.
-- ------------------------------------------------------------
ALTER TABLE cuotas
  ADD COLUMN IF NOT EXISTS monto_neto         DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS iva                DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS percepciones       DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS numero_comprobante TEXT,
  ADD COLUMN IF NOT EXISTS comprobante_url    TEXT;
