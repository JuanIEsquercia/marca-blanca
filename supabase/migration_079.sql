-- ------------------------------------------------------------
-- migration_079.sql — Cuotas ajustables por índice e interés por mora.
--
-- Reglas de negocio, definidas por el usuario:
--
-- 1. AJUSTE E INTERÉS SON COSAS DISTINTAS y no se mezclan. El ajuste por
--    índice mantiene el valor (no es ganancia); el interés por mora es una
--    penalidad (sí lo es). Se componen en ese orden: primero se ajusta el
--    capital, después el interés se calcula SOBRE el capital ya ajustado.
--
-- 2. UNA CUOTA EMITIDA NO SE MODIFICA NUNCA MÁS. Se ajusta siempre hacia
--    adelante. Al emitir, el monto en pesos se congela con el último índice
--    publicado a esa fecha, y queda inmutable aunque el índice después se
--    corrija. Las cuotas que siguen adelante continúan ajustando.
--
-- 3. LA EMISIÓN ES EXPLÍCITA, no automática al vencer: le mandan la cuota
--    al cliente días antes y el valor tiene que quedar fijo desde ese envío.
--
-- 4. EL ÍNDICE ES POR CONTRATO Y OPCIONAL, porque conviven ventas en
--    dólares (sin ajuste) con ventas en pesos ajustadas. Un contrato sin
--    indice_tipo se comporta EXACTAMENTE como hoy: nada de lo ya cargado
--    cambia de comportamiento.
--
-- 5. CAC y UVA se tratan idéntico. La única diferencia es de dónde sale el
--    número (UVA la trae el cron del BCRA, CAC se carga a mano), y eso ya
--    está resuelto en indices_valores (migration_078).
--
-- 6. INTERÉS DIARIO SIMPLE SOBRE EL CAPITAL, por contrato. Ejemplo del
--    usuario: cuota de 100 al 1% diario suma 1 por día. No se capitaliza.
--
-- 7. SIN DÍAS DE GRACIA como campo: el interés corre desde el vencimiento.
--    Si en la práctica dan gracia, o corren la fecha de vencimiento o
--    perdonan el interés al cobrar — por eso el interés NUNCA se guarda,
--    se calcula, y quien cobra puede no cobrarlo.
-- ------------------------------------------------------------

-- ---------- Configuración por contrato ----------

ALTER TABLE contratos_venta
  -- NULL = sin ajuste (comportamiento actual). Con valor, tiene que existir
  -- esa serie en indices_valores: 'UVA' la trae el cron, 'CAC' se carga a
  -- mano. A propósito TEXT libre y no un enum: sumar una serie nueva no
  -- debería requerir una migración.
  ADD COLUMN IF NOT EXISTS indice_tipo TEXT,
  -- Porcentaje DIARIO sobre el capital. NULL = no se cobra mora.
  ADD COLUMN IF NOT EXISTS tasa_mora_diaria NUMERIC(6,4) CHECK (tasa_mora_diaria IS NULL OR tasa_mora_diaria >= 0);

-- ---------- Estado de ajuste en cada cuota ----------

ALTER TABLE cuotas
  -- Lo PACTADO, en unidades del índice (ej. 1200.5 UVA). Es el dato estable:
  -- no cambia nunca, ni cuando cambia el índice. NULL en contratos sin ajuste.
  ADD COLUMN IF NOT EXISTS monto_indice NUMERIC(18,6),
  -- Cuándo se emitió. NULL = todavía no emitida, o sea todavía ajustable.
  ADD COLUMN IF NOT EXISTS fecha_emision DATE,
  -- Con qué valor de índice se congeló. Se guarda para poder auditar el
  -- número aunque el BCRA corrija la serie después.
  ADD COLUMN IF NOT EXISTS indice_valor_emision NUMERIC(18,6);

COMMENT ON COLUMN cuotas.monto_base IS
  'Monto en pesos. En contratos sin índice es el valor definitivo desde la firma. En contratos CON índice es una proyección hasta que se emite, y a partir de la emisión queda congelado e inmutable.';

CREATE INDEX IF NOT EXISTS idx_cuotas_sin_emitir ON cuotas(contrato_id) WHERE fecha_emision IS NULL;

-- ---------- Una cuota emitida es inmutable en su capital ----------
-- Distinto de trg_cuotas_inmutable, que protege la cuota YA PAGADA: esto
-- protege el capital desde la EMISIÓN, que ocurre antes del pago. Cobrarla
-- (estado_pago, monto_cobrado, fecha_pago, cuenta) sigue permitido.

CREATE OR REPLACE FUNCTION proteger_cuota_emitida()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.bypass_inmutable', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.monto_base IS DISTINCT FROM OLD.monto_base
     OR NEW.monto_indice IS DISTINCT FROM OLD.monto_indice
     OR NEW.indice_valor_emision IS DISTINCT FROM OLD.indice_valor_emision
     OR NEW.fecha_emision IS DISTINCT FROM OLD.fecha_emision THEN
    RAISE EXCEPTION 'La cuota % ya fue emitida: su monto no se puede modificar. El ajuste se aplica siempre hacia adelante.', OLD.numero_cuota;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION proteger_cuota_emitida() SET search_path = public;

DROP TRIGGER IF EXISTS trg_cuota_emitida_inmutable ON cuotas;
CREATE TRIGGER trg_cuota_emitida_inmutable
  BEFORE UPDATE ON cuotas
  FOR EACH ROW WHEN (OLD.fecha_emision IS NOT NULL)
  EXECUTE FUNCTION proteger_cuota_emitida();

