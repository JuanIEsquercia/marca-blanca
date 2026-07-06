-- ============================================================
-- MIGRATION 007: Arquitectura multi-tenant
-- Un solo proyecto Supabase — separación por constructora_id + RLS
--
-- Nuevas tablas: constructoras, miembros, obras
-- Cambios en tablas existentes: columnas constructora_id y obra_id
-- RLS actualizado para aislar datos por tenant
-- ============================================================

-- ============================================================
-- 1. TABLAS DEL MODELO MULTI-TENANT
-- ============================================================

CREATE TABLE IF NOT EXISTS constructoras (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre      TEXT NOT NULL,
  owner_id    UUID REFERENCES perfiles(id) ON DELETE SET NULL,
  activa      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Relación usuario <-> constructora
CREATE TABLE IF NOT EXISTS miembros (
  constructora_id UUID NOT NULL REFERENCES constructoras(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  rol             TEXT NOT NULL DEFAULT 'miembro',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (constructora_id, user_id)
);

-- Proyectos/desarrollos dentro de una constructora
CREATE TABLE IF NOT EXISTS obras (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  constructora_id UUID NOT NULL REFERENCES constructoras(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  direccion       TEXT,
  estado          TEXT NOT NULL DEFAULT 'activa'
    CONSTRAINT obras_estado_check CHECK (estado IN ('activa', 'finalizada', 'pausada')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. AGREGAR COLUMNAS TENANT A TABLAS EXISTENTES
--    (nullable para que el backfill no explote)
-- ============================================================

-- Tablas con obra_id (datos específicos de un proyecto)
ALTER TABLE tipologias      ADD COLUMN IF NOT EXISTS constructora_id UUID REFERENCES constructoras(id);
ALTER TABLE tipologias      ADD COLUMN IF NOT EXISTS obra_id         UUID REFERENCES obras(id);

ALTER TABLE unidades        ADD COLUMN IF NOT EXISTS constructora_id UUID REFERENCES constructoras(id);
ALTER TABLE unidades        ADD COLUMN IF NOT EXISTS obra_id         UUID REFERENCES obras(id);

ALTER TABLE amenities       ADD COLUMN IF NOT EXISTS constructora_id UUID REFERENCES constructoras(id);
ALTER TABLE amenities       ADD COLUMN IF NOT EXISTS obra_id         UUID REFERENCES obras(id);

ALTER TABLE contratos_venta ADD COLUMN IF NOT EXISTS constructora_id UUID REFERENCES constructoras(id);
ALTER TABLE contratos_venta ADD COLUMN IF NOT EXISTS obra_id         UUID REFERENCES obras(id);

ALTER TABLE reservas        ADD COLUMN IF NOT EXISTS constructora_id UUID REFERENCES constructoras(id);
ALTER TABLE reservas        ADD COLUMN IF NOT EXISTS obra_id         UUID REFERENCES obras(id);

ALTER TABLE leads           ADD COLUMN IF NOT EXISTS constructora_id UUID REFERENCES constructoras(id);
ALTER TABLE leads           ADD COLUMN IF NOT EXISTS obra_id         UUID REFERENCES obras(id);

ALTER TABLE gastos          ADD COLUMN IF NOT EXISTS constructora_id UUID REFERENCES constructoras(id);
ALTER TABLE gastos          ADD COLUMN IF NOT EXISTS obra_id         UUID REFERENCES obras(id);

-- Tablas con solo constructora_id (datos a nivel empresa)
ALTER TABLE compradores      ADD COLUMN IF NOT EXISTS constructora_id UUID REFERENCES constructoras(id);
ALTER TABLE cuotas           ADD COLUMN IF NOT EXISTS constructora_id UUID REFERENCES constructoras(id);
ALTER TABLE cuentas_propias  ADD COLUMN IF NOT EXISTS constructora_id UUID REFERENCES constructoras(id);
ALTER TABLE proveedores      ADD COLUMN IF NOT EXISTS constructora_id UUID REFERENCES constructoras(id);
ALTER TABLE cuentas_proveedor ADD COLUMN IF NOT EXISTS constructora_id UUID REFERENCES constructoras(id);
ALTER TABLE categorias_costo  ADD COLUMN IF NOT EXISTS constructora_id UUID REFERENCES constructoras(id);

-- ============================================================
-- 3. TRIGGERS PARA AUTO-PROPAGAR constructora_id / obra_id
--    (contratos y reservas derivan el tenant de la unidad)
-- ============================================================

-- Trigger: contratos_venta hereda tenant de su unidad
CREATE OR REPLACE FUNCTION set_contrato_tenant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.constructora_id IS NULL OR NEW.obra_id IS NULL THEN
    SELECT constructora_id, obra_id
    INTO NEW.constructora_id, NEW.obra_id
    FROM unidades WHERE id = NEW.unidad_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contrato_tenant ON contratos_venta;
CREATE TRIGGER trg_contrato_tenant
  BEFORE INSERT ON contratos_venta
  FOR EACH ROW EXECUTE FUNCTION set_contrato_tenant();

-- Trigger: reservas hereda tenant de su unidad
CREATE OR REPLACE FUNCTION set_reserva_tenant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.constructora_id IS NULL OR NEW.obra_id IS NULL THEN
    SELECT constructora_id, obra_id
    INTO NEW.constructora_id, NEW.obra_id
    FROM unidades WHERE id = NEW.unidad_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reserva_tenant ON reservas;
CREATE TRIGGER trg_reserva_tenant
  BEFORE INSERT ON reservas
  FOR EACH ROW EXECUTE FUNCTION set_reserva_tenant();

-- Trigger: cuotas hereda constructora de su contrato
CREATE OR REPLACE FUNCTION generar_cuotas_contrato()
RETURNS TRIGGER AS $$
DECLARE
  saldo_restante  DECIMAL(15,2);
  monto_cuota     DECIMAL(15,2);
  i               INTEGER;
  fecha_venc      DATE;
BEGIN
  saldo_restante := NEW.precio_final - NEW.entrega_efectiva;
  monto_cuota    := ROUND(saldo_restante / NEW.cantidad_cuotas, 2);

  FOR i IN 1..NEW.cantidad_cuotas LOOP
    fecha_venc := (NEW.fecha_firma + (i * INTERVAL '1 month'))::DATE;
    INSERT INTO cuotas (contrato_id, constructora_id, numero_cuota, monto_base, fecha_vencimiento)
    VALUES (NEW.id, NEW.constructora_id, i, monto_cuota, fecha_venc);
  END LOOP;

  -- Ajuste de diferencia de centavos en última cuota
  UPDATE cuotas
  SET monto_base = monto_base + (saldo_restante - (monto_cuota * NEW.cantidad_cuotas))
  WHERE contrato_id = NEW.id AND numero_cuota = NEW.cantidad_cuotas;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: cuentas_proveedor hereda constructora de su proveedor
CREATE OR REPLACE FUNCTION set_cuenta_proveedor_tenant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.constructora_id IS NULL THEN
    SELECT constructora_id INTO NEW.constructora_id
    FROM proveedores WHERE id = NEW.proveedor_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cuenta_proveedor_tenant ON cuentas_proveedor;
CREATE TRIGGER trg_cuenta_proveedor_tenant
  BEFORE INSERT ON cuentas_proveedor
  FOR EACH ROW EXECUTE FUNCTION set_cuenta_proveedor_tenant();

-- ============================================================
-- 4. BACKFILL: crear constructora y obra por defecto para datos existentes
-- ============================================================

DO $$
DECLARE
  v_admin_id       UUID;
  v_constructora_id UUID;
  v_obra_id        UUID;
BEGIN
  -- Buscar primer admin; fallback al primer usuario
  SELECT id INTO v_admin_id FROM perfiles WHERE rol = 'admin' ORDER BY created_at LIMIT 1;
  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id FROM perfiles ORDER BY created_at LIMIT 1;
  END IF;

  -- Solo migrar si hay usuarios existentes
  IF v_admin_id IS NOT NULL THEN
    -- Crear constructora por defecto
    INSERT INTO constructoras (nombre, owner_id)
    VALUES ('Mi Constructora', v_admin_id)
    RETURNING id INTO v_constructora_id;

    -- Crear obra por defecto
    INSERT INTO obras (constructora_id, nombre)
    VALUES (v_constructora_id, 'Desarrollo Principal')
    RETURNING id INTO v_obra_id;

    -- Agregar todos los usuarios existentes como miembros
    INSERT INTO miembros (constructora_id, user_id, rol)
    SELECT v_constructora_id, id,
      CASE WHEN rol = 'admin' THEN 'admin' ELSE 'miembro' END
    FROM perfiles
    ON CONFLICT DO NOTHING;

    -- Backfill tablas con obra_id
    UPDATE tipologias      SET constructora_id = v_constructora_id, obra_id = v_obra_id WHERE constructora_id IS NULL;
    UPDATE unidades        SET constructora_id = v_constructora_id, obra_id = v_obra_id WHERE constructora_id IS NULL;
    UPDATE amenities       SET constructora_id = v_constructora_id, obra_id = v_obra_id WHERE constructora_id IS NULL;
    UPDATE contratos_venta SET constructora_id = v_constructora_id, obra_id = v_obra_id WHERE constructora_id IS NULL;
    UPDATE reservas        SET constructora_id = v_constructora_id, obra_id = v_obra_id WHERE constructora_id IS NULL;
    UPDATE leads           SET constructora_id = v_constructora_id, obra_id = v_obra_id WHERE constructora_id IS NULL;
    UPDATE gastos          SET constructora_id = v_constructora_id, obra_id = v_obra_id WHERE constructora_id IS NULL;

    -- Backfill tablas solo con constructora_id
    UPDATE compradores       SET constructora_id = v_constructora_id WHERE constructora_id IS NULL;
    UPDATE cuotas            SET constructora_id = v_constructora_id WHERE constructora_id IS NULL;
    UPDATE cuentas_propias   SET constructora_id = v_constructora_id WHERE constructora_id IS NULL;
    UPDATE proveedores       SET constructora_id = v_constructora_id WHERE constructora_id IS NULL;
    UPDATE cuentas_proveedor SET constructora_id = v_constructora_id WHERE constructora_id IS NULL;
    UPDATE categorias_costo  SET constructora_id = v_constructora_id WHERE constructora_id IS NULL;
  END IF;
END $$;

-- ============================================================
-- 5. HACER NOT NULL (después del backfill)
-- ============================================================

-- Tablas con obra_id
ALTER TABLE tipologias      ALTER COLUMN constructora_id SET NOT NULL;
ALTER TABLE tipologias      ALTER COLUMN obra_id         SET NOT NULL;

ALTER TABLE unidades        ALTER COLUMN constructora_id SET NOT NULL;
ALTER TABLE unidades        ALTER COLUMN obra_id         SET NOT NULL;

ALTER TABLE amenities       ALTER COLUMN constructora_id SET NOT NULL;
ALTER TABLE amenities       ALTER COLUMN obra_id         SET NOT NULL;

ALTER TABLE contratos_venta ALTER COLUMN constructora_id SET NOT NULL;
ALTER TABLE contratos_venta ALTER COLUMN obra_id         SET NOT NULL;

ALTER TABLE reservas        ALTER COLUMN constructora_id SET NOT NULL;
ALTER TABLE reservas        ALTER COLUMN obra_id         SET NOT NULL;

ALTER TABLE leads           ALTER COLUMN constructora_id SET NOT NULL;
ALTER TABLE leads           ALTER COLUMN obra_id         SET NOT NULL;

ALTER TABLE gastos          ALTER COLUMN constructora_id SET NOT NULL;

-- Tablas solo constructora_id
ALTER TABLE compradores      ALTER COLUMN constructora_id SET NOT NULL;
ALTER TABLE cuotas           ALTER COLUMN constructora_id SET NOT NULL;
ALTER TABLE cuentas_propias  ALTER COLUMN constructora_id SET NOT NULL;
ALTER TABLE proveedores      ALTER COLUMN constructora_id SET NOT NULL;
ALTER TABLE categorias_costo ALTER COLUMN constructora_id SET NOT NULL;
-- Nota: gastos.obra_id es opcional (gastos administrativos sin obra específica)
-- Nota: cuentas_proveedor.constructora_id se llena vía trigger (puede quedar nullable)

-- ============================================================
-- 6. ACTUALIZAR CONSTRAINTS ÚNICOS
-- ============================================================

-- unidades: el número de unidad es único dentro de una obra, no globalmente
ALTER TABLE unidades DROP CONSTRAINT IF EXISTS unidades_piso_numero_letra_key;
ALTER TABLE unidades ADD CONSTRAINT unidades_obra_piso_numero_key UNIQUE (obra_id, piso, numero, letra);

-- compradores: el DNI es único dentro de una constructora
ALTER TABLE compradores DROP CONSTRAINT IF EXISTS compradores_dni_cuit_key;
ALTER TABLE compradores ADD CONSTRAINT compradores_constructora_dni_key UNIQUE (constructora_id, dni_cuit);

-- ============================================================
-- 7. ROW LEVEL SECURITY — REEMPLAZAR POLÍTICAS
-- ============================================================

-- Nuevas tablas: RLS habilitado
ALTER TABLE constructoras    ENABLE ROW LEVEL SECURITY;
ALTER TABLE miembros         ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras            ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────
-- CONSTRUCTORAS
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "constructoras_miembros_ven" ON constructoras;
CREATE POLICY "constructoras_miembros_ven" ON constructoras
  FOR SELECT TO authenticated
  USING (
    id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "constructoras_owner_edita" ON constructoras;
CREATE POLICY "constructoras_owner_edita" ON constructoras
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ──────────────────────────────────────────────────
-- MIEMBROS
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "miembros_ven_propios" ON miembros;
CREATE POLICY "miembros_ven_propios" ON miembros
  FOR SELECT TO authenticated
  USING (
    constructora_id IN (SELECT constructora_id FROM miembros m2 WHERE m2.user_id = auth.uid())
  );

-- ──────────────────────────────────────────────────
-- OBRAS
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "obras_tenant" ON obras;
CREATE POLICY "obras_tenant" ON obras
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()))
  WITH CHECK (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()));

-- ──────────────────────────────────────────────────
-- TIPOLOGIAS
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "tipologias_lectura_publica" ON tipologias;
DROP POLICY IF EXISTS "tipologias_escritura_autenticados" ON tipologias;
DROP POLICY IF EXISTS "anon puede ver tipologias" ON tipologias;

CREATE POLICY "tipologias_anon_lee" ON tipologias
  FOR SELECT TO anon USING (true);

CREATE POLICY "tipologias_tenant" ON tipologias
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()))
  WITH CHECK (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()));

