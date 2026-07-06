-- ============================================================
-- MIGRATION 011: Fix completo y definitivo
-- Combina 007b (recursión) + 010 (constructora_id en perfiles)
-- Idempotente — seguro de ejecutar múltiples veces.
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================


-- ============================================================
-- PASO 1: ROMPER LA RECURSIÓN INFINITA (CRÍTICO)
-- La política original de miembros se refería a sí misma.
-- Ahora usa user_id = auth.uid() — sin subquery, sin recursión.
-- ============================================================

DROP POLICY IF EXISTS "miembros_ven_propios" ON miembros;
CREATE POLICY "miembros_ven_propios" ON miembros
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());


-- ============================================================
-- PASO 2: Columna constructora_id en perfiles
-- ============================================================

ALTER TABLE perfiles
  ADD COLUMN IF NOT EXISTS constructora_id UUID
  REFERENCES constructoras(id) ON DELETE SET NULL;


-- ============================================================
-- PASO 3: Columnas opcionales en obras, cuentas y gastos
-- ============================================================

ALTER TABLE obras
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'desarrollo'
  CHECK (tipo IN ('desarrollo', 'obra'));

ALTER TABLE cuentas_propias
  ADD COLUMN IF NOT EXISTS obra_id UUID REFERENCES obras(id) ON DELETE SET NULL;

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS obra_id UUID REFERENCES obras(id) ON DELETE SET NULL;


-- ============================================================
-- PASO 4: Backfill — vincular perfiles existentes a constructoras
-- Hacerlo ANTES de crear mis_constructoras() para que la función
-- retorne valores correctos desde el primer momento.
-- ============================================================

-- 4a. Via owner_id
UPDATE perfiles p
SET constructora_id = c.id
FROM constructoras c
WHERE c.owner_id = p.id
  AND p.constructora_id IS NULL;

-- 4b. Via miembros
UPDATE perfiles p
SET constructora_id = m.constructora_id
FROM miembros m
WHERE m.user_id = p.id
  AND p.constructora_id IS NULL;

-- 4c. Usuarios huérfanos → primera constructora disponible
DO $$
DECLARE v_cid UUID;
BEGIN
  SELECT id INTO v_cid FROM constructoras ORDER BY created_at ASC LIMIT 1;
  IF v_cid IS NOT NULL THEN
    UPDATE perfiles SET constructora_id = v_cid WHERE constructora_id IS NULL;
  END IF;
END $$;


-- ============================================================
-- PASO 5: Asegurar que auth.users sin perfil tengan uno
-- ============================================================

DO $$
DECLARE v_cid UUID;
BEGIN
  SELECT id INTO v_cid FROM constructoras ORDER BY created_at ASC LIMIT 1;

  INSERT INTO perfiles (id, nombre, rol, constructora_id)
  SELECT
    u.id,
    COALESCE(
      u.raw_user_meta_data->>'nombre',
      u.raw_user_meta_data->>'full_name',
      split_part(u.email, '@', 1),
      'Usuario'
    ),
    'operador',
    v_cid
  FROM auth.users u
  LEFT JOIN perfiles p ON p.id = u.id
  WHERE p.id IS NULL
  ON CONFLICT (id) DO NOTHING;
END $$;


-- ============================================================
-- PASO 6: Sincronizar miembros desde perfiles
-- ============================================================

INSERT INTO miembros (constructora_id, user_id, rol)
SELECT
  p.constructora_id,
  p.id,
  CASE WHEN p.rol = 'admin' THEN 'admin' ELSE 'miembro' END
FROM perfiles p
LEFT JOIN miembros m ON m.user_id = p.id AND m.constructora_id = p.constructora_id
WHERE p.constructora_id IS NOT NULL
  AND m.user_id IS NULL
ON CONFLICT DO NOTHING;


-- ============================================================
-- PASO 7: mis_constructoras() — lee de perfiles, sin recursión
-- SECURITY DEFINER → bypass RLS al leer perfiles
-- ============================================================

CREATE OR REPLACE FUNCTION mis_constructoras()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT constructora_id
  FROM perfiles
  WHERE id = auth.uid()
    AND constructora_id IS NOT NULL
$$;


-- ============================================================
-- PASO 8: Reemplazar TODAS las políticas RLS existentes
-- por versiones que usan mis_constructoras()
-- ============================================================

