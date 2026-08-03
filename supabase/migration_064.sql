-- ------------------------------------------------------------
-- Plan de pago (cuotas/cheques) para gastos y cobros: hasta ahora un
-- gasto/cobro era todo-o-nada — un solo estado, una sola fecha_pago,
-- una sola cuenta. En la obra real, un gasto se cancela seguido con
-- varios cheques a 15/30/45 (o 30/60/90) días, con montos distintos
-- entre sí — y del lado de cobros pasa lo mismo con cheques de
-- terceros. Se agrega un plan de pago OPCIONAL: el flujo simple actual
-- (Registrar pago, un solo movimiento) no cambia — esto es una
-- alternativa para cuando un gasto/cobro puntual necesita partirse.
--
-- Misma estructura para los dos lados, tabla separada en vez de
-- polimorfismo — mismo criterio que contrato_obra_items/presupuesto_items.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS gasto_pagos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gasto_id         UUID NOT NULL REFERENCES gastos(id) ON DELETE CASCADE,
  constructora_id  UUID NOT NULL REFERENCES constructoras(id),
  medio            TEXT NOT NULL DEFAULT 'cheque' CHECK (medio IN ('cheque', 'transferencia', 'efectivo', 'otro')),
  numero_cheque    TEXT,
  banco            TEXT,
  monto            DECIMAL(15,2) NOT NULL CHECK (monto > 0),
  fecha_emision    DATE,
  fecha_pago       DATE NOT NULL,  -- cuándo se hace efectivo (el "+15/+30/+45")
  estado           TEXT NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente', 'Pagado', 'Rechazado')),
  cuenta_propia_id UUID REFERENCES cuentas_propias(id) ON DELETE SET NULL,
  notas            TEXT,
  created_by       UUID REFERENCES auth.users(id),
  updated_by       UUID REFERENCES auth.users(id),
  updated_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gasto_pagos_gasto  ON gasto_pagos(gasto_id);
CREATE INDEX IF NOT EXISTS idx_gasto_pagos_estado ON gasto_pagos(estado);

CREATE TABLE IF NOT EXISTS cobro_pagos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cobro_id         UUID NOT NULL REFERENCES cobros_proyecto(id) ON DELETE CASCADE,
  constructora_id  UUID NOT NULL REFERENCES constructoras(id),
  medio            TEXT NOT NULL DEFAULT 'cheque' CHECK (medio IN ('cheque', 'transferencia', 'efectivo', 'otro')),
  numero_cheque    TEXT,
  banco            TEXT,
  monto            DECIMAL(15,2) NOT NULL CHECK (monto > 0),
  fecha_emision    DATE,
  fecha_pago       DATE NOT NULL,
  estado           TEXT NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente', 'Cobrado', 'Rechazado')),
  cuenta_propia_id UUID REFERENCES cuentas_propias(id) ON DELETE SET NULL,
  notas            TEXT,
  created_by       UUID REFERENCES auth.users(id),
  updated_by       UUID REFERENCES auth.users(id),
  updated_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cobro_pagos_cobro  ON cobro_pagos(cobro_id);
CREATE INDEX IF NOT EXISTS idx_cobro_pagos_estado ON cobro_pagos(estado);

-- ------------------------------------------------------------
-- Tenant denormalizado desde el padre — mismo patrón que
-- set_orden_compra_item_tenant.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_gasto_pago_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.constructora_id IS NULL THEN
    SELECT constructora_id INTO NEW.constructora_id FROM gastos WHERE id = NEW.gasto_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gasto_pago_tenant ON gasto_pagos;
CREATE TRIGGER trg_gasto_pago_tenant
  BEFORE INSERT ON gasto_pagos
  FOR EACH ROW EXECUTE FUNCTION set_gasto_pago_tenant();

CREATE OR REPLACE FUNCTION set_cobro_pago_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.constructora_id IS NULL THEN
    SELECT constructora_id INTO NEW.constructora_id FROM cobros_proyecto WHERE id = NEW.cobro_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cobro_pago_tenant ON cobro_pagos;
CREATE TRIGGER trg_cobro_pago_tenant
  BEFORE INSERT ON cobro_pagos
  FOR EACH ROW EXECUTE FUNCTION set_cobro_pago_tenant();

-- ------------------------------------------------------------
-- Auditoría estándar (created_by/updated_by + historial completo).
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_auditoria_campos ON gasto_pagos;
CREATE TRIGGER trg_auditoria_campos
  BEFORE INSERT OR UPDATE ON gasto_pagos
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_campos();

DROP TRIGGER IF EXISTS trg_registrar_auditoria ON gasto_pagos;
CREATE TRIGGER trg_registrar_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON gasto_pagos
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

DROP TRIGGER IF EXISTS trg_auditoria_campos ON cobro_pagos;
CREATE TRIGGER trg_auditoria_campos
  BEFORE INSERT OR UPDATE ON cobro_pagos
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_campos();

