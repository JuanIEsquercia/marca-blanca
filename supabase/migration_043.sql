-- ============================================================
-- MIGRATION 043: contrato_obra_items pasa a tener la misma
-- estructura que presupuesto_items (unidad/cantidad/precio_unitario)
-- en vez de guardar solo el monto final ya calculado.
--
-- Antes, tanto "Crear contrato" (formulario ItemsRubroTable, que SÍ
-- pedía cantidad × precio unitario) como aceptar_presupuesto() (que
-- copiaba presupuesto_items) calculaban el subtotal en el momento y
-- descartaban cantidad/precio_unitario/unidad — esa granularidad
-- nunca se guardaba para los ítems de un contrato, a diferencia del
-- presupuesto. El formulario de "Adicional" era honesto con ese
-- límite (solo pedía rubro+monto), pero el de "Crear contrato"
-- prometía más detalle del que realmente terminaba persistiendo.
--
-- monto_contratado pasa a ser GENERATED (mismo patrón que
-- presupuesto_items.subtotal): cantidad × precio_unitario, siempre.
-- ============================================================

ALTER TABLE contrato_obra_items ADD COLUMN IF NOT EXISTS unidad TEXT;
ALTER TABLE contrato_obra_items ADD COLUMN IF NOT EXISTS cantidad NUMERIC(15,2);
ALTER TABLE contrato_obra_items ADD COLUMN IF NOT EXISTS precio_unitario NUMERIC(15,2);

-- Backfill de filas existentes: la cantidad/precio real nunca se guardó,
-- así que no hay forma de recuperarla — se asume cantidad=1 y
-- precio_unitario = monto_contratado ya guardado, para no alterar ningún
-- total existente (1 × precio_unitario = precio_unitario = monto de antes).
UPDATE contrato_obra_items SET cantidad = 1, precio_unitario = monto_contratado
WHERE cantidad IS NULL;

ALTER TABLE contrato_obra_items ALTER COLUMN cantidad SET DEFAULT 1;
ALTER TABLE contrato_obra_items ALTER COLUMN cantidad SET NOT NULL;
ALTER TABLE contrato_obra_items ADD CONSTRAINT contrato_obra_items_cantidad_check CHECK (cantidad > 0);
ALTER TABLE contrato_obra_items ALTER COLUMN precio_unitario SET NOT NULL;
ALTER TABLE contrato_obra_items ADD CONSTRAINT contrato_obra_items_precio_unitario_check CHECK (precio_unitario >= 0);

-- monto_contratado: de columna normal a GENERATED (Postgres no permite
-- convertir una columna existente in-place, hay que dropear y recrear).
-- Los triggers/policies que la usan (recalcular_monto_total_contrato,
-- validar_monto_certificado_item, etc.) solo la LEEN — no la escriben
-- directo — así que no se ven afectados.
ALTER TABLE contrato_obra_items DROP COLUMN monto_contratado;
ALTER TABLE contrato_obra_items ADD COLUMN monto_contratado NUMERIC(15,2)
  GENERATED ALWAYS AS (cantidad * precio_unitario) STORED;

