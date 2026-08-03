-- ------------------------------------------------------------
-- Auditoría de consistencia (3/4): contratos_venta no tenía estado
-- (vigente/rescindido) como sí tiene contratos_obra — la única forma de
-- cancelar una venta era un DELETE físico que además borraba las
-- cuotas (perdiendo el historial de pagos). Se agrega estado, mismo
-- criterio que "Cerrar proyecto": rescindir preserva todo en modo
-- solo lectura en vez de borrarlo. El DELETE físico sigue existiendo
-- para contratos mal cargados (protegido por proteger_contrato_con_cobros
-- para no-admins cuando ya hay cobros reales).
-- ------------------------------------------------------------
ALTER TABLE contratos_venta
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'rescindido'));
