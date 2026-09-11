-- ------------------------------------------------------------
-- migration_080.sql — Moneda del plan de cuotas de una venta.
--
-- El problema que cierra: migration_079 sumó ajuste por índice e interés
-- por mora, pero las cuotas se seguían generando SIEMPRE con el saldo en
-- dólares y sin decir en qué moneda estaban. Si alguien pactaba cuotas en
-- pesos, no había dónde declararlo y todo lo que viene después (caja,
-- ingresos, tesorería, dashboard) las trataba como dólares. No fallaba:
-- mentía.
--
-- Regla del negocio, dicha por el usuario: EL PRECIO SIEMPRE ES EN DÓLARES.
-- Lo que varía es cómo se pacta el PLAN DE CUOTAS. Los tres casos reales:
--
--   A. Cuotas en dólares fijos.
--      cuotas_moneda='USD', indice_tipo NULL. Es lo de hoy, tal cual.
--
--   B. Cuotas en pesos al dólar del día.
--      cuotas_moneda='ARS', indice_tipo='USD_MINORISTA'.
--
--   C. Cuotas en pesos ajustables por CAC / UVA.
--      cuotas_moneda='ARS', indice_tipo='CAC' | 'UVA'.
--
-- Los tres corren sobre EL MISMO motor de migration_079: el dólar es una
-- serie más en indices_valores. Lo único que hacía falta era decir en qué
-- moneda quedan las cuotas y a qué cotización se convirtió el saldo en
-- dólares al firmar. No hay tres lógicas, hay dos campos.
--
-- Existe además el caso D (cuotas en pesos fijos, sin ajuste): sale solo,
-- es cuotas_moneda='ARS' con indice_tipo NULL.
--
-- Compatibilidad: los defaults son 'USD' en todas las columnas nuevas, así
-- que TODO contrato ya cargado sigue comportándose exactamente igual.
-- ------------------------------------------------------------

-- ---------- Cómo se denomina el plan de cuotas ----------

