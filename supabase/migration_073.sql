-- ------------------------------------------------------------
-- migration_073.sql — Control de obra: presupuestado vs. ejecutado
-- por rubro.
--
-- El problema que resuelve: hasta acá el sistema tenía DOS taxonomías
-- paralelas que nunca se cruzaban. Lo que se VENDE se describe por rubro
-- (presupuesto_items.rubro -> contrato_obra_items.rubro, normalizado
-- contra la tabla `rubros`), y lo que se GASTA se clasifica por categoría
-- de costo (gastos.categoria_id -> categorias_costo). Se podía saber que
-- se certificó el 40% del rubro "Hormigón" y, por separado, cuánto se
-- gastó en la categoría "Materiales", pero nunca cruzar ambas cosas. Para
-- una constructora ese cruce ES el control de obra.
--
-- Las dos taxonomías NO se unifican a propósito: son ejes distintos y
-- complementarios. La categoría dice QUÉ CLASE de gasto es (materiales,
-- mano de obra, honorarios) y sirve para el resumen de toda la empresa.
-- El rubro dice A QUÉ PARTE DE LA OBRA corresponde, y es lo único
-- comparable contra el contrato. Un mismo gasto tiene las dos cosas.
--
-- 1. gastos.rubro_id      — imputación del costo al rubro de obra.
-- 2. ordenes_compra.rubro_id / acopios.rubro_id — se propagan al gasto
--    que esas operaciones generan, para no obligar a re-imputar después
--    (el gasto de una recepción/acopio nace 'Pagado' o 'Pendiente' y, si
--    queda Pagado, un operador ya no puede editarlo: ver
--    proteger_registro_financiero_terminal).
-- 3. confirmar_recepcion_compra() copia el rubro de la orden al gasto.
-- 4. resumen_rubros_obra() — la vista de control en sí, agregada en
--    Postgres (mismo criterio que resumen_unidades_por_obra /
--    resumen_gastos_por_categoria).
--
-- Nada de esto es obligatorio: rubro_id es NULLABLE en las tres tablas.
-- Los gastos ya cargados quedan sin imputar y aparecen agrupados como
-- "sin rubro" en la vista, que es justamente el disparador para que
-- alguien los complete.
-- ------------------------------------------------------------

-- ---------- 1-2. Columnas de imputación ----------

ALTER TABLE gastos          ADD COLUMN IF NOT EXISTS rubro_id UUID REFERENCES rubros(id) ON DELETE SET NULL;
ALTER TABLE ordenes_compra  ADD COLUMN IF NOT EXISTS rubro_id UUID REFERENCES rubros(id) ON DELETE SET NULL;
ALTER TABLE acopios         ADD COLUMN IF NOT EXISTS rubro_id UUID REFERENCES rubros(id) ON DELETE SET NULL;

