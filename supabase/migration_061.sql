-- ------------------------------------------------------------
-- Índices faltantes encontrados al revisar rendimiento: contratos_venta.
-- estado (columna nueva de esta sesión, migration_058) y cobros_proyecto.
-- estado se filtran todo el tiempo (tesorería, caja, dashboard, ingresos)
-- y no tenían índice — sin impacto hoy con pocas filas, pero se degrada
-- a medida que crece cada constructora. Mismo criterio que los índices
-- parciales ya existentes en cuotas (idx_cuotas_pendientes_vencimiento/
-- idx_cuotas_pagado).
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_contratos_venta_estado ON contratos_venta(estado);
CREATE INDEX IF NOT EXISTS idx_cobros_proyecto_estado ON cobros_proyecto(estado);
