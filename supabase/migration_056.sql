-- ------------------------------------------------------------
-- Auditoría de consistencia (1/4): un gasto generado desde Compras
-- (confirmar_recepcion_compra) nunca llevaba el desglose neto/IVA/
-- percepciones/comprobante que sí tienen los gastos cargados a mano o
-- generados desde un certificado. Se agrega el mismo desglose a
-- orden_compra_recepciones — salvo monto_neto: ESE no se guarda acá
-- porque siempre es exactamente SUM(subtotal) de
-- orden_compra_recepcion_items (mismo criterio que "cuánto se recibió"
-- en ese módulo: se calcula, nunca se duplica un valor que podría
-- desincronizarse). El IVA se aplica una sola vez sobre el total de la
-- recepción (como en una factura real de un proveedor), no por ítem.
-- ------------------------------------------------------------
ALTER TABLE orden_compra_recepciones
  ADD COLUMN IF NOT EXISTS iva                DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS percepciones       DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS numero_comprobante TEXT;

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

  v_monto_total := v_monto_neto + COALESCE(v_recepcion.iva, 0);

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