-- La consulta de control filtra gastos por obra y agrupa por rubro.
CREATE INDEX IF NOT EXISTS idx_gastos_rubro         ON gastos(rubro_id);
CREATE INDEX IF NOT EXISTS idx_gastos_obra_rubro    ON gastos(obra_id, rubro_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_rubro ON ordenes_compra(rubro_id);
CREATE INDEX IF NOT EXISTS idx_acopios_rubro        ON acopios(rubro_id);

-- ---------- 3. La recepción hereda el rubro de la orden ----------
-- Idéntica a la versión de migration_066 salvo por rubro_id en el INSERT
-- de gastos (última línea de la lista de columnas).

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

  v_monto_total := v_monto_neto + COALESCE(v_recepcion.iva, 0) + COALESCE(v_recepcion.percepciones, 0);

  INSERT INTO gastos (constructora_id, obra_id, proveedor_id, descripcion, monto, moneda, fecha_vencimiento, estado, notas, monto_neto, iva, percepciones, numero_comprobante, rubro_id)
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
    v_recepcion.numero_comprobante,
    v_orden.rubro_id
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

-- ---------- 4. La vista de control ----------
--
-- Devuelve una fila por rubro, cruzando las dos puntas:
--   - lo VENDIDO: contrato_obra_items del contrato con el CLIENTE (el
--     contrato con un subcontratista es un costo, no la línea base contra
--     la que se mide; sus gastos entran por el lado del costo).
--   - lo CERTIFICADO: el % acumulado máximo de cada ítem (mismo criterio
--     que avanceAcumuladoPrevio en ContratoObraCard.tsx — un rubro puede
--     aparecer en varios certificados y lo que vale es el último
--     acumulado, no la suma).
--   - lo GASTADO: gastos de esa obra imputados a ese rubro.
--
-- FULL OUTER JOIN a propósito: un rubro puede estar contratado y todavía
-- sin gastos (fila con costo 0), o tener gastos sin estar contratado
-- (un adicional que aún no se cargó al contrato). Los gastos sin imputar
-- caen en una fila con rubro NULL, para que la pantalla pueda mostrar
-- cuánto costo todavía no entró al análisis en vez de dar un número
-- incompleto sin avisar.
--
-- ARS y USD NUNCA se suman entre sí (regla del sistema): el costo viene
-- desglosado en dos columnas y la comparación contra el contrato solo
-- tiene sentido en la moneda del contrato.
--
-- SECURITY INVOKER (default): corre con la RLS del caller. Quien no tenga
-- 'certificados' en el proyecto no ve las columnas del contrato, y quien
-- no tenga 'gastos' no ve el costo — por eso la página exige los dos
-- módulos antes de mostrar esto (mostrar costo 0 por falta de permiso
-- sería peor que no mostrar nada).

CREATE OR REPLACE FUNCTION resumen_rubros_obra(p_obra_id UUID)
RETURNS TABLE(
  rubro               TEXT,
  moneda_contrato     TEXT,
  monto_contratado    NUMERIC,
  monto_certificado   NUMERIC,
  pct_certificado     NUMERIC,
  costo_ars           NUMERIC,
  costo_usd           NUMERIC,
  costo_pendiente_ars NUMERIC,
  costo_pendiente_usd NUMERIC,
  cantidad_gastos     INTEGER
)
LANGUAGE sql
STABLE
AS $$
  WITH contrato_cliente AS (
    SELECT id, moneda
    FROM contratos_obra
    WHERE obra_id = p_obra_id AND tipo = 'cliente'
  ),
  avance_por_item AS (
    SELECT contrato_obra_item_id, MAX(pct_avance_acumulado) AS pct_max
    FROM certificado_items
    GROUP BY contrato_obra_item_id
  ),
  presupuesto AS (
    SELECT
      ci.rubro                                                            AS rubro,
      MIN(cc.moneda)                                                      AS moneda,
      SUM(ci.monto_contratado)                                            AS contratado,
      SUM(COALESCE(a.pct_max, 0) / 100.0 * ci.monto_contratado)           AS certificado
    FROM contrato_obra_items ci
    JOIN contrato_cliente cc      ON cc.id = ci.contrato_obra_id
    LEFT JOIN avance_por_item a   ON a.contrato_obra_item_id = ci.id
    GROUP BY ci.rubro
  ),
  costos AS (
    SELECT
      r.nombre                                                                      AS rubro,
      SUM(CASE WHEN g.moneda = 'ARS' THEN g.monto ELSE 0 END)                        AS costo_ars,
      SUM(CASE WHEN g.moneda = 'USD' THEN g.monto ELSE 0 END)                        AS costo_usd,
      SUM(CASE WHEN g.moneda = 'ARS' AND g.estado = 'Pendiente' THEN g.monto ELSE 0 END) AS pend_ars,
      SUM(CASE WHEN g.moneda = 'USD' AND g.estado = 'Pendiente' THEN g.monto ELSE 0 END) AS pend_usd,
      COUNT(*)::INTEGER                                                              AS cantidad
    FROM gastos g
    LEFT JOIN rubros r ON r.id = g.rubro_id
    WHERE g.obra_id = p_obra_id
    GROUP BY r.nombre
  )
  SELECT
    COALESCE(p.rubro, c.rubro)                        AS rubro,
    p.moneda                                          AS moneda_contrato,
    COALESCE(p.contratado, 0)                         AS monto_contratado,
    ROUND(COALESCE(p.certificado, 0), 2)              AS monto_certificado,
    CASE
      WHEN COALESCE(p.contratado, 0) > 0
        THEN ROUND(COALESCE(p.certificado, 0) / p.contratado * 100, 2)
      ELSE 0
    END                                               AS pct_certificado,
    COALESCE(c.costo_ars, 0)                          AS costo_ars,
    COALESCE(c.costo_usd, 0)                          AS costo_usd,
    COALESCE(c.pend_ars, 0)                           AS costo_pendiente_ars,
    COALESCE(c.pend_usd, 0)                           AS costo_pendiente_usd,
    COALESCE(c.cantidad, 0)                           AS cantidad_gastos
  FROM presupuesto p
  FULL OUTER JOIN costos c ON c.rubro = p.rubro
  -- Los rubros contratados primero (por monto), los gastos sueltos
  -- después, y la fila "sin rubro" siempre última.
  ORDER BY (COALESCE(p.rubro, c.rubro) IS NULL), COALESCE(p.contratado, 0) DESC, 1;
$$;

ALTER FUNCTION resumen_rubros_obra(UUID) SET search_path = public;
