-- ------------------------------------------------------------
-- Condición de IVA a nivel contrato/presupuesto: hoy un monto de
-- contrato/presupuesto es un total plano, sin indicar si es "+ IVA" o
-- ya incluido. Se agrega iva_pct (nullable = sin IVA) para que, al
-- generar un cobro/gasto desde un certificado de ese contrato, la
-- calculadora de IVA (ver IvaCalculator.tsx / migration_054) ya arranque
-- con el % configurado en vez de "Sin IVA" por defecto.
-- ------------------------------------------------------------
ALTER TABLE contratos_obra ADD COLUMN IF NOT EXISTS iva_pct DECIMAL(5,2);
ALTER TABLE presupuestos   ADD COLUMN IF NOT EXISTS iva_pct DECIMAL(5,2);

-- aceptar_presupuesto(): copiar iva_pct del presupuesto al contrato que
-- genera, igual que ya hace con moneda/descripcion/fechas.
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

  INSERT INTO contratos_obra (obra_id, constructora_id, tipo, cliente_id, monto_total, moneda, descripcion, presupuesto_id, fecha_inicio, fecha_fin_estimada, iva_pct)
  VALUES (v_obra_id, v_presupuesto.constructora_id, 'cliente', v_cliente_id, v_monto_total, v_presupuesto.moneda, v_presupuesto.descripcion, p_presupuesto_id, v_presupuesto.fecha_inicio, v_presupuesto.fecha_fin_estimada, v_presupuesto.iva_pct)
  RETURNING id INTO v_contrato_id;

  INSERT INTO contrato_obra_items (contrato_obra_id, constructora_id, orden, rubro, unidad, cantidad, precio_unitario, origen)
  SELECT v_contrato_id, constructora_id, orden, rubro, unidad, cantidad, precio_unitario, 'presupuesto'
  FROM presupuesto_items WHERE presupuesto_id = p_presupuesto_id;

  UPDATE presupuestos SET estado = 'aceptado', obra_id = v_obra_id, contrato_obra_id = v_contrato_id
  WHERE id = p_presupuesto_id;

  RETURN v_obra_id;
END;
$$;

ALTER FUNCTION aceptar_presupuesto(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) SET search_path = public;
