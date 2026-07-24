-- ============================================================
-- MIGRATION 042: eliminar presupuesto ya no se limita a 'borrador'.
--
-- Decisión de producto (revisada respecto a migration_041): no tiene
-- sentido mantener para siempre presupuestos rechazados o aceptados
-- de años atrás. Sigue siendo admin-only. Es seguro en cualquier
-- estado: contratos_obra.presupuesto_id es ON DELETE SET NULL (ver
-- schema.sql), así que borrar un presupuesto "aceptado" que ya generó
-- un contrato/proyecto NO afecta ese contrato — solo pierde el
-- vínculo histórico hacia el presupuesto original.
-- ============================================================

DROP POLICY IF EXISTS "presupuestos_admin_elimina" ON presupuestos;

CREATE POLICY "presupuestos_admin_elimina" ON presupuestos
  FOR DELETE TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()) AND es_admin());