ALTER TABLE contratos_venta
  -- En qué moneda quedan las CUOTAS. El precio_final y la entrega_efectiva
  -- siguen siendo dólares siempre — no se tocan.
  ADD COLUMN IF NOT EXISTS cuotas_moneda TEXT NOT NULL DEFAULT 'USD',
  -- Pesos por dólar acordados al firmar. Solo aplica con cuotas en pesos:
  -- es lo que convierte el saldo en dólares a un monto en pesos. Se guarda
  -- aunque se haya tomado del índice publicado, porque después el contrato
  -- tiene que poder explicarse solo.
  ADD COLUMN IF NOT EXISTS cotizacion_pactada NUMERIC(18,6);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_contrato_cuotas_moneda') THEN
    ALTER TABLE contratos_venta ADD CONSTRAINT chk_contrato_cuotas_moneda
      CHECK (cuotas_moneda IN ('ARS', 'USD'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_contrato_cotizacion_positiva') THEN
    ALTER TABLE contratos_venta ADD CONSTRAINT chk_contrato_cotizacion_positiva
      CHECK (cotizacion_pactada IS NULL OR cotizacion_pactada > 0);
  END IF;
  -- Ajustar por índice una cuota que ya está en dólares no tiene sentido en
  -- este mercado: el dólar ES el refugio. Si alguien quiere eso, lo que
  -- quiere en realidad es el caso B.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_contrato_indice_solo_en_pesos') THEN
    ALTER TABLE contratos_venta ADD CONSTRAINT chk_contrato_indice_solo_en_pesos
      CHECK (cuotas_moneda = 'ARS' OR indice_tipo IS NULL);
  END IF;
END $$;

COMMENT ON COLUMN contratos_venta.cuotas_moneda IS
  'Moneda del plan de cuotas. El precio del contrato es siempre USD; esto dice solo en qué se pactaron las cuotas.';
COMMENT ON COLUMN contratos_venta.cotizacion_pactada IS
  'Pesos por dólar acordados al firmar. Solo con cuotas_moneda=ARS. Si se deja vacío se toma el USD_MINORISTA publicado a la fecha de firma y se guarda acá.';

-- ---------- Cada cuota lleva su moneda ----------
-- Denormalizado a propósito: la cuota es la unidad que viaja sola a caja,
-- ingresos, tesorería y al recibo. Que tenga que ir a buscar su moneda al
-- contrato es exactamente lo que hace que alguien se la olvide.

ALTER TABLE cuotas
  ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'USD';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cuota_moneda') THEN
    ALTER TABLE cuotas ADD CONSTRAINT chk_cuota_moneda CHECK (moneda IN ('ARS', 'USD'));
  END IF;
END $$;

-- Las cuotas ya cargadas son todas en dólares (era la única opción). El
-- DEFAULT ya las dejó así; esto es solo el backfill explícito por si alguna
-- fila vino de una vía que lo salteó.
UPDATE cuotas SET moneda = 'USD' WHERE moneda IS NULL;

-- ---------- Resolver la cotización ANTES de insertar ----------
-- BEFORE INSERT y no dentro del generador de cuotas (que es AFTER) porque
-- así la cotización queda guardada en la fila del contrato en la misma
-- operación, sin un UPDATE posterior que chocaría con los triggers de
-- inmutabilidad financiera de migration_029.

CREATE OR REPLACE FUNCTION resolver_cotizacion_contrato()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.cuotas_moneda IS DISTINCT FROM 'ARS' THEN
    -- Cuotas en dólares: no hay conversión que hacer y guardar una
    -- cotización sería ruido.
    NEW.cotizacion_pactada := NULL;
    RETURN NEW;
  END IF;

  IF NEW.cotizacion_pactada IS NULL THEN
    NEW.cotizacion_pactada := valor_indice('USD_MINORISTA', NEW.fecha_firma);
  END IF;

  IF NEW.cotizacion_pactada IS NULL OR NEW.cotizacion_pactada <= 0 THEN
    RAISE EXCEPTION 'Para pactar las cuotas en pesos hace falta la cotización del dólar al %. Cargala en el contrato, o actualizá la serie USD_MINORISTA.', NEW.fecha_firma;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resolver_cotizacion_contrato ON contratos_venta;
CREATE TRIGGER trg_resolver_cotizacion_contrato
  BEFORE INSERT ON contratos_venta
  FOR EACH ROW EXECUTE FUNCTION resolver_cotizacion_contrato();

-- ---------- Generador de cuotas, ahora consciente de moneda e índice ----------

CREATE OR REPLACE FUNCTION generar_cuotas_contrato()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  saldo_usd    NUMERIC;
  saldo_plan   NUMERIC;  -- el mismo saldo, ya en la moneda de las cuotas
  monto_cuota  NUMERIC;
  base_indice  NUMERIC;  -- valor del índice a la fecha de firma
  unidades     NUMERIC;  -- lo pactado, en unidades de índice
  ajuste       NUMERIC;
  i            INTEGER;
  fecha_venc   DATE;
BEGIN
  -- cantidad_cuotas=0 solo se valida min=1 en el cliente (SaleForm) — un
  -- insert por otra vía (RPC, service role) sin este guard dividiría por
  -- cero.
  IF NEW.cantidad_cuotas IS NULL OR NEW.cantidad_cuotas <= 0 THEN
    RETURN NEW;
  END IF;

  -- El precio es siempre en dólares: el saldo a financiar nace en dólares
  -- pase lo que pase.
  saldo_usd := NEW.precio_final - NEW.entrega_efectiva;

  IF NEW.cuotas_moneda = 'ARS' THEN
    -- resolver_cotizacion_contrato() ya garantizó que hay cotización.
    saldo_plan := ROUND(saldo_usd * NEW.cotizacion_pactada, 2);
  ELSE
    saldo_plan := saldo_usd;
  END IF;

  monto_cuota := ROUND(saldo_plan / NEW.cantidad_cuotas, 2);

  -- Con ajuste por índice, lo que se guarda como dato firme es la CANTIDAD
  -- DE UNIDADES, no los pesos: los pesos son la parte volátil y se
  -- recalculan al emitir. Ver migration_079.
  IF NEW.indice_tipo IS NOT NULL THEN
    IF NEW.indice_tipo LIKE 'USD%' THEN
      -- El índice ES el dólar. Su valor base es la cotización pactada, no
      -- la publicada: si no, una diferencia entre lo acordado y lo que
      -- publicó el BCRA ese día haría que las unidades dejaran de ser
      -- exactamente los dólares del contrato.
      base_indice := NEW.cotizacion_pactada;
    ELSE
      base_indice := valor_indice(NEW.indice_tipo, NEW.fecha_firma);
    END IF;

    IF base_indice IS NULL OR base_indice <= 0 THEN
      RAISE EXCEPTION 'No hay ningún valor de % publicado hasta el %. Cargá el índice antes de firmar el contrato.', NEW.indice_tipo, NEW.fecha_firma;
    END IF;

    unidades := ROUND(monto_cuota / base_indice, 6);
  END IF;

  FOR i IN 1..NEW.cantidad_cuotas LOOP
    fecha_venc := (NEW.fecha_firma + (i * INTERVAL '1 month'))::DATE;
    INSERT INTO cuotas (contrato_id, constructora_id, numero_cuota, monto_base, moneda, monto_indice, fecha_vencimiento)
    VALUES (NEW.id, NEW.constructora_id, i, monto_cuota, NEW.cuotas_moneda, unidades, fecha_venc);
  END LOOP;

  -- El resto del redondeo va a la última cuota para que la suma cierre
  -- exacta contra el saldo. Con índice hay que corregir TAMBIÉN las
  -- unidades, si no la última cuota se emitiría por un monto distinto al
  -- que dice tener.
  ajuste := saldo_plan - (monto_cuota * NEW.cantidad_cuotas);
  IF ajuste <> 0 THEN
    UPDATE cuotas
    SET monto_base   = monto_base + ajuste,
        monto_indice = CASE WHEN base_indice IS NULL THEN NULL
                            ELSE ROUND((monto_cuota + ajuste) / base_indice, 6) END
    WHERE contrato_id = NEW.id AND numero_cuota = NEW.cantidad_cuotas;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------- Saldo de un contrato, desglosado por moneda ----------
-- Sumar cuotas de distinta moneda en un solo número es el error que esta
-- migración existe para evitar, así que lo que se expone viene separado.

CREATE OR REPLACE FUNCTION saldo_contrato_venta(p_contrato_id UUID)
RETURNS TABLE(
  moneda          TEXT,
  cobrado         NUMERIC,
  pendiente       NUMERIC,
  cuotas_totales  INTEGER,
  cuotas_pagadas  INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    c.moneda,
    COALESCE(SUM(CASE WHEN c.estado_pago = 'Pagado' THEN COALESCE(c.monto_cobrado, c.monto_base) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN c.estado_pago <> 'Pagado' THEN c.monto_base ELSE 0 END), 0),
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE c.estado_pago = 'Pagado')::INTEGER
  FROM cuotas c
  WHERE c.contrato_id = p_contrato_id
  GROUP BY c.moneda;
$$;
