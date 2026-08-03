-- ------------------------------------------------------------
-- Guardar plan de pago (cuotas/cheques) de forma atómica.
--
-- PlanDePagoModal.guardar() hacía DELETE de las cuotas Pendientes/
-- Rechazadas y despues un INSERT del set nuevo, como dos round-trips
-- separados desde el cliente. Si el INSERT fallaba (red, o una fila
-- con monto vacío que viola el CHECK monto > 0), las cuotas viejas ya
-- estaban borradas y no se reponían — el gasto/cobro quedaba sin
-- ningún plan de pago pendiente, solo con un error en pantalla.
--
-- Esta función agrupa el DELETE + INSERT en una sola llamada (una
-- función = una transacción implícita: si algo falla adentro, Postgres
-- deshace todo). SECURITY INVOKER (default) a propósito — sigue
-- corriendo bajo la RLS real del caller, mismo criterio que
-- aceptar_presupuesto/confirmar_recepcion_compra.
--
-- De paso valida que la cuenta elegida para cada cuota (si se cargó)
-- sea de la misma moneda que el gasto/cobro — antes solo se filtraba
-- en el <select> del modal, sin ningún freno server-side.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION guardar_plan_pago(
  p_entidad TEXT,   -- 'gasto' | 'cobro'
  p_id      UUID,   -- gasto_id o cobro_id
  p_cuotas  JSONB    -- array de {monto, fecha_pago, medio, numero_cheque, banco, cuenta_propia_id, notas}
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_estado_liquidado TEXT;
  v_moneda           TEXT;
  v_cuota            JSONB;
  v_cuenta_id        UUID;
  v_cuenta_moneda    TEXT;
BEGIN
  IF p_entidad = 'gasto' THEN
    v_estado_liquidado := 'Pagado';
    SELECT moneda INTO v_moneda FROM gastos WHERE id = p_id;
    IF v_moneda IS NULL THEN RAISE EXCEPTION 'Gasto no encontrado'; END IF;
    DELETE FROM gasto_pagos WHERE gasto_id = p_id AND estado <> v_estado_liquidado;
  ELSIF p_entidad = 'cobro' THEN
    v_estado_liquidado := 'Cobrado';
    SELECT moneda INTO v_moneda FROM cobros_proyecto WHERE id = p_id;
    IF v_moneda IS NULL THEN RAISE EXCEPTION 'Cobro no encontrado'; END IF;
    DELETE FROM cobro_pagos WHERE cobro_id = p_id AND estado <> v_estado_liquidado;
  ELSE
    RAISE EXCEPTION 'Entidad inválida: %', p_entidad;
  END IF;

  FOR v_cuota IN SELECT * FROM jsonb_array_elements(p_cuotas)
  LOOP
    v_cuenta_id := NULLIF(v_cuota->>'cuenta_propia_id', '')::UUID;

    IF v_cuenta_id IS NOT NULL THEN
      SELECT moneda INTO v_cuenta_moneda FROM cuentas_propias WHERE id = v_cuenta_id;
      IF v_cuenta_moneda IS DISTINCT FROM v_moneda THEN
        RAISE EXCEPTION 'La cuenta elegida es en % y el % es en % — no coinciden', v_cuenta_moneda, p_entidad, v_moneda;
      END IF;
    END IF;

    IF p_entidad = 'gasto' THEN
      INSERT INTO gasto_pagos (gasto_id, monto, fecha_pago, medio, numero_cheque, banco, cuenta_propia_id, notas)
      VALUES (
        p_id,
        (v_cuota->>'monto')::DECIMAL,
        (v_cuota->>'fecha_pago')::DATE,
        COALESCE(v_cuota->>'medio', 'cheque'),
        NULLIF(v_cuota->>'numero_cheque', ''),
        NULLIF(v_cuota->>'banco', ''),
        v_cuenta_id,
        NULLIF(v_cuota->>'notas', '')
      );
    ELSE
      INSERT INTO cobro_pagos (cobro_id, monto, fecha_pago, medio, numero_cheque, banco, cuenta_propia_id, notas)
      VALUES (
        p_id,
        (v_cuota->>'monto')::DECIMAL,
        (v_cuota->>'fecha_pago')::DATE,
        COALESCE(v_cuota->>'medio', 'cheque'),
        NULLIF(v_cuota->>'numero_cheque', ''),
        NULLIF(v_cuota->>'banco', ''),
        v_cuenta_id,
        NULLIF(v_cuota->>'notas', '')
      );
    END IF;
  END LOOP;
END;
$$;

ALTER FUNCTION guardar_plan_pago(TEXT, UUID, JSONB) SET search_path = public;
