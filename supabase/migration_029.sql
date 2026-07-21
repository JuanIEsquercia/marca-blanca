-- ============================================================
-- MIGRATION 029: integridad financiera — cuotas/contratos_venta
-- sin protección de inmutabilidad, moneda sin validar en DB,
-- división por cero en generar_cuotas_contrato()
--
-- Encontrado en la auditoría de cuentas/caja del 2026-07-21 (ver memoria
-- "tesoreria-caja-auditoria"): gastos/certificados_avance/cobros_proyecto
-- ya tenían protección de inmutabilidad en estado terminal (migration_015),
-- pero cuotas y contratos_venta —las tablas del flujo DESARROLLO que
-- registran plata ya cobrada— nunca la tuvieron. Un operador podía editar
-- una cuota Pagada o borrar una venta completa (cascade de cuotas Pagadas)
-- sin restricción de rol.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Cuotas Pagadas inmutables para no-admin (mismo patrón que
--    proteger_registro_financiero_terminal, pero la columna se llama
--    estado_pago en vez de estado)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION proteger_cuota_pagada()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF es_admin() OR current_setting('app.bypass_inmutable', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'No se puede eliminar: la cuota ya está Pagada y solo un admin puede modificarla.';
  END IF;
  RAISE EXCEPTION 'No se puede editar: la cuota ya está Pagada y solo un admin puede modificarla.';
END;
$$;

DROP TRIGGER IF EXISTS trg_cuotas_inmutable ON cuotas;
CREATE TRIGGER trg_cuotas_inmutable
  BEFORE UPDATE OR DELETE ON cuotas
  FOR EACH ROW WHEN (OLD.estado_pago = 'Pagado')
  EXECUTE FUNCTION proteger_cuota_pagada();

-- ------------------------------------------------------------
-- 2. Contratos de venta con cobros ya registrados (entrega efectiva
--    y/o alguna cuota Pagada): no se pueden borrar ni cambiar
--    precio_final/entrega_efectiva salvo admin. contratos_venta no
--    tiene columna "estado" propia (a diferencia de gastos/certificados/
--    cobros), así que el chequeo mira sus cuotas hijas.
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

  IF TG_OP = 'UPDATE' AND (NEW.precio_final IS DISTINCT FROM OLD.precio_final OR NEW.entrega_efectiva IS DISTINCT FROM OLD.entrega_efectiva) THEN
    RAISE EXCEPTION 'No se puede editar el precio final ni la entrega efectiva: el contrato ya tiene cobros registrados y solo un admin puede hacerlo.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contratos_venta_con_cobros ON contratos_venta;
CREATE TRIGGER trg_contratos_venta_con_cobros
  BEFORE UPDATE OR DELETE ON contratos_venta
  FOR EACH ROW EXECUTE FUNCTION proteger_contrato_con_cobros();

-- ------------------------------------------------------------
-- 3. Moneda validada a nivel DB (antes solo la filtraban los <select>
--    del panel — un insert directo por PostgREST podía dejar una cuenta
--    o un gasto con una moneda arbitraria)
-- ------------------------------------------------------------
ALTER TABLE cuentas_propias DROP CONSTRAINT IF EXISTS cuentas_propias_moneda_check;
ALTER TABLE cuentas_propias ADD CONSTRAINT cuentas_propias_moneda_check CHECK (moneda IN ('ARS', 'USD'));

ALTER TABLE gastos DROP CONSTRAINT IF EXISTS gastos_moneda_check;
ALTER TABLE gastos ADD CONSTRAINT gastos_moneda_check CHECK (moneda IN ('ARS', 'USD'));

-- ------------------------------------------------------------
-- 4. generar_cuotas_contrato(): división por cero si cantidad_cuotas=0
--    llega por una vía distinta al form (RPC, service role) — el form
--    solo valida min=1 en el cliente, no hay guard en la DB.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION generar_cuotas_contrato()
RETURNS TRIGGER AS $$
DECLARE
  saldo_restante  DECIMAL(15,2);
  monto_cuota     DECIMAL(15,2);
  i               INTEGER;
  fecha_venc      DATE;
BEGIN
  IF NEW.cantidad_cuotas IS NULL OR NEW.cantidad_cuotas <= 0 THEN
    RETURN NEW;
  END IF;

  saldo_restante := NEW.precio_final - NEW.entrega_efectiva;
  monto_cuota    := ROUND(saldo_restante / NEW.cantidad_cuotas, 2);

  FOR i IN 1..NEW.cantidad_cuotas LOOP
    fecha_venc := (NEW.fecha_firma + (i * INTERVAL '1 month'))::DATE;
    INSERT INTO cuotas (contrato_id, constructora_id, numero_cuota, monto_base, fecha_vencimiento)
    VALUES (NEW.id, NEW.constructora_id, i, monto_cuota, fecha_venc);
  END LOOP;

  UPDATE cuotas
  SET monto_base = monto_base + (saldo_restante - (monto_cuota * NEW.cantidad_cuotas))
  WHERE contrato_id = NEW.id AND numero_cuota = NEW.cantidad_cuotas;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