-- CONSTRUCTORAS
DROP POLICY IF EXISTS "constructoras_miembros_ven" ON constructoras;
CREATE POLICY "constructoras_miembros_ven" ON constructoras
  FOR SELECT TO authenticated
  USING (id IN (SELECT mis_constructoras()));

-- OBRAS
DROP POLICY IF EXISTS "obras_tenant" ON obras;
CREATE POLICY "obras_tenant" ON obras
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- TIPOLOGIAS
DROP POLICY IF EXISTS "tipologias_tenant" ON tipologias;
CREATE POLICY "tipologias_tenant" ON tipologias
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- UNIDADES
DROP POLICY IF EXISTS "unidades_tenant" ON unidades;
CREATE POLICY "unidades_tenant" ON unidades
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- CONTRATOS_VENTA
DROP POLICY IF EXISTS "contratos_tenant" ON contratos_venta;
CREATE POLICY "contratos_tenant" ON contratos_venta
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- CUOTAS
DROP POLICY IF EXISTS "cuotas_tenant" ON cuotas;
CREATE POLICY "cuotas_tenant" ON cuotas
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- RESERVAS
DROP POLICY IF EXISTS "reservas_tenant" ON reservas;
CREATE POLICY "reservas_tenant" ON reservas
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- AMENITIES
DROP POLICY IF EXISTS "amenities_tenant" ON amenities;
CREATE POLICY "amenities_tenant" ON amenities
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- AMENITY_IMAGENES
DROP POLICY IF EXISTS "amenity_imagenes_tenant" ON amenity_imagenes;
CREATE POLICY "amenity_imagenes_tenant" ON amenity_imagenes
  FOR ALL TO authenticated
  USING (
    amenity_id IN (
      SELECT id FROM amenities WHERE constructora_id IN (SELECT mis_constructoras())
    )
  )
  WITH CHECK (
    amenity_id IN (
      SELECT id FROM amenities WHERE constructora_id IN (SELECT mis_constructoras())
    )
  );

-- CUENTAS_PROPIAS
DROP POLICY IF EXISTS "cuentas_propias_tenant" ON cuentas_propias;
CREATE POLICY "cuentas_propias_tenant" ON cuentas_propias
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- PROVEEDORES
DROP POLICY IF EXISTS "proveedores_tenant" ON proveedores;
CREATE POLICY "proveedores_tenant" ON proveedores
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- CUENTAS_PROVEEDOR
DROP POLICY IF EXISTS "cuentas_proveedor_tenant" ON cuentas_proveedor;
CREATE POLICY "cuentas_proveedor_tenant" ON cuentas_proveedor
  FOR ALL TO authenticated
  USING (
    proveedor_id IN (
      SELECT id FROM proveedores WHERE constructora_id IN (SELECT mis_constructoras())
    )
  )
  WITH CHECK (
    proveedor_id IN (
      SELECT id FROM proveedores WHERE constructora_id IN (SELECT mis_constructoras())
    )
  );

-- CATEGORIAS_COSTO
DROP POLICY IF EXISTS "categorias_costo_tenant" ON categorias_costo;
CREATE POLICY "categorias_costo_tenant" ON categorias_costo
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- GASTOS
DROP POLICY IF EXISTS "gastos_tenant" ON gastos;
CREATE POLICY "gastos_tenant" ON gastos
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- PERFILES — cada usuario ve/edita solo su propio perfil
DROP POLICY IF EXISTS "perfiles_mismo_tenant"    ON perfiles;
DROP POLICY IF EXISTS "admin_edita_perfiles_tenant" ON perfiles;
DROP POLICY IF EXISTS "perfiles_propios"         ON perfiles;
CREATE POLICY "perfiles_propios" ON perfiles
  FOR ALL TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());


-- ============================================================
-- PASO 9: RLS en tablas nuevas (contratos_obra, etc.)
-- ============================================================