-- ──────────────────────────────────────────────────
-- UNIDADES
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "unidades_lectura_publica" ON unidades;
DROP POLICY IF EXISTS "unidades_todo_autenticados" ON unidades;
DROP POLICY IF EXISTS "anon puede ver unidades publicas" ON unidades;

CREATE POLICY "unidades_anon_lee_publicas" ON unidades
  FOR SELECT TO anon
  USING (estado_comercial IN ('Disponible', 'Reservado'));

CREATE POLICY "unidades_tenant" ON unidades
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()))
  WITH CHECK (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()));

-- ──────────────────────────────────────────────────
-- COMPRADORES
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "compradores_solo_autenticados" ON compradores;

CREATE POLICY "compradores_tenant" ON compradores
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()))
  WITH CHECK (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()));

-- ──────────────────────────────────────────────────
-- CONTRATOS_VENTA
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "contratos_solo_autenticados" ON contratos_venta;

CREATE POLICY "contratos_tenant" ON contratos_venta
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()))
  WITH CHECK (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()));

-- ──────────────────────────────────────────────────
-- CUOTAS
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "cuotas_solo_autenticados" ON cuotas;

CREATE POLICY "cuotas_tenant" ON cuotas
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()))
  WITH CHECK (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()));

-- ──────────────────────────────────────────────────
-- RESERVAS
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_reservas" ON reservas;