-- aceptar_presupuesto(): copiar unidad/cantidad/precio_unitario en vez de
-- solo el subtotal ya calculado — mismo cuerpo que la versión anterior
-- (schema.sql), solo cambia el INSERT INTO contrato_obra_items.
CREATE OR REPLACE FUNCTION aceptar_presupuesto(
  p_presupuesto_id       UUID,
  p_obra_id              UUID DEFAULT NULL,
  p_nueva_obra_nombre    TEXT DEFAULT NULL,
  p_nueva_obra_direccion TEXT DEFAULT NULL,
  p_modo_cuentas         TEXT DEFAULT 'empresa',
  p_replicar_cuentas     BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_presupuesto  presupuestos%ROWTYPE;
  v_obra_tipo    TEXT;
  v_obra_id      UUID;
  v_cliente_id   UUID;
  v_monto_total  NUMERIC(15,2);
  v_contrato_id  UUID;
BEGIN
  IF p_modo_cuentas NOT IN ('empresa', 'especificas') THEN
    RAISE EXCEPTION 'modo_cuentas inválido: %', p_modo_cuentas;
  END IF;

  SELECT * INTO v_presupuesto FROM presupuestos WHERE id = p_presupuesto_id;
  IF v_presupuesto.id IS NULL THEN
    RAISE EXCEPTION 'Presupuesto no encontrado';
  END IF;
  IF v_presupuesto.estado = 'aceptado' THEN
    RAISE EXCEPTION 'Este presupuesto ya fue aceptado';
  END IF;

  SELECT COALESCE(SUM(subtotal), 0) INTO v_monto_total
  FROM presupuesto_items WHERE presupuesto_id = p_presupuesto_id;
  IF v_monto_total <= 0 THEN
    RAISE EXCEPTION 'El presupuesto no tiene ítems cargados';
  END IF;

  IF p_obra_id IS NOT NULL THEN
    SELECT tipo INTO v_obra_tipo FROM obras WHERE id = p_obra_id AND constructora_id = v_presupuesto.constructora_id;
    IF v_obra_tipo IS NULL THEN
      RAISE EXCEPTION 'Proyecto no encontrado';
    END IF;
    IF v_obra_tipo != 'obra' THEN
      RAISE EXCEPTION 'Solo se puede vincular a un proyecto tipo Obra';
    END IF;
    IF EXISTS (SELECT 1 FROM contratos_obra WHERE obra_id = p_obra_id) THEN
      RAISE EXCEPTION 'Ese proyecto ya tiene un contrato de obra cargado';
    END IF;
    v_obra_id := p_obra_id;
  ELSE
    IF p_nueva_obra_nombre IS NULL OR btrim(p_nueva_obra_nombre) = '' THEN
      RAISE EXCEPTION 'Falta el nombre del proyecto nuevo';
    END IF;
    INSERT INTO obras (constructora_id, nombre, direccion, tipo, estado, modo_cuentas)
    VALUES (v_presupuesto.constructora_id, btrim(p_nueva_obra_nombre), NULLIF(btrim(COALESCE(p_nueva_obra_direccion, '')), ''), 'obra', 'activa', p_modo_cuentas)
    RETURNING id INTO v_obra_id;

    IF p_modo_cuentas = 'especificas' AND p_replicar_cuentas THEN
      INSERT INTO cuentas_propias (constructora_id, obra_id, nombre, tipo, moneda, saldo_inicial, activa)
      SELECT constructora_id, v_obra_id, nombre, tipo, moneda, 0, true
      FROM cuentas_propias
      WHERE constructora_id = v_presupuesto.constructora_id AND obra_id IS NULL AND activa = true;
    END IF;
  END IF;

  IF v_presupuesto.cliente_cuit IS NOT NULL THEN
    SELECT id INTO v_cliente_id FROM compradores
    WHERE constructora_id = v_presupuesto.constructora_id AND dni_cuit = v_presupuesto.cliente_cuit;
  END IF;
  IF v_cliente_id IS NULL THEN
    INSERT INTO compradores (constructora_id, nombre_completo, dni_cuit, email, telefono)
    VALUES (v_presupuesto.constructora_id, v_presupuesto.cliente_nombre, v_presupuesto.cliente_cuit, v_presupuesto.cliente_email, v_presupuesto.cliente_telefono)
    RETURNING id INTO v_cliente_id;
  END IF;

  INSERT INTO contratos_obra (obra_id, constructora_id, cliente_id, monto_total, moneda, descripcion, presupuesto_id, fecha_inicio, fecha_fin_estimada)
  VALUES (v_obra_id, v_presupuesto.constructora_id, v_cliente_id, v_monto_total, v_presupuesto.moneda, v_presupuesto.descripcion, p_presupuesto_id, v_presupuesto.fecha_inicio, v_presupuesto.fecha_fin_estimada)
  RETURNING id INTO v_contrato_id;

  INSERT INTO contrato_obra_items (contrato_obra_id, constructora_id, orden, rubro, unidad, cantidad, precio_unitario, origen)
  SELECT v_contrato_id, constructora_id, orden, rubro, unidad, cantidad, precio_unitario, 'presupuesto'
  FROM presupuesto_items WHERE presupuesto_id = p_presupuesto_id;

  UPDATE presupuestos SET estado = 'aceptado', obra_id = v_obra_id, contrato_obra_id = v_contrato_id
  WHERE id = p_presupuesto_id;

  RETURN v_obra_id;
END;
$$;