DROP TRIGGER IF EXISTS trg_registrar_auditoria ON cobro_pagos;
CREATE TRIGGER trg_registrar_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON cobro_pagos
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

-- ------------------------------------------------------------
-- Una cuota ya Pagada/Cobrada es inmutable para no-admin — mismo
-- criterio que trg_gastos_inmutable/trg_cobros_proyecto_inmutable en
-- el padre (proteger_registro_financiero_terminal ya es genérica sobre
-- OLD.estado, no hace falta una función nueva).
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_gasto_pagos_inmutable ON gasto_pagos;
CREATE TRIGGER trg_gasto_pagos_inmutable
  BEFORE UPDATE OR DELETE ON gasto_pagos
  FOR EACH ROW WHEN (OLD.estado = 'Pagado')
  EXECUTE FUNCTION proteger_registro_financiero_terminal();

DROP TRIGGER IF EXISTS trg_cobro_pagos_inmutable ON cobro_pagos;
CREATE TRIGGER trg_cobro_pagos_inmutable
  BEFORE UPDATE OR DELETE ON cobro_pagos
  FOR EACH ROW WHEN (OLD.estado = 'Cobrado')
  EXECUTE FUNCTION proteger_registro_financiero_terminal();

-- ------------------------------------------------------------
-- Proyecto cerrado bloquea altas/bajas de cuotas — mismo patrón que
-- bloquear_escritura_proyecto_cerrado_contrato_item/_certificado_item
-- (cuelgan de un padre que no tiene obra_id propio).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION bloquear_escritura_proyecto_cerrado_gasto_pago()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_obra_id UUID;
  v_estado  TEXT;
BEGIN
  IF current_setting('app.bypass_inmutable', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT obra_id INTO v_obra_id FROM gastos WHERE id = COALESCE(NEW.gasto_id, OLD.gasto_id);
  IF v_obra_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT estado INTO v_estado FROM obras WHERE id = v_obra_id;
  IF v_estado = 'finalizada' THEN
    RAISE EXCEPTION 'El proyecto está cerrado. Reactivalo para poder modificar sus datos.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_bloquear_cerrado ON gasto_pagos;
CREATE TRIGGER trg_bloquear_cerrado
  BEFORE INSERT OR UPDATE OR DELETE ON gasto_pagos
  FOR EACH ROW EXECUTE FUNCTION bloquear_escritura_proyecto_cerrado_gasto_pago();

CREATE OR REPLACE FUNCTION bloquear_escritura_proyecto_cerrado_cobro_pago()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_obra_id UUID;
  v_estado  TEXT;
BEGIN
  IF current_setting('app.bypass_inmutable', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT obra_id INTO v_obra_id FROM cobros_proyecto WHERE id = COALESCE(NEW.cobro_id, OLD.cobro_id);
  IF v_obra_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT estado INTO v_estado FROM obras WHERE id = v_obra_id;
  IF v_estado = 'finalizada' THEN
    RAISE EXCEPTION 'El proyecto está cerrado. Reactivalo para poder modificar sus datos.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_bloquear_cerrado ON cobro_pagos;
CREATE TRIGGER trg_bloquear_cerrado
  BEFORE INSERT OR UPDATE OR DELETE ON cobro_pagos
  FOR EACH ROW EXECUTE FUNCTION bloquear_escritura_proyecto_cerrado_cobro_pago();

-- ------------------------------------------------------------
-- Sync del padre: mientras no estén TODAS las cuotas en Pagado/Cobrado,
-- el gasto/cobro sigue Pendiente (igual que hoy, sin plan de pago).
-- Cuando la última cierra, el padre pasa a Pagado/Cobrado con
-- fecha_pago = fecha de la cuota más tardía. cuenta_propia_id del padre
-- queda en NULL apenas tiene un plan de pago — ya no representa una
-- sola cuenta, cada cuota tiene la suya (ver lib/tesoreria.ts, que lee
-- cada cuota Pagada/Cobrada por separado para el saldo por cuenta).
-- Una cuota Rechazada nunca cuenta como pagada: el padre queda
-- Pendiente hasta que se repone con otra cuota.
--
-- El UPDATE al padre corre bajo app.bypass_inmutable para no chocar con
-- trg_gastos_inmutable/trg_bloquear_cerrado del propio padre — mismo
-- patrón que recalcular_monto_certificado/recalcular_monto_total_contrato.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_estado_gasto_por_pagos()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_gasto_id  UUID := COALESCE(NEW.gasto_id, OLD.gasto_id);
  v_total     INTEGER;
  v_pagadas   INTEGER;
  v_max_fecha DATE;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE estado = 'Pagado'), MAX(fecha_pago) FILTER (WHERE estado = 'Pagado')
    INTO v_total, v_pagadas, v_max_fecha
  FROM gasto_pagos WHERE gasto_id = v_gasto_id;

  PERFORM set_config('app.bypass_inmutable', 'true', true);
  IF v_total > 0 AND v_total = v_pagadas THEN
    UPDATE gastos SET estado = 'Pagado', fecha_pago = v_max_fecha, cuenta_propia_id = NULL WHERE id = v_gasto_id;
  ELSE
    UPDATE gastos SET estado = 'Pendiente', fecha_pago = NULL, cuenta_propia_id = NULL WHERE id = v_gasto_id;
  END IF;
  PERFORM set_config('app.bypass_inmutable', 'false', true);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_estado_gasto_por_pagos ON gasto_pagos;
CREATE TRIGGER trg_sync_estado_gasto_por_pagos
  AFTER INSERT OR UPDATE OR DELETE ON gasto_pagos
  FOR EACH ROW EXECUTE FUNCTION sync_estado_gasto_por_pagos();

CREATE OR REPLACE FUNCTION sync_estado_cobro_por_pagos()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_cobro_id  UUID := COALESCE(NEW.cobro_id, OLD.cobro_id);
  v_total     INTEGER;
  v_cobradas  INTEGER;
  v_max_fecha DATE;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE estado = 'Cobrado'), MAX(fecha_pago) FILTER (WHERE estado = 'Cobrado')
    INTO v_total, v_cobradas, v_max_fecha
  FROM cobro_pagos WHERE cobro_id = v_cobro_id;

  PERFORM set_config('app.bypass_inmutable', 'true', true);
  IF v_total > 0 AND v_total = v_cobradas THEN
    UPDATE cobros_proyecto SET estado = 'Cobrado', fecha_pago = v_max_fecha, cuenta_propia_id = NULL WHERE id = v_cobro_id;
  ELSE
    UPDATE cobros_proyecto SET estado = 'Pendiente', fecha_pago = NULL, cuenta_propia_id = NULL WHERE id = v_cobro_id;
  END IF;
  PERFORM set_config('app.bypass_inmutable', 'false', true);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_estado_cobro_por_pagos ON cobro_pagos;
