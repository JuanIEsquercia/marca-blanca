-- ============================================================
-- MIGRATION 048: una obra puede tener más de un contrato CON EL
-- CLIENTE (no solo subcontratistas) — caso real: un cliente firma
-- contratos separados por etapa (ej. 4 contratos con la misma
-- constructora, uno por etapa de la obra). migration_047 solo dejaba
-- uno, restricción propia (no pedida), se saca acá.
--
-- Con más de un contrato cliente posible, cobros_proyecto necesita
-- saber a CUÁL pertenece de forma directa — antes se sabía solo
-- indirectamente vía certificado_id (nullable: un cobro "sin
-- certificado" quedaba sin forma de saber a qué contrato corresponde
-- si hay varios). Mismo patrón que ya tienen contrato_obra_items y
-- certificados_avance (contrato_obra_id directo).
--
-- Nullable a propósito (no NOT NULL): no hay forma de garantizar en
-- una migración que todo cobro histórico tenga un contrato tipo
-- cliente resoluble sin mirar los datos reales primero. La UI exige
-- elegir contrato para cualquier cobro nuevo de acá en más.
-- ============================================================

ALTER TABLE cobros_proyecto ADD COLUMN IF NOT EXISTS contrato_obra_id UUID REFERENCES contratos_obra(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_cobros_proyecto_contrato ON cobros_proyecto(contrato_obra_id);

-- Backfill: hasta ahora solo podía existir un contrato tipo 'cliente'
-- por obra, así que todo cobro existente pertenece sin ambigüedad al
-- único contrato cliente de su obra (si lo tiene).
--
-- bypass_inmutable: cobros_proyecto tiene el trigger
-- proteger_registro_financiero_terminal(), que bloquea tocar una fila
-- en estado 'cobrado' salvo que sea un admin autenticado o esté este
-- flag activo — al correr esto desde el SQL Editor no hay sesión de
-- usuario (auth.uid() es NULL), así que es_admin() da false aunque
-- vos seas admin de verdad en la app. Mismo patrón que usan
-- purgar_obra_completa()/purgar_constructora_completa() para lo mismo.
SELECT set_config('app.bypass_inmutable', 'true', true);

UPDATE cobros_proyecto cp
SET contrato_obra_id = (
  SELECT co.id FROM contratos_obra co
  WHERE co.obra_id = cp.obra_id AND co.tipo = 'cliente'
  LIMIT 1
)
WHERE cp.contrato_obra_id IS NULL;

-- aceptar_presupuesto() ya no bloquea si la obra tiene un contrato
-- cliente — puede tener varios (una etapa cada uno).
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
    -- migration_048: ya no se bloquea si la obra ya tiene contrato(s)
    -- con el cliente — puede sumar otro (nueva etapa).
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

  INSERT INTO contratos_obra (obra_id, constructora_id, tipo, cliente_id, monto_total, moneda, descripcion, presupuesto_id, fecha_inicio, fecha_fin_estimada)
  VALUES (v_obra_id, v_presupuesto.constructora_id, 'cliente', v_cliente_id, v_monto_total, v_presupuesto.moneda, v_presupuesto.descripcion, p_presupuesto_id, v_presupuesto.fecha_inicio, v_presupuesto.fecha_fin_estimada)
  RETURNING id INTO v_contrato_id;

  INSERT INTO contrato_obra_items (contrato_obra_id, constructora_id, orden, rubro, unidad, cantidad, precio_unitario, origen)
  SELECT v_contrato_id, constructora_id, orden, rubro, unidad, cantidad, precio_unitario, 'presupuesto'
  FROM presupuesto_items WHERE presupuesto_id = p_presupuesto_id;

  UPDATE presupuestos SET estado = 'aceptado', obra_id = v_obra_id, contrato_obra_id = v_contrato_id
  WHERE id = p_presupuesto_id;

  RETURN v_obra_id;
END;
$$;