CREATE POLICY "reservas_tenant" ON reservas
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()))
  WITH CHECK (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()));

-- ──────────────────────────────────────────────────
-- LEADS
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_leads" ON leads;

CREATE POLICY "leads_tenant" ON leads
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()))
  WITH CHECK (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()));

-- ──────────────────────────────────────────────────
-- AMENITIES
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "amenities_lectura_publica" ON amenities;
DROP POLICY IF EXISTS "amenities_escritura_autenticados" ON amenities;

CREATE POLICY "amenities_anon_lee" ON amenities
  FOR SELECT TO anon USING (activo = true);

CREATE POLICY "amenities_tenant" ON amenities
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()))
  WITH CHECK (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()));

-- amenity_imagenes: la seguridad se hereda vía JOIN (lectura pública, escritura autenticada + tenant check)
DROP POLICY IF EXISTS "amenity_imagenes_lectura_publica" ON amenity_imagenes;
DROP POLICY IF EXISTS "amenity_imagenes_escritura_autenticados" ON amenity_imagenes;

CREATE POLICY "amenity_imagenes_anon_lee" ON amenity_imagenes
  FOR SELECT TO anon USING (true);

CREATE POLICY "amenity_imagenes_tenant" ON amenity_imagenes
  FOR ALL TO authenticated
  USING (
    amenity_id IN (
      SELECT id FROM amenities
      WHERE constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    amenity_id IN (
      SELECT id FROM amenities
      WHERE constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid())
    )
  );