-- ---------- Emitir una cuota: congela el capital ----------

CREATE OR REPLACE FUNCTION emitir_cuota(p_cuota_id UUID, p_fecha DATE DEFAULT CURRENT_DATE)
RETURNS TABLE(monto_congelado NUMERIC, indice_usado NUMERIC)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cuota   cuotas%ROWTYPE;
  v_indice  TEXT;
  v_valor   NUMERIC;
  v_monto   NUMERIC;
BEGIN
  SELECT * INTO v_cuota FROM cuotas WHERE id = p_cuota_id;
  IF v_cuota.id IS NULL THEN
    RAISE EXCEPTION 'Cuota no encontrada';
  END IF;
  IF v_cuota.fecha_emision IS NOT NULL THEN
    RAISE EXCEPTION 'Esa cuota ya fue emitida el %', v_cuota.fecha_emision;
  END IF;

  SELECT cv.indice_tipo INTO v_indice FROM contratos_venta cv WHERE cv.id = v_cuota.contrato_id;

  IF v_indice IS NULL OR v_cuota.monto_indice IS NULL THEN
    -- Contrato sin ajuste: emitir solo deja constancia de la fecha; el
    -- monto ya era definitivo desde la firma.
    UPDATE cuotas SET fecha_emision = p_fecha WHERE id = p_cuota_id;
    RETURN QUERY SELECT v_cuota.monto_base, NULL::NUMERIC;
    RETURN;
  END IF;

  -- Último valor publicado hasta la fecha (las series tienen huecos: fines
  -- de semana y feriados). Si el índice del período todavía no salió, se
  -- congela con el último disponible — decisión del usuario.
  v_valor := valor_indice(v_indice, p_fecha);
  IF v_valor IS NULL THEN
    RAISE EXCEPTION 'No hay ningún valor de % cargado hasta el %. Cargá el índice antes de emitir.', v_indice, p_fecha;
  END IF;

  v_monto := ROUND(v_cuota.monto_indice * v_valor, 2);

  UPDATE cuotas
  SET monto_base = v_monto,
      fecha_emision = p_fecha,
      indice_valor_emision = v_valor
  WHERE id = p_cuota_id;

  RETURN QUERY SELECT v_monto, v_valor;
END;
$$;

-- ---------- Estado de una cuota a una fecha ----------
-- Devuelve capital + interés por separado a propósito: el interés se
-- muestra desglosado y quien cobra puede decidir no cobrarlo (los días de
-- gracia se resuelven así, ver punto 7 arriba).
--
-- El capital de una cuota NO emitida de un contrato con índice es una
-- PROYECCIÓN al índice de hoy, no un valor comprometido: por eso viene con
-- `emitida` en false, para que la pantalla lo muestre como estimado.

CREATE OR REPLACE FUNCTION estado_cuota(p_cuota_id UUID, p_fecha DATE DEFAULT CURRENT_DATE)
RETURNS TABLE(
  emitida         BOOLEAN,
  capital         NUMERIC,
  dias_atraso     INTEGER,
  interes_mora    NUMERIC,
  total           NUMERIC,
  indice_tipo     TEXT,
  indice_valor    NUMERIC
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_cuota    cuotas%ROWTYPE;
  v_contrato contratos_venta%ROWTYPE;
  v_capital  NUMERIC;
  v_valor    NUMERIC;
  v_dias     INTEGER;
  v_interes  NUMERIC := 0;
BEGIN
  SELECT * INTO v_cuota FROM cuotas WHERE id = p_cuota_id;
  IF v_cuota.id IS NULL THEN
    RAISE EXCEPTION 'Cuota no encontrada';
  END IF;
  SELECT * INTO v_contrato FROM contratos_venta WHERE id = v_cuota.contrato_id;

  IF v_cuota.fecha_emision IS NOT NULL THEN
    -- Emitida: el capital está congelado, no se recalcula nunca.
    v_capital := v_cuota.monto_base;
    v_valor   := v_cuota.indice_valor_emision;
  ELSIF v_contrato.indice_tipo IS NOT NULL AND v_cuota.monto_indice IS NOT NULL THEN
    -- Sin emitir y con ajuste: proyección al índice de la fecha pedida.
    v_valor   := valor_indice(v_contrato.indice_tipo, p_fecha);
    v_capital := CASE WHEN v_valor IS NULL THEN v_cuota.monto_base
                      ELSE ROUND(v_cuota.monto_indice * v_valor, 2) END;
  ELSE
    v_capital := v_cuota.monto_base;
  END IF;

  -- El interés corre desde el vencimiento hasta la fecha pedida, o hasta el
  -- día que se cobró si ya está pagada. Simple, no se capitaliza.
  v_dias := GREATEST(
    0,
    COALESCE(v_cuota.fecha_pago::DATE, p_fecha) - v_cuota.fecha_vencimiento
  );

  IF v_contrato.tasa_mora_diaria IS NOT NULL AND v_dias > 0 THEN
    v_interes := ROUND(v_capital * (v_contrato.tasa_mora_diaria / 100.0) * v_dias, 2);
  END IF;

  RETURN QUERY SELECT
    (v_cuota.fecha_emision IS NOT NULL),
    v_capital,
    v_dias,
    v_interes,
    ROUND(v_capital + v_interes, 2),
    v_contrato.indice_tipo,
    v_valor;
END;
$$;