CREATE TRIGGER trg_sync_estado_cobro_por_pagos
  AFTER INSERT OR UPDATE OR DELETE ON cobro_pagos
  FOR EACH ROW EXECUTE FUNCTION sync_estado_cobro_por_pagos();

ALTER FUNCTION set_gasto_pago_tenant() SET search_path = public;
ALTER FUNCTION set_cobro_pago_tenant() SET search_path = public;
ALTER FUNCTION bloquear_escritura_proyecto_cerrado_gasto_pago() SET search_path = public;
ALTER FUNCTION bloquear_escritura_proyecto_cerrado_cobro_pago() SET search_path = public;
ALTER FUNCTION sync_estado_gasto_por_pagos() SET search_path = public;
ALTER FUNCTION sync_estado_cobro_por_pagos() SET search_path = public;

-- ------------------------------------------------------------
-- RLS — mismo criterio que gastos_tenant/cobros_proyecto_tenant, vía
-- EXISTS al padre (gasto_pagos/cobro_pagos no tienen obra_id propio).
-- ------------------------------------------------------------
ALTER TABLE gasto_pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE cobro_pagos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gasto_pagos_tenant" ON gasto_pagos;
CREATE POLICY "gasto_pagos_tenant" ON gasto_pagos
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras()) AND EXISTS (
      SELECT 1 FROM gastos g WHERE g.id = gasto_pagos.gasto_id AND (
        (g.obra_id IS NULL AND es_admin())
        OR (g.obra_id IS NOT NULL AND tiene_permiso_proyecto(g.obra_id, 'gastos'))
      )
    )
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras()) AND EXISTS (
      SELECT 1 FROM gastos g WHERE g.id = gasto_pagos.gasto_id AND (
        (g.obra_id IS NULL AND es_admin())
        OR (g.obra_id IS NOT NULL AND tiene_permiso_proyecto(g.obra_id, 'gastos'))
      )
    )
  );

DROP POLICY IF EXISTS "cobro_pagos_tenant" ON cobro_pagos;
CREATE POLICY "cobro_pagos_tenant" ON cobro_pagos
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras()) AND EXISTS (
      SELECT 1 FROM cobros_proyecto c WHERE c.id = cobro_pagos.cobro_id AND tiene_permiso_proyecto(c.obra_id, 'cobros')
    )
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras()) AND EXISTS (
      SELECT 1 FROM cobros_proyecto c WHERE c.id = cobro_pagos.cobro_id AND tiene_permiso_proyecto(c.obra_id, 'cobros')
    )
  );

-- Nota: no hace falta tocar purgar_obra_completa()/purgar_constructora_completa()
-- — el ON DELETE CASCADE de gasto_id/cobro_id borra las cuotas solo cuando se
-- borra el gasto/cobro padre, y ambas funciones ya corren con
-- app.bypass_inmutable = 'true' (así que los triggers de arriba no las frenan).