-- ──────────────────────────────────────────────────
-- CUENTAS_PROPIAS
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_cuentas_propias" ON cuentas_propias;

CREATE POLICY "cuentas_propias_tenant" ON cuentas_propias
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()))
  WITH CHECK (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()));

-- ──────────────────────────────────────────────────
-- PROVEEDORES
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_proveedores" ON proveedores;

CREATE POLICY "proveedores_tenant" ON proveedores
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()))
  WITH CHECK (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()));

-- ──────────────────────────────────────────────────
-- CUENTAS_PROVEEDOR
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_cuentas_proveedor" ON cuentas_proveedor;

CREATE POLICY "cuentas_proveedor_tenant" ON cuentas_proveedor
  FOR ALL TO authenticated
  USING (
    proveedor_id IN (
      SELECT id FROM proveedores
      WHERE constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    proveedor_id IN (
      SELECT id FROM proveedores
      WHERE constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid())
    )
  );

-- ──────────────────────────────────────────────────
-- CATEGORIAS_COSTO
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_categorias_costo" ON categorias_costo;

CREATE POLICY "categorias_costo_tenant" ON categorias_costo
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()))
  WITH CHECK (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()));

-- ──────────────────────────────────────────────────
-- GASTOS
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_gastos" ON gastos;

CREATE POLICY "gastos_tenant" ON gastos
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()))
  WITH CHECK (constructora_id IN (SELECT constructora_id FROM miembros WHERE user_id = auth.uid()));

