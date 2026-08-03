-- ------------------------------------------------------------
-- Dos fixes del módulo de Compras encontrados en auditoría (2026-08-03):
--
-- 1) confirmar_recepcion_compra() calculaba el monto del gasto como
--    neto + IVA, ignorando `percepciones` — aunque esa columna se carga y
--    se muestra en el formulario. Una recepción con neto $100.000 + IVA
--    $21.000 + percepciones IIBB $3.000 generaba un gasto de $121.000
--    cuando la deuda real con el proveedor es $124.000.
--
-- 2) orden_compra_recepcion_items no tenía ningún tope contra
--    cantidad_solicitada — se podía recibir (y confirmar, generando stock y
--    gasto) más cantidad de la pedida sin ningún aviso ni bloqueo. El
--    frontend ya lo valida (ComprasManager), esto lo hace real a nivel DB.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION confirmar_recepcion_compra(p_recepcion_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_recepcion   orden_compra_recepciones%ROWTYPE;
  v_orden       ordenes_compra%ROWTYPE;
  v_monto_neto  NUMERIC(15,2);
  v_monto_total NUMERIC(15,2);
  v_gasto_id    UUID;
  v_item        RECORD;
BEGIN
  SELECT * INTO v_recepcion FROM orden_compra_recepciones WHERE id = p_recepcion_id;
  IF v_recepcion.id IS NULL THEN
    RAISE EXCEPTION 'Recepción no encontrada';
  END IF;
  IF v_recepcion.gasto_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta recepción ya fue confirmada';
  END IF;

  SELECT * INTO v_orden FROM ordenes_compra WHERE id = v_recepcion.orden_compra_id;
  IF v_orden.estado = 'cancelada' THEN
    RAISE EXCEPTION 'La orden de compra está cancelada';
  END IF;

  SELECT COALESCE(SUM(subtotal), 0) INTO v_monto_neto
  FROM orden_compra_recepcion_items WHERE recepcion_id = p_recepcion_id;

  IF v_monto_neto <= 0 THEN
    RAISE EXCEPTION 'La recepción no tiene ítems cargados';
  END IF;

  -- Antes: neto + iva únicamente. Se agrega percepciones — es plata que
  -- también hay que pagarle al proveedor, no solo neto+IVA.
  v_monto_total := v_monto_neto + COALESCE(v_recepcion.iva, 0) + COALESCE(v_recepcion.percepciones, 0);

  INSERT INTO gastos (constructora_id, obra_id, proveedor_id, descripcion, monto, moneda, fecha_vencimiento, estado, notas, monto_neto, iva, percepciones, numero_comprobante)
  VALUES (
    v_recepcion.constructora_id,
    v_orden.obra_id,
    v_recepcion.proveedor_id,
    'Compra OC-' || v_orden.numero,
    v_monto_total,
    v_recepcion.moneda,
    v_recepcion.fecha,
    'Pendiente',
    v_recepcion.notas,
    v_monto_neto,
    v_recepcion.iva,
    v_recepcion.percepciones,
    v_recepcion.numero_comprobante
  )
  RETURNING id INTO v_gasto_id;

  UPDATE orden_compra_recepciones SET gasto_id = v_gasto_id WHERE id = p_recepcion_id;

  FOR v_item IN
    SELECT oci.cantidad_recibida, oi.producto_id
    FROM orden_compra_recepcion_items oci
    JOIN orden_compra_items oi ON oi.id = oci.orden_compra_item_id
    WHERE oci.recepcion_id = p_recepcion_id
  LOOP
    INSERT INTO stock_movimientos (constructora_id, producto_id, obra_id, tipo, cantidad, origen_recepcion_id, created_by)
    VALUES (v_recepcion.constructora_id, v_item.producto_id, v_orden.obra_id, 'entrada', v_item.cantidad_recibida, p_recepcion_id, auth.uid());
  END LOOP;

  IF v_orden.estado = 'borrador' THEN
    UPDATE ordenes_compra SET estado = 'confirmada' WHERE id = v_orden.id;
  END IF;

  RETURN v_gasto_id;
END;
$$;

ALTER FUNCTION confirmar_recepcion_compra(UUID) SET search_path = public;

-- ------------------------------------------------------------
-- Tope de sobre-recepción: la suma de cantidad_recibida de un ítem, entre
-- todas sus recepciones (confirmadas o no), no puede superar lo pedido.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION validar_recepcion_no_supera_solicitado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_solicitada  NUMERIC(15,2);
  v_total_otros NUMERIC(15,2);
BEGIN
  SELECT cantidad_solicitada INTO v_solicitada FROM orden_compra_items WHERE id = NEW.orden_compra_item_id;

  SELECT COALESCE(SUM(cantidad_recibida), 0) INTO v_total_otros
  FROM orden_compra_recepcion_items
  WHERE orden_compra_item_id = NEW.orden_compra_item_id AND id <> NEW.id;

  IF v_total_otros + NEW.cantidad_recibida > v_solicitada THEN
    RAISE EXCEPTION 'La cantidad recibida (%) supera lo pendiente de este ítem (quedan % de % solicitadas)',
      NEW.cantidad_recibida, (v_solicitada - v_total_otros), v_solicitada;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_recepcion_no_supera_solicitado ON orden_compra_recepcion_items;
CREATE TRIGGER trg_validar_recepcion_no_supera_solicitado
  BEFORE INSERT OR UPDATE ON orden_compra_recepcion_items
  FOR EACH ROW EXECUTE FUNCTION validar_recepcion_no_supera_solicitado();

ALTER FUNCTION validar_recepcion_no_supera_solicitado() SET search_path = public;