CREATE TABLE IF NOT EXISTS contratos_obra (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id            UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  constructora_id    UUID NOT NULL REFERENCES constructoras(id),
  cliente_nombre     TEXT NOT NULL,
  cliente_cuit       TEXT,
  cliente_email      TEXT,
  cliente_telefono   TEXT,
  monto_total        NUMERIC(15,2) NOT NULL,
  moneda             TEXT NOT NULL DEFAULT 'ARS',
  fecha_inicio       DATE,
  fecha_fin_estimada DATE,
  descripcion        TEXT,
  estado             TEXT NOT NULL DEFAULT 'vigente'
                     CHECK (estado IN ('vigente', 'terminado', 'rescindido')),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS certificados_avance (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_obra_id    UUID NOT NULL REFERENCES contratos_obra(id) ON DELETE CASCADE,
  obra_id             UUID NOT NULL REFERENCES obras(id),
  constructora_id     UUID NOT NULL REFERENCES constructoras(id),
  numero              INTEGER NOT NULL,
  periodo             TEXT NOT NULL,
  porcentaje_avance   NUMERIC(5,2) NOT NULL
                      CHECK (porcentaje_avance >= 0 AND porcentaje_avance <= 100),
  monto_certificado   NUMERIC(15,2) NOT NULL,
  descripcion_avances TEXT,
  estado              TEXT NOT NULL DEFAULT 'borrador'
                      CHECK (estado IN ('borrador', 'presentado', 'aprobado', 'cobrado')),
  fecha_presentacion  DATE,
  fecha_aprobacion    DATE,
  notas               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (contrato_obra_id, numero)
);

CREATE TABLE IF NOT EXISTS cobros_proyecto (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id          UUID NOT NULL REFERENCES obras(id),
  constructora_id  UUID NOT NULL REFERENCES constructoras(id),
  certificado_id   UUID REFERENCES certificados_avance(id) ON DELETE SET NULL,
  fecha            DATE NOT NULL,
  monto            NUMERIC(15,2) NOT NULL,
  cuenta_propia_id UUID REFERENCES cuentas_propias(id) ON DELETE SET NULL,
  notas            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contratos_obra      ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificados_avance ENABLE ROW LEVEL SECURITY;
ALTER TABLE cobros_proyecto     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contratos_obra_tenant"      ON contratos_obra;
DROP POLICY IF EXISTS "certificados_avance_tenant" ON certificados_avance;
DROP POLICY IF EXISTS "cobros_proyecto_tenant"     ON cobros_proyecto;

CREATE POLICY "contratos_obra_tenant" ON contratos_obra
  FOR ALL TO authenticated
  USING  (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

CREATE POLICY "certificados_avance_tenant" ON certificados_avance
  FOR ALL TO authenticated
  USING  (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

CREATE POLICY "cobros_proyecto_tenant" ON cobros_proyecto
  FOR ALL TO authenticated
  USING  (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));


-- ============================================================
-- PASO 10: El usuario más antiguo es admin de su constructora
-- ============================================================

UPDATE perfiles
SET rol = 'admin'
WHERE id = (
  SELECT p.id
  FROM perfiles p
  JOIN auth.users u ON u.id = p.id
  ORDER BY u.created_at ASC
  LIMIT 1
)
AND rol != 'admin';

UPDATE constructoras
SET owner_id = (
  SELECT id FROM perfiles WHERE rol = 'admin' ORDER BY created_at ASC LIMIT 1
)
WHERE owner_id IS NULL;


-- ============================================================
-- PASO 11: Trigger — nuevo auth.user → perfil + miembro
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cid   UUID;
  v_nombre TEXT;
BEGIN
  v_nombre := COALESCE(
    NEW.raw_user_meta_data->>'nombre',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1),
    'Usuario'
  );

  SELECT id INTO v_cid FROM constructoras ORDER BY created_at ASC LIMIT 1;

  INSERT INTO perfiles (id, nombre, rol, constructora_id)
  VALUES (NEW.id, v_nombre, 'operador', v_cid)
  ON CONFLICT (id) DO UPDATE
    SET constructora_id = EXCLUDED.constructora_id
    WHERE perfiles.constructora_id IS NULL;

  IF v_cid IS NOT NULL THEN
    INSERT INTO miembros (constructora_id, user_id, rol)
    VALUES (v_cid, NEW.id, 'miembro')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();


-- ============================================================
-- VERIFICACIÓN — ejecutar estas queries para confirmar
-- ============================================================
-- SELECT id, nombre, rol, constructora_id FROM perfiles;
-- SELECT mis_constructoras();   -- estando logueado muestra tu constructora_id
-- SELECT constructora_id, user_id, rol FROM miembros ORDER BY constructora_id;
