-- ============================================================
-- MIGRATION 051: índices compuestos faltantes para los filtros por
-- estado más frecuentes del panel (auditoría de performance 2026-07-28).
--
-- gastos: casi toda query de tesorería/caja/gastos filtra
-- constructora_id (o obra_id) + estado ('Pagado'/'Pendiente') juntos
-- (lib/tesoreria.ts, app/admin/gastos/page.tsx, app/admin/tesoreria/page.tsx,
-- app/admin/proyectos/[obraId]/caja/page.tsx) — hasta ahora solo existían
-- idx_gastos_constructora e idx_gastos_obra (columna única, migration_007
-- y migration_039), sin cubrir el filtro combinado con estado.
--
-- cuotas: idx_cuotas_pendientes_vencimiento (migration_004) es un índice
-- parcial que SOLO cubre estado_pago = 'Pendiente' — los mismos archivos
-- de arriba filtran igual de seguido por estado_pago = 'Pagado' (para
-- sumar saldos ya cobrados) y esa consulta hacía full scan. Se agrega el
-- espejo parcial para 'Pagado' sin tocar el índice existente.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_gastos_constructora_estado
  ON gastos(constructora_id, estado);

CREATE INDEX IF NOT EXISTS idx_gastos_obra_estado
  ON gastos(obra_id, estado)
  WHERE obra_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cuotas_pagado
  ON cuotas(estado_pago)
  WHERE estado_pago = 'Pagado';
