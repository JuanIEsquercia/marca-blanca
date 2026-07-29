-- ------------------------------------------------------------
-- Fix: purgar_obra_completa() no borraba personal_asignaciones antes de
-- borrar la obra. Quedó afuera cuando migration_038 (Personal y cuadrillas)
-- sumó la tabla — sí actualizó purgar_constructora_completa (ahí
-- personal_asignaciones cae en cascada al borrar personal), pero no
-- purgar_obra_completa, que borra por obra_id sin tocar personal.
-- Causaba: "update or delete on table obras violates foreign key
-- constraint personal_asignaciones_obra_id_fkey" al eliminar un proyecto
-- con personal asignado (histórico o vigente).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION purgar_obra_completa(p_obra_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM stock_movimientos WHERE obra_id = p_obra_id;
  DELETE FROM ordenes_compra    WHERE obra_id = p_obra_id;

  DELETE FROM contratos_venta   WHERE obra_id = p_obra_id;
  DELETE FROM reservas          WHERE obra_id = p_obra_id;
  DELETE FROM unidades          WHERE obra_id = p_obra_id;
  DELETE FROM tipologias        WHERE obra_id = p_obra_id;
  DELETE FROM amenities         WHERE obra_id = p_obra_id;

  DELETE FROM cobros_proyecto     WHERE obra_id = p_obra_id;
  DELETE FROM certificados_avance WHERE obra_id = p_obra_id;
  DELETE FROM contratos_obra      WHERE obra_id = p_obra_id;

  DELETE FROM equipo_asignaciones   WHERE obra_id = p_obra_id;
  DELETE FROM personal_asignaciones WHERE obra_id = p_obra_id;
  DELETE FROM gastos                WHERE obra_id = p_obra_id;

  -- cuentas_propias NO se borra: su FK (obra_id ON DELETE SET NULL) la
  -- desvincula sola al llegar al DELETE FROM obras — sobrevive como
  -- cuenta de empresa en vez de perderse (representa un saldo_inicial
  -- real, no un dato de ejecución del proyecto).

  DELETE FROM obras WHERE id = p_obra_id;
END;
$$;
