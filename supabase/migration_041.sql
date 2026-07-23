-- ============================================================
-- MIGRATION 041: eliminar un presupuesto queda restringido a admin
-- (y solo en estado 'borrador', para mantener registro histórico
-- una vez que se envía/acepta/rechaza).
--
-- Antes, "presupuestos_tenant" era FOR ALL con un solo chequeo
-- (tiene_permiso('presupuestos')), así que cualquier operador con el
-- módulo Presupuestos asignado podía borrar un presupuesto — la UI
-- ocultaba el botón fuera de 'borrador', pero nada lo impedía a nivel
-- de base si se llamaba a Supabase directo (mismo patrón de gap ya
-- corregido para `obras` en migration_028: no alcanza con ocultar el
-- botón, una policy FOR ALL no se puede "restringir" agregando otra
-- policy encima — Postgres combina policies permisivas con OR, hay
-- que separar por comando).
-- ============================================================

DROP POLICY IF EXISTS "presupuestos_tenant" ON presupuestos;

CREATE POLICY "presupuestos_ve" ON presupuestos
  FOR SELECT TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('presupuestos'));

CREATE POLICY "presupuestos_crea" ON presupuestos
  FOR INSERT TO authenticated
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('presupuestos'));

CREATE POLICY "presupuestos_actualiza" ON presupuestos
  FOR UPDATE TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('presupuestos'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('presupuestos'));

CREATE POLICY "presupuestos_admin_elimina" ON presupuestos
  FOR DELETE TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()) AND es_admin() AND estado = 'borrador');
