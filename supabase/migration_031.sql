-- ============================================================
-- MIGRATION 031: Presupuestos como origen de una obra + certificación
-- de avance por ítem/rubro (en vez de un % global sin detalle).
--
-- Flujo: un presupuesto (borrador → enviado → aceptado/rechazado) se
-- arma con ítems (rubro, cantidad, precio unitario) SIN estar atado a
-- ningún proyecto todavía. Si se acepta, sus ítems se copian
-- (congelados) a un contrato_obra nuevo — recién ahí queda vinculado a
-- una obra (nueva o existente). El presupuesto original queda como
-- registro histórico de lo cotizado.
--
-- El certificado de avance, cuando el contrato tiene ítems, certifica
-- rubro por rubro (certificado_items) en vez de un monto/% global
-- tipeado a mano — el monto y % del certificado se recalculan solos
-- sumando sus ítems. Contratos SIN presupuesto de origen (el flujo
-- viejo) siguen funcionando exactamente igual que hoy, sin ítems.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Presupuestos (nivel Empresa, sin obra_id — pre-proyecto)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS presupuestos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id   UUID NOT NULL REFERENCES constructoras(id),
  -- se completa recién al aceptar — permite listar "a qué obra se convirtió"
  -- sin tener que pasar por contratos_obra.presupuesto_id.
  obra_id           UUID REFERENCES obras(id) ON DELETE SET NULL,
  contrato_obra_id  UUID REFERENCES contratos_obra(id) ON DELETE SET NULL,
  cliente_nombre    TEXT NOT NULL,
  cliente_cuit      TEXT,
  cliente_email     TEXT,
  cliente_telefono  TEXT,
  moneda            TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
  estado            TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'enviado', 'aceptado', 'rechazado')),
  descripcion       TEXT,
  notas             TEXT,
  created_by        UUID REFERENCES auth.users(id),
  updated_by        UUID REFERENCES auth.users(id),
  updated_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS presupuesto_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  presupuesto_id    UUID NOT NULL REFERENCES presupuestos(id) ON DELETE CASCADE,
  constructora_id   UUID NOT NULL REFERENCES constructoras(id),
  orden             INTEGER NOT NULL DEFAULT 0,
  rubro             TEXT NOT NULL,
  unidad            TEXT,
  cantidad          NUMERIC(15,2) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario   NUMERIC(15,2) NOT NULL CHECK (precio_unitario >= 0),
  subtotal          NUMERIC(15,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presupuestos_constructora        ON presupuestos(constructora_id);
CREATE INDEX IF NOT EXISTS idx_presupuesto_items_presupuesto    ON presupuesto_items(presupuesto_id);

-- ------------------------------------------------------------
-- 2. contratos_obra: origen opcional en un presupuesto
-- ------------------------------------------------------------
ALTER TABLE contratos_obra ADD COLUMN IF NOT EXISTS presupuesto_id UUID REFERENCES presupuestos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contratos_obra_presupuesto ON contratos_obra(presupuesto_id);

-- ------------------------------------------------------------
-- 3. contrato_obra_items: ítems congelados (copiados del presupuesto
--    al aceptar) más los que se agreguen después como "adicional" de
--    obra (trabajo extra no cotizado originalmente).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contrato_obra_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_obra_id  UUID NOT NULL REFERENCES contratos_obra(id) ON DELETE CASCADE,
  constructora_id   UUID NOT NULL REFERENCES constructoras(id),
  orden             INTEGER NOT NULL DEFAULT 0,
  rubro             TEXT NOT NULL,
  monto_contratado  NUMERIC(15,2) NOT NULL CHECK (monto_contratado >= 0),
  origen            TEXT NOT NULL DEFAULT 'presupuesto' CHECK (origen IN ('presupuesto', 'adicional')),
  notas             TEXT,
  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contrato_obra_items_contrato ON contrato_obra_items(contrato_obra_id);

-- ------------------------------------------------------------
-- 4. certificado_items: avance de CADA ítem en un certificado puntual.
--    monto_certificado es el monto de ESTE período (igual semántica que
--    certificados_avance.monto_certificado) — la suma de todos los
--    certificado_items de un mismo contrato_obra_item_id, a lo largo de
--    todos los certificados, no puede superar monto_contratado de ese
--    ítem (ver validar_monto_certificado_item más abajo).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS certificado_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certificado_id          UUID NOT NULL REFERENCES certificados_avance(id) ON DELETE CASCADE,
  contrato_obra_item_id   UUID NOT NULL REFERENCES contrato_obra_items(id),
  constructora_id         UUID NOT NULL REFERENCES constructoras(id),
  pct_avance_acumulado    NUMERIC(5,2) NOT NULL CHECK (pct_avance_acumulado >= 0 AND pct_avance_acumulado <= 100),
  monto_certificado       NUMERIC(15,2) NOT NULL CHECK (monto_certificado >= 0),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (certificado_id, contrato_obra_item_id)
);