-- ──────────────────────────────────────────────────
-- PERFILES — actualizar para que admins de constructora puedan ver a sus miembros
-- ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "perfil_propio" ON perfiles;
DROP POLICY IF EXISTS "admin_ve_todos_perfiles" ON perfiles;

CREATE POLICY "perfil_propio" ON perfiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "perfiles_mismo_tenant" ON perfiles
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT user_id FROM miembros
      WHERE constructora_id IN (
        SELECT constructora_id FROM miembros m2 WHERE m2.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "admin_edita_perfiles_tenant" ON perfiles
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM miembros m
      JOIN miembros m2 ON m2.constructora_id = m.constructora_id
      WHERE m.user_id = id AND m2.user_id = auth.uid() AND m2.rol = 'admin'
    )
  );

-- ============================================================
-- 8. ÍNDICES DE PERFORMANCE
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_miembros_user_id      ON miembros(user_id);
CREATE INDEX IF NOT EXISTS idx_miembros_constructora  ON miembros(constructora_id);
CREATE INDEX IF NOT EXISTS idx_obras_constructora     ON obras(constructora_id);

CREATE INDEX IF NOT EXISTS idx_tipologias_obra        ON tipologias(obra_id);
CREATE INDEX IF NOT EXISTS idx_unidades_obra          ON unidades(obra_id);
CREATE INDEX IF NOT EXISTS idx_unidades_constructora  ON unidades(constructora_id);
CREATE INDEX IF NOT EXISTS idx_amenities_obra         ON amenities(obra_id);
CREATE INDEX IF NOT EXISTS idx_contratos_constructora ON contratos_venta(constructora_id);
CREATE INDEX IF NOT EXISTS idx_contratos_obra         ON contratos_venta(obra_id);
CREATE INDEX IF NOT EXISTS idx_reservas_constructora  ON reservas(constructora_id);
CREATE INDEX IF NOT EXISTS idx_cuotas_constructora    ON cuotas(constructora_id);
CREATE INDEX IF NOT EXISTS idx_leads_constructora     ON leads(constructora_id);
CREATE INDEX IF NOT EXISTS idx_gastos_constructora    ON gastos(constructora_id);
CREATE INDEX IF NOT EXISTS idx_proveedores_constructora ON proveedores(constructora_id);
CREATE INDEX IF NOT EXISTS idx_compradores_constructora ON compradores(constructora_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_propias_constructora ON cuentas_propias(constructora_id);
CREATE INDEX IF NOT EXISTS idx_categorias_constructora ON categorias_costo(constructora_id);

-- ============================================================
-- 9. ACTUALIZAR VISTA PÚBLICA (expone obra_id para la landing)
-- ============================================================

DROP VIEW IF EXISTS vista_stock_publico;

CREATE OR REPLACE VIEW vista_stock_publico
WITH (security_invoker = true)
AS
SELECT
  u.id,
  u.constructora_id,
  u.obra_id,
  u.piso,
  u.numero,
  u.letra,
  u.orientacion,
  u.precio_lista,
  u.entrega_minima_pct,
  u.max_cuotas,
  u.estado_comercial,
  t.id            AS tipologia_id,
  t.nombre        AS tipologia_nombre,
  t.descripcion   AS tipologia_descripcion,
  t.url_recorrido_360,
  COALESCE(u.m2, t.m2_propios)                              AS m2_propios,
  t.m2_comunes,
  COALESCE(u.m2, t.m2_propios) + t.m2_comunes              AS m2_totales,
  ROUND(
    u.precio_lista / NULLIF(COALESCE(u.m2, t.m2_propios) + t.m2_comunes, 0),
    2
  )                                                          AS precio_por_m2,
  ROUND(u.precio_lista * u.entrega_minima_pct / 100, 2)     AS monto_entrega_minima
FROM unidades u
JOIN tipologias t ON t.id = u.tipologia_id
WHERE u.estado_comercial IN ('Disponible', 'Reservado');

GRANT SELECT ON vista_stock_publico TO anon;

-- ============================================================
-- 10. FUNCIÓN HELPER: sembrar categorías por defecto para nueva constructora
--     Llamar al crear una nueva constructora en el onboarding
-- ============================================================

CREATE OR REPLACE FUNCTION seed_constructora_defaults(p_constructora_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO categorias_costo (constructora_id, nombre, color) VALUES
    (p_constructora_id, 'Materiales',               '#f59e0b'),
    (p_constructora_id, 'Mano de obra',              '#ef4444'),
    (p_constructora_id, 'Honorarios profesionales',  '#8b5cf6'),
    (p_constructora_id, 'Marketing y ventas',        '#06b6d4'),
    (p_constructora_id, 'Gastos administrativos',    '#64748b'),
    (p_constructora_id, 'Terreno',                   '#10b981'),
    (p_constructora_id, 'Impuestos y tasas',         '#f97316')
  ON CONFLICT DO NOTHING;
END;
$$;
