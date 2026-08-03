-- ------------------------------------------------------------
-- Fix encontrado corriendo un test de integración real (creando y
-- purgando una constructora de prueba): purgar_constructora_completa()
-- falló al intentar borrar un contratos_venta con una cuota ya Pagada,
-- con el mismo error que ve un no-admin ("...solo un admin puede
-- hacerlo") pese a que la función ya seteaba app.bypass_inmutable — la
-- versión efectivamente corrida en producción no tenía ese bypass
-- (quedó desactualizada respecto de este archivo en algún momento).
-- Se re-aplica acá para que la base viva quede sincronizada.
--
-- De paso: la versión más reciente de purgar_constructora_completa()
-- (migration_052, cuando se sumó Compras) se armó copiando una base
-- vieja de la función y sin querer dejó afuera personal/cuadrillas/
-- rubros (sumados en migration_038/046) — se restauran acá.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION proteger_contrato_con_cobros()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_tiene_cuotas_pagadas BOOLEAN;
BEGIN
  IF es_admin() OR current_setting('app.bypass_inmutable', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM cuotas WHERE contrato_id = OLD.id AND estado_pago = 'Pagado'
  ) INTO v_tiene_cuotas_pagadas;

  IF NOT v_tiene_cuotas_pagadas AND COALESCE(OLD.entrega_efectiva, 0) = 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'No se puede eliminar: el contrato ya tiene cobros registrados (entrega y/o cuotas pagadas) y solo un admin puede hacerlo.';
  END IF;

  RAISE EXCEPTION 'No se puede editar: el contrato ya tiene cobros registrados (entrega y/o cuotas pagadas) y solo un admin puede hacerlo.';
END;
$$;

ALTER FUNCTION proteger_contrato_con_cobros() SET search_path = public;

CREATE OR REPLACE FUNCTION purgar_constructora_completa(p_constructora_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM stock_movimientos WHERE constructora_id = p_constructora_id;
  DELETE FROM ordenes_compra    WHERE constructora_id = p_constructora_id;
  DELETE FROM productos         WHERE constructora_id = p_constructora_id;

  DELETE FROM cobros_proyecto   WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_obra    WHERE constructora_id = p_constructora_id;
  DELETE FROM presupuestos      WHERE constructora_id = p_constructora_id;
  DELETE FROM equipos           WHERE constructora_id = p_constructora_id;
  DELETE FROM personal          WHERE constructora_id = p_constructora_id;
  DELETE FROM cuadrillas        WHERE constructora_id = p_constructora_id;
  DELETE FROM rubros            WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_venta   WHERE constructora_id = p_constructora_id;
  DELETE FROM reservas          WHERE constructora_id = p_constructora_id;
  DELETE FROM gastos            WHERE constructora_id = p_constructora_id;
  DELETE FROM compradores       WHERE constructora_id = p_constructora_id;
  DELETE FROM unidades          WHERE constructora_id = p_constructora_id;
  DELETE FROM proveedores       WHERE constructora_id = p_constructora_id;
  DELETE FROM categorias_costo  WHERE constructora_id = p_constructora_id;
  DELETE FROM cuentas_propias   WHERE constructora_id = p_constructora_id;
  DELETE FROM tipologias        WHERE constructora_id = p_constructora_id;
  DELETE FROM amenities         WHERE constructora_id = p_constructora_id;
  DELETE FROM auditoria         WHERE constructora_id = p_constructora_id;
  DELETE FROM constructoras     WHERE id = p_constructora_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION purgar_constructora_completa(UUID) FROM PUBLIC, authenticated, anon;