CREATE INDEX IF NOT EXISTS idx_certificado_items_certificado ON certificado_items(certificado_id);
CREATE INDEX IF NOT EXISTS idx_certificado_items_item        ON certificado_items(contrato_obra_item_id);

-- ------------------------------------------------------------
-- 5. Validación por ítem: mismo espíritu que validar_monto_certificado
--    (que ya protege el total del contrato), pero a nivel de rubro —
--    evita sobre-certificar el ítem A "compensando" con el B mientras
--    el total del contrato sigue dando bien.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION validar_monto_certificado_item()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_monto_contratado NUMERIC(15,2);
  v_suma_otros       NUMERIC(15,2);
BEGIN
  SELECT monto_contratado INTO v_monto_contratado
  FROM contrato_obra_items WHERE id = NEW.contrato_obra_item_id;

  SELECT COALESCE(SUM(monto_certificado), 0) INTO v_suma_otros
  FROM certificado_items WHERE contrato_obra_item_id = NEW.contrato_obra_item_id AND id != NEW.id;

  IF (v_suma_otros + NEW.monto_certificado) > v_monto_contratado THEN
    RAISE EXCEPTION 'El monto certificado acumulado del ítem (%) supera lo contratado para ese ítem (%)',
      v_suma_otros + NEW.monto_certificado, v_monto_contratado;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_monto_certificado_item ON certificado_items;
CREATE TRIGGER trg_validar_monto_certificado_item
  BEFORE INSERT OR UPDATE ON certificado_items
  FOR EACH ROW EXECUTE FUNCTION validar_monto_certificado_item();

-- ------------------------------------------------------------
-- 6. Recalcular el certificado padre (monto_certificado y
--    porcentaje_avance) a partir de la suma de sus ítems — así el
--    total sale solo, nunca se tipea a mano cuando hay ítems.
--    set_config(bypass_inmutable) evita que este UPDATE interno choque
--    con trg_certificados_avance_inmutable / trg_bloquear_cerrado.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalcular_monto_certificado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_certificado_id UUID := COALESCE(NEW.certificado_id, OLD.certificado_id);
  v_total          NUMERIC(15,2);
  v_monto_total    NUMERIC(15,2);
  v_contrato_id    UUID;
BEGIN
  SELECT COALESCE(SUM(monto_certificado), 0) INTO v_total
  FROM certificado_items WHERE certificado_id = v_certificado_id;

  SELECT contrato_obra_id INTO v_contrato_id FROM certificados_avance WHERE id = v_certificado_id;
  SELECT monto_total INTO v_monto_total FROM contratos_obra WHERE id = v_contrato_id;

  PERFORM set_config('app.bypass_inmutable', 'true', true);
  UPDATE certificados_avance
  SET monto_certificado = v_total,
      porcentaje_avance = CASE WHEN v_monto_total > 0 THEN LEAST(100, ROUND((v_total / v_monto_total) * 100, 2)) ELSE porcentaje_avance END
  WHERE id = v_certificado_id;
  PERFORM set_config('app.bypass_inmutable', 'false', true);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recalcular_monto_certificado ON certificado_items;
CREATE TRIGGER trg_recalcular_monto_certificado
  AFTER INSERT OR UPDATE OR DELETE ON certificado_items
  FOR EACH ROW EXECUTE FUNCTION recalcular_monto_certificado();

