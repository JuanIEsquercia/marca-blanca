-- ------------------------------------------------------------
-- Simetría con gastos: cobros_proyecto suma el mismo desglose contable
-- (monto_neto/iva/percepciones/numero_comprobante/comprobante_url) que
-- gastos ya tenía. Igual criterio: informativos, no afectan ningún
-- cálculo de tesorería/caja — el que manda sigue siendo `monto`.
-- Habilita, además, generar el cobro/gasto directo desde un certificado
-- de avance con una calculadora de IVA (neto × (1 + %) = total).
-- ------------------------------------------------------------
ALTER TABLE cobros_proyecto
  ADD COLUMN IF NOT EXISTS monto_neto         DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS iva                DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS percepciones       DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS numero_comprobante TEXT,
  ADD COLUMN IF NOT EXISTS comprobante_url    TEXT;
