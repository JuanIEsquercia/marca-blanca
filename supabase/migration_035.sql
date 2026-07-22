-- ============================================================
-- MIGRATION 035: contratos_obra.monto_total no se actualizaba al
-- agregar un "adicional" de obra.
--
-- aceptar_presupuesto() (migration_031) fija monto_total UNA sola vez
-- al aceptar (suma de los ítems del presupuesto), pero después, cargar
-- un adicional desde Certificados solo insertaba una fila más en
-- contrato_obra_items — nada volvía a sumar ese monto al total del
-- contrato. Resultado: validar_monto_certificado() (que compara contra
-- monto_total) seguía usando el techo viejo, así que un adicional de
-- $20 sobre un presupuesto de $100 no habilitaba certificar más de
-- $100 en total — el usuario lo detectó al intentar certificar más
-- allá del presupuesto original.
--
-- Fix: monto_total pasa a recalcularse solo (SUM de contrato_obra_items)
-- cada vez que esa tabla cambia — mismo patrón que
-- recalcular_monto_certificado (migration_031) para el certificado. No
-- afecta contratos SIN ítems (el flujo viejo, monto_total tipeado a
-- mano): el trigger vive en contrato_obra_items, que esos contratos
-- nunca tienen filas ahí.
--
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION recalcular_monto_total_contrato()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_contrato_id UUID := COALESCE(NEW.contrato_obra_id, OLD.contrato_obra_id);
  v_total       NUMERIC(15,2);
BEGIN
  SELECT COALESCE(SUM(monto_contratado), 0) INTO v_total
  FROM contrato_obra_items WHERE contrato_obra_id = v_contrato_id;

  PERFORM set_config('app.bypass_inmutable', 'true', true);
  UPDATE contratos_obra SET monto_total = v_total WHERE id = v_contrato_id;
  PERFORM set_config('app.bypass_inmutable', 'false', true);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recalcular_monto_total_contrato ON contrato_obra_items;
CREATE TRIGGER trg_recalcular_monto_total_contrato
  AFTER INSERT OR UPDATE OR DELETE ON contrato_obra_items
  FOR EACH ROW EXECUTE FUNCTION recalcular_monto_total_contrato();
