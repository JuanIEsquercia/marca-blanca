-- ------------------------------------------------------------
-- Dos gaps de integridad del ciclo Presupuesto→Contrato→Certificación→Cobro
-- encontrados en auditoría (2026-08-03):
--
-- 1) Nada impedía cobrar (o pagarle a un subcontratista) más de lo
--    contratado. Ya existía validar_monto_certificado/_item para topar la
--    CERTIFICACIÓN contra el contrato, pero cobros_proyecto/gastos no tenían
--    el mismo tope contra contratos_obra.monto_total.
--
-- 2) certificado_items.pct_avance_acumulado solo tenía el CHECK 0-100 — la
--    única razón por la que un certificado nuevo no "retrocedía" el avance
--    de un ítem era el atributo HTML min= del formulario (ContratoObraCard),
--    que no protege una llamada directa a la API.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION validar_monto_cobrado_contrato()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_monto_total NUMERIC(15,2);
  v_suma_otros  NUMERIC(15,2);
BEGIN
  IF NEW.contrato_obra_id IS NULL THEN RETURN NEW; END IF;

  SELECT monto_total INTO v_monto_total FROM contratos_obra WHERE id = NEW.contrato_obra_id;
  IF v_monto_total IS NULL OR v_monto_total <= 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(monto), 0) INTO v_suma_otros
  FROM cobros_proyecto
  WHERE contrato_obra_id = NEW.contrato_obra_id AND id <> NEW.id;

  IF (v_suma_otros + NEW.monto) > v_monto_total THEN
    RAISE EXCEPTION 'La suma de cobros (%) superaría el monto del contrato (%)', (v_suma_otros + NEW.monto), v_monto_total;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_monto_cobrado_contrato ON cobros_proyecto;
CREATE TRIGGER trg_validar_monto_cobrado_contrato
  BEFORE INSERT OR UPDATE ON cobros_proyecto
  FOR EACH ROW EXECUTE FUNCTION validar_monto_cobrado_contrato();

-- Pagos a subcontratista: gastos.certificado_id -> certificados_avance.contrato_obra_id
-- (gastos no tiene contrato_obra_id propio). Solo corre cuando el gasto
-- viene de un certificado — un gasto suelto (compras, proveedores varios)
-- no tiene contrato contra el cual toparse.
CREATE OR REPLACE FUNCTION validar_monto_pagado_contrato()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_contrato_id UUID;
  v_monto_total NUMERIC(15,2);
  v_suma_otros  NUMERIC(15,2);
BEGIN
  SELECT contrato_obra_id INTO v_contrato_id FROM certificados_avance WHERE id = NEW.certificado_id;
  IF v_contrato_id IS NULL THEN RETURN NEW; END IF;

  SELECT monto_total INTO v_monto_total FROM contratos_obra WHERE id = v_contrato_id;
  IF v_monto_total IS NULL OR v_monto_total <= 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(g.monto), 0) INTO v_suma_otros
  FROM gastos g
  JOIN certificados_avance ca ON ca.id = g.certificado_id
  WHERE ca.contrato_obra_id = v_contrato_id AND g.id <> NEW.id;

  IF (v_suma_otros + NEW.monto) > v_monto_total THEN
    RAISE EXCEPTION 'La suma de pagos (%) superaría el monto del contrato con el subcontratista (%)', (v_suma_otros + NEW.monto), v_monto_total;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_monto_pagado_contrato ON gastos;
CREATE TRIGGER trg_validar_monto_pagado_contrato
  BEFORE INSERT OR UPDATE ON gastos
  FOR EACH ROW WHEN (NEW.certificado_id IS NOT NULL)
  EXECUTE FUNCTION validar_monto_pagado_contrato();

-- Monotonía del avance certificado: un certificado nuevo (o editado) no
-- puede dejar pct_avance_acumulado por debajo de lo ya certificado antes
-- para ese mismo ítem, en ningún otro certificado del contrato.
CREATE OR REPLACE FUNCTION validar_avance_no_retrocede()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_max_previo NUMERIC(5,2);
BEGIN
  SELECT MAX(pct_avance_acumulado) INTO v_max_previo
  FROM certificado_items
  WHERE contrato_obra_item_id = NEW.contrato_obra_item_id AND id <> NEW.id;

  IF v_max_previo IS NOT NULL AND NEW.pct_avance_acumulado < v_max_previo THEN
    RAISE EXCEPTION 'El avance acumulado (% de avance) no puede ser menor al ya certificado antes (% de avance)', NEW.pct_avance_acumulado, v_max_previo;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_avance_no_retrocede ON certificado_items;
CREATE TRIGGER trg_validar_avance_no_retrocede
  BEFORE INSERT OR UPDATE ON certificado_items
  FOR EACH ROW EXECUTE FUNCTION validar_avance_no_retrocede();

ALTER FUNCTION validar_monto_cobrado_contrato() SET search_path = public;
ALTER FUNCTION validar_monto_pagado_contrato() SET search_path = public;
ALTER FUNCTION validar_avance_no_retrocede() SET search_path = public;