-- ------------------------------------------------------------
-- 7. Inmutabilidad
--    - contrato_obra_items: congelado para no-admin desde que se crea
--      (representa lo cotizado/contratado, no se edita a la ligera).
--    - certificado_items: bloqueado para no-admin cuando el certificado
--      padre ya está 'aprobado' (mismo criterio que certificados_avance).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION proteger_contrato_obra_item()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF es_admin() OR current_setting('app.bypass_inmutable', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'No se puede eliminar un ítem del contrato: solo un admin puede modificarlos una vez creados.';
  END IF;
  RAISE EXCEPTION 'No se puede editar un ítem del contrato: solo un admin puede modificarlos una vez creados.';
END;
$$;

DROP TRIGGER IF EXISTS trg_contrato_obra_item_inmutable ON contrato_obra_items;
CREATE TRIGGER trg_contrato_obra_item_inmutable
  BEFORE UPDATE OR DELETE ON contrato_obra_items
  FOR EACH ROW EXECUTE FUNCTION proteger_contrato_obra_item();

CREATE OR REPLACE FUNCTION proteger_certificado_item()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_estado TEXT;
BEGIN
  IF es_admin() OR current_setting('app.bypass_inmutable', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT estado INTO v_estado FROM certificados_avance WHERE id = COALESCE(NEW.certificado_id, OLD.certificado_id);
  IF v_estado = 'aprobado' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'No se puede eliminar: el certificado ya está aprobado y solo un admin puede modificarlo.';
    END IF;
    RAISE EXCEPTION 'No se puede editar: el certificado ya está aprobado y solo un admin puede modificarlo.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_certificado_item_inmutable ON certificado_items;
CREATE TRIGGER trg_certificado_item_inmutable
  BEFORE UPDATE OR DELETE ON certificado_items
  FOR EACH ROW EXECUTE FUNCTION proteger_certificado_item();

-- Ambas tablas heredan "proyecto cerrado" (bloquear_escritura_proyecto_cerrado
-- exige una columna obra_id propia — acá se resuelve vía join, mismo patrón
-- que ya existe para cuotas/amenity_imagenes).
CREATE OR REPLACE FUNCTION bloquear_escritura_proyecto_cerrado_contrato_item()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_obra_id UUID;
  v_estado  TEXT;
BEGIN
  IF current_setting('app.bypass_inmutable', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT obra_id INTO v_obra_id FROM contratos_obra WHERE id = COALESCE(NEW.contrato_obra_id, OLD.contrato_obra_id);
  IF v_obra_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT estado INTO v_estado FROM obras WHERE id = v_obra_id;
  IF v_estado = 'finalizada' THEN
    RAISE EXCEPTION 'El proyecto está cerrado. Reactivalo para poder modificar sus datos.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_bloquear_cerrado ON contrato_obra_items;
CREATE TRIGGER trg_bloquear_cerrado
  BEFORE INSERT OR UPDATE OR DELETE ON contrato_obra_items
  FOR EACH ROW EXECUTE FUNCTION bloquear_escritura_proyecto_cerrado_contrato_item();

CREATE OR REPLACE FUNCTION bloquear_escritura_proyecto_cerrado_certificado_item()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_obra_id UUID;
  v_estado  TEXT;
BEGIN
  IF current_setting('app.bypass_inmutable', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT obra_id INTO v_obra_id FROM certificados_avance WHERE id = COALESCE(NEW.certificado_id, OLD.certificado_id);
  IF v_obra_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT estado INTO v_estado FROM obras WHERE id = v_obra_id;
  IF v_estado = 'finalizada' THEN
    RAISE EXCEPTION 'El proyecto está cerrado. Reactivalo para poder modificar sus datos.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_bloquear_cerrado ON certificado_items;
CREATE TRIGGER trg_bloquear_cerrado
  BEFORE INSERT OR UPDATE OR DELETE ON certificado_items
  FOR EACH ROW EXECUTE FUNCTION bloquear_escritura_proyecto_cerrado_certificado_item();

-- ------------------------------------------------------------
-- 8. Auditoría de presupuestos (mismo patrón que gastos/contratos_obra)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_auditoria_campos ON presupuestos;
CREATE TRIGGER trg_auditoria_campos
  BEFORE INSERT OR UPDATE ON presupuestos
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_campos();

DROP TRIGGER IF EXISTS trg_registrar_auditoria ON presupuestos;
CREATE TRIGGER trg_registrar_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON presupuestos
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

-- ------------------------------------------------------------
-- 9. purgar_constructora_completa: sumar el borrado de presupuestos
--    (contrato_obra_items/certificado_items ya caen en cascada desde
--    contratos_obra/certificados_avance, que se borran antes acá).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION purgar_constructora_completa(p_constructora_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM cobros_proyecto   WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_obra    WHERE constructora_id = p_constructora_id;
  DELETE FROM presupuestos      WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_venta   WHERE constructora_id = p_constructora_id;
  DELETE FROM reservas          WHERE constructora_id = p_constructora_id;
  DELETE FROM gastos            WHERE constructora_id = p_constructora_id;
  DELETE FROM compradores       WHERE constructora_id = p_constructora_id;
  DELETE FROM unidades          WHERE constructora_id = p_constructora_id;
  DELETE FROM proveedores       WHERE constructora_id = p_constructora_id;
  DELETE FROM categorias_costo  WHERE constructora_id = p_constructora_id;
  DELETE FROM cuentas_propias   WHERE constructora_id = p_constructora_id;
  DELETE FROM tipologias        WHERE constructora_id = p_constructora_id;
  DELETE FROM amenities         WHERE constructora_id = p_constructora_id;
  DELETE FROM auditoria         WHERE constructora_id = p_constructora_id;
  DELETE FROM constructoras     WHERE id = p_constructora_id;
END;
$$;

-- ------------------------------------------------------------
-- 10. aceptar_presupuesto(): convierte un presupuesto en contrato de
--    obra de forma atómica (crea/vincula la obra, el cliente, el
--    contrato y copia los ítems). A propósito NO es SECURITY DEFINER
--    — corre como el usuario que llama, así que las policies RLS de
--    obras (admin-only para crear), contratos_obra/contrato_obra_items
--    (tiene_permiso_proyecto 'certificados' en la obra elegida) y
--    presupuestos (tiene_permiso 'presupuestos') se aplican solas, sin
--    duplicar ningún chequeo de autorización acá.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION aceptar_presupuesto(
  p_presupuesto_id       UUID,
  p_obra_id              UUID DEFAULT NULL,
  p_nueva_obra_nombre    TEXT DEFAULT NULL,
  p_nueva_obra_direccion TEXT DEFAULT NULL
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
    VALUES (v_presupuesto.constructora_id, btrim(p_nueva_obra_nombre), NULLIF(btrim(COALESCE(p_nueva_obra_direccion, '')), ''), 'obra', 'activa', 'empresa')
    RETURNING id INTO v_obra_id;
  END IF;

  -- Cliente: mismo criterio de dedupe por CUIT que ya usa CertificadosManager.
  IF v_presupuesto.cliente_cuit IS NOT NULL THEN
    SELECT id INTO v_cliente_id FROM compradores
    WHERE constructora_id = v_presupuesto.constructora_id AND dni_cuit = v_presupuesto.cliente_cuit;
  END IF;
  IF v_cliente_id IS NULL THEN
    INSERT INTO compradores (constructora_id, nombre_completo, dni_cuit, email, telefono)
    VALUES (v_presupuesto.constructora_id, v_presupuesto.cliente_nombre, v_presupuesto.cliente_cuit, v_presupuesto.cliente_email, v_presupuesto.cliente_telefono)
    RETURNING id INTO v_cliente_id;
  END IF;

  INSERT INTO contratos_obra (obra_id, constructora_id, cliente_id, monto_total, moneda, descripcion, presupuesto_id)
  VALUES (v_obra_id, v_presupuesto.constructora_id, v_cliente_id, v_monto_total, v_presupuesto.moneda, v_presupuesto.descripcion, p_presupuesto_id)
  RETURNING id INTO v_contrato_id;

  INSERT INTO contrato_obra_items (contrato_obra_id, constructora_id, orden, rubro, monto_contratado, origen)
  SELECT v_contrato_id, constructora_id, orden, rubro, subtotal, 'presupuesto'
  FROM presupuesto_items WHERE presupuesto_id = p_presupuesto_id;

  UPDATE presupuestos SET estado = 'aceptado', obra_id = v_obra_id, contrato_obra_id = v_contrato_id
  WHERE id = p_presupuesto_id;

  RETURN v_obra_id;
END;
$$;

-- ------------------------------------------------------------
-- 11. RLS
-- ------------------------------------------------------------
ALTER TABLE presupuestos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE presupuesto_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE contrato_obra_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificado_items   ENABLE ROW LEVEL SECURITY;

-- Presupuestos: módulo de Empresa (como proveedores/tesorería), sin obra_id
-- propio todavía — se gatea con tiene_permiso(), no tiene_permiso_proyecto().
DROP POLICY IF EXISTS "presupuestos_tenant" ON presupuestos;
CREATE POLICY "presupuestos_tenant" ON presupuestos
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('presupuestos'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('presupuestos'));

DROP POLICY IF EXISTS "presupuesto_items_tenant" ON presupuesto_items;
CREATE POLICY "presupuesto_items_tenant" ON presupuesto_items
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('presupuestos'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('presupuestos'));

-- contrato_obra_items / certificado_items: mismo módulo por-proyecto que ya
-- protege contratos_obra/certificados_avance ('certificados').
DROP POLICY IF EXISTS "contrato_obra_items_tenant" ON contrato_obra_items;
CREATE POLICY "contrato_obra_items_tenant" ON contrato_obra_items
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras())
    AND tiene_permiso_proyecto((SELECT obra_id FROM contratos_obra WHERE id = contrato_obra_id), 'certificados')
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras())
    AND tiene_permiso_proyecto((SELECT obra_id FROM contratos_obra WHERE id = contrato_obra_id), 'certificados')
  );

DROP POLICY IF EXISTS "certificado_items_tenant" ON certificado_items;
CREATE POLICY "certificado_items_tenant" ON certificado_items
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras())
    AND tiene_permiso_proyecto((SELECT obra_id FROM certificados_avance WHERE id = certificado_id), 'certificados')
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras())
    AND tiene_permiso_proyecto((SELECT obra_id FROM certificados_avance WHERE id = certificado_id), 'certificados')
  );
