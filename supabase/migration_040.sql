-- ============================================================
-- MIGRATION 040: purgar_obra_completa() no podía eliminar un
-- proyecto CERRADO (obras.estado = 'finalizada').
--
-- trg_bloquear_cerrado (migration_023) protege los datos de un
-- proyecto cerrado de cualquier escritura, a propósito sin excepción
-- para admin — pero eso también bloqueaba los propios DELETE que
-- purgar_obra_completa() necesita para limpiar el proyecto antes de
-- borrar la fila de `obras`. Confirmado en vivo: con la obra activa
-- el borrado funcionaba, cerrada tiraba error (había que reactivarla
-- primero), lo cual contradice el flujo real (cerrar un proyecto y
-- eventualmente eliminarlo más adelante).
--
-- Mismo mecanismo que ya usa purgar_constructora_completa(): setear
-- app.bypass_inmutable en 'true' antes de los DELETE. "Cerrado" es
-- una protección de los datos DE ADENTRO del proyecto; eliminar el
-- proyecto entero es una acción de capa superior (ya gateada aparte:
-- solo admin, ver obras_admin_elimina) que debe poder pasar por
-- encima de esa protección interna.
-- ============================================================

CREATE OR REPLACE FUNCTION purgar_obra_completa(p_obra_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM contratos_venta   WHERE obra_id = p_obra_id;
  DELETE FROM reservas          WHERE obra_id = p_obra_id;
  DELETE FROM unidades          WHERE obra_id = p_obra_id;
  DELETE FROM tipologias        WHERE obra_id = p_obra_id;
  DELETE FROM amenities         WHERE obra_id = p_obra_id;

  DELETE FROM cobros_proyecto     WHERE obra_id = p_obra_id;
  DELETE FROM certificados_avance WHERE obra_id = p_obra_id;
  DELETE FROM contratos_obra      WHERE obra_id = p_obra_id;

  DELETE FROM equipo_asignaciones WHERE obra_id = p_obra_id;
  DELETE FROM gastos              WHERE obra_id = p_obra_id;

  -- cuentas_propias NO se borra: su FK (obra_id ON DELETE SET NULL) la
  -- desvincula sola al llegar al DELETE FROM obras — sobrevive como
  -- cuenta de empresa en vez de perderse (representa un saldo_inicial
  -- real, no un dato de ejecución del proyecto).

  DELETE FROM obras WHERE id = p_obra_id;
END;
$$;
