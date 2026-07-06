-- ============================================================
-- MIGRATION 010: Fix completo e idempotente
-- Resuelve el estado roto dejado por migration_009 parcial.
-- Seguro de ejecutar múltiples veces.
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================


-- ============================================================
-- PASO 1: Columna constructora_id en perfiles
-- DEBE ir antes de crear mis_constructoras() que la referencia
-- ============================================================

ALTER TABLE perfiles
  ADD COLUMN IF NOT EXISTS constructora_id UUID
  REFERENCES constructoras(id) ON DELETE SET NULL;


-- ============================================================
-- PASO 2: mis_constructoras() — lee de perfiles, sin recursión
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
-- PASO 3: Columnas opcionales necesarias para el ERP
-- ============================================================

-- obras.tipo — tipo de proyecto (DESARROLLO o OBRA)
ALTER TABLE obras
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'desarrollo'
  CHECK (tipo IN ('desarrollo', 'obra'));

-- obra_id en cuentas y gastos — para imputar a proyecto
ALTER TABLE cuentas_propias
  ADD COLUMN IF NOT EXISTS obra_id UUID REFERENCES obras(id) ON DELETE SET NULL;

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS obra_id UUID REFERENCES obras(id) ON DELETE SET NULL;


-- ============================================================
-- PASO 4: Tablas para proyectos tipo OBRA
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


-- ============================================================
-- PASO 5: RLS en tablas nuevas
-- ============================================================

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
-- PASO 6: Backfill — vincular perfiles existentes a constructoras
-- ============================================================

-- 6a. Via owner_id: si el usuario es dueño de una constructora
UPDATE perfiles p
SET constructora_id = c.id
FROM constructoras c
WHERE c.owner_id = p.id
  AND p.constructora_id IS NULL;

-- 6b. Via miembros: si ya tiene un registro de membresía
UPDATE perfiles p
SET constructora_id = m.constructora_id
FROM miembros m
WHERE m.user_id = p.id
  AND p.constructora_id IS NULL;

-- 6c. Para usuarios huérfanos: asignar a la primera constructora disponible
DO $$
DECLARE
  v_constructora_id UUID;
BEGIN
  SELECT id INTO v_constructora_id
  FROM constructoras
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_constructora_id IS NOT NULL THEN
    UPDATE perfiles
    SET constructora_id = v_constructora_id
    WHERE constructora_id IS NULL;
  END IF;
END $$;

-- 6d. Sincronizar tabla miembros con el estado final de perfiles
INSERT INTO miembros (constructora_id, user_id, rol)
SELECT
  p.constructora_id,
  p.id,
  CASE WHEN p.rol = 'admin' THEN 'admin' ELSE 'miembro' END
FROM perfiles p
LEFT JOIN miembros m
  ON m.user_id = p.id AND m.constructora_id = p.constructora_id
WHERE p.constructora_id IS NOT NULL
  AND m.user_id IS NULL
ON CONFLICT DO NOTHING;


-- ============================================================
-- PASO 7: Asegurar que auth.users sin perfil tengan uno
-- ============================================================

DO $$
DECLARE
  v_constructora_id UUID;
BEGIN
  SELECT id INTO v_constructora_id
  FROM constructoras
  ORDER BY created_at ASC
  LIMIT 1;

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
    v_constructora_id
  FROM auth.users u
  LEFT JOIN perfiles p ON p.id = u.id
  WHERE p.id IS NULL
  ON CONFLICT (id) DO NOTHING;

  -- Sincronizar miembros para perfiles recién creados
  IF v_constructora_id IS NOT NULL THEN
    INSERT INTO miembros (constructora_id, user_id, rol)
    SELECT v_constructora_id, p.id, 'miembro'
    FROM perfiles p
    LEFT JOIN miembros m
      ON m.user_id = p.id AND m.constructora_id = v_constructora_id
    WHERE m.user_id IS NULL
    ON CONFLICT DO NOTHING;
  END IF;
END $$;


-- ============================================================
-- PASO 8: El usuario registrado más antiguo es admin
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

-- Si alguna constructora quedó sin owner, asignar el admin más antiguo
UPDATE constructoras
SET owner_id = (
  SELECT id FROM perfiles WHERE rol = 'admin' ORDER BY created_at ASC LIMIT 1
)
WHERE owner_id IS NULL;


-- ============================================================
-- PASO 9: Trigger — nuevo usuario → perfil + miembro automático
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_constructora_id UUID;
  v_nombre          TEXT;
BEGIN
  v_nombre := COALESCE(
    NEW.raw_user_meta_data->>'nombre',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1),
    'Usuario'
  );

  SELECT id INTO v_constructora_id
  FROM constructoras
  ORDER BY created_at ASC
  LIMIT 1;

  INSERT INTO perfiles (id, nombre, rol, constructora_id)
  VALUES (NEW.id, v_nombre, 'operador', v_constructora_id)
  ON CONFLICT (id) DO UPDATE
    SET constructora_id = EXCLUDED.constructora_id
    WHERE perfiles.constructora_id IS NULL;

  IF v_constructora_id IS NOT NULL THEN
    INSERT INTO miembros (constructora_id, user_id, rol)
    VALUES (v_constructora_id, NEW.id, 'miembro')
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
-- VERIFICACIÓN — ejecutar después para confirmar el estado
-- ============================================================
-- SELECT id, nombre, rol, constructora_id FROM perfiles;
-- SELECT constructora_id, user_id, rol FROM miembros;
-- SELECT id, nombre, owner_id FROM constructoras;
