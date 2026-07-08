-- ============================================================
-- SCHEMA CANÓNICO — ERP multi-tenant para constructoras
-- Refleja el estado final acumulado de schema.sql + migration_001
-- a migration_017. Ver supabase/README.md para la convención.
--
-- Este archivo es SOLO REFERENCIA / bootstrap de un ambiente nuevo.
-- El proyecto Supabase existente NO necesita correrlo: ya llegó a
-- este estado a través de las migraciones incrementales.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================
DO $$ BEGIN
  CREATE TYPE estado_comercial AS ENUM ('Disponible', 'Reservado', 'Vendido');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_pago AS ENUM ('Pendiente', 'Pagado', 'Vencido');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE rol_usuario AS ENUM ('admin', 'operador');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- NIVEL PLATAFORMA / TENANT
-- ============================================================

-- Extiende auth.users. constructora_id (agregada más abajo, una vez que
-- existe la tabla constructoras — hay dependencia circular perfiles<->
-- constructoras vía owner_id/constructora_id) es la fuente de verdad
-- del tenant de cada usuario (mis_constructoras() lee de acá).
CREATE TABLE IF NOT EXISTS perfiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  nombre      TEXT NOT NULL,
  rol         rol_usuario NOT NULL DEFAULT 'operador',
  activo      BOOLEAN NOT NULL DEFAULT true,
  permisos    TEXT[] DEFAULT NULL,  -- NULL = sin restricción (admin/legado); [] = ningún módulo; ['gastos',...] = allowlist
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS constructoras (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre      TEXT NOT NULL,
  owner_id    UUID REFERENCES perfiles(id) ON DELETE SET NULL,
  activa      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE perfiles
  ADD COLUMN IF NOT EXISTS constructora_id UUID REFERENCES constructoras(id) ON DELETE SET NULL;

-- Relación usuario <-> constructora. Secundaria a perfiles.constructora_id
-- (que es lo que usa el RLS vía mis_constructoras()) — se mantiene
-- sincronizada por la app (ver app/api/admin/usuarios/route.ts y
-- app/api/superadmin/constructoras/route.ts) para uso futuro
-- (auditoría de membresías, eventual multi-constructora por usuario).
CREATE TABLE IF NOT EXISTS miembros (
  constructora_id UUID NOT NULL REFERENCES constructoras(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  rol             TEXT NOT NULL DEFAULT 'miembro',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (constructora_id, user_id)
);

-- Proyectos dentro de una constructora. tipo determina qué flujo usa
-- (desarrollo = venta de unidades, obra = construcción por contrato).
CREATE TABLE IF NOT EXISTS obras (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  constructora_id UUID NOT NULL REFERENCES constructoras(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  direccion       TEXT,
  estado          TEXT NOT NULL DEFAULT 'activa'
    CHECK (estado IN ('activa', 'finalizada', 'pausada')),
  tipo            TEXT NOT NULL DEFAULT 'desarrollo'
    CHECK (tipo IN ('desarrollo', 'obra')),
  modo_cuentas    TEXT NOT NULL DEFAULT 'empresa'
    CHECK (modo_cuentas IN ('empresa', 'especificas')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- NULL = operador de toda la constructora (o admin). Un valor acota al
-- operador a esa obra — ver mi_obra_id() y las policies que lo usan.
ALTER TABLE perfiles
  ADD COLUMN IF NOT EXISTS obra_id UUID REFERENCES obras(id) ON DELETE SET NULL;

-- ============================================================
-- NIVEL EMPRESA — TESORERÍA / PROVEEDORES / GASTOS
-- (compartido entre proyectos, salvo que un proyecto pida
-- cuentas propias vía obras.modo_cuentas = 'especificas')
-- Se define antes de FLUJO DESARROLLO porque contratos_venta/
-- cuotas/reservas referencian cuentas_propias.
-- ============================================================

CREATE TABLE IF NOT EXISTS cuentas_propias (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  constructora_id UUID NOT NULL REFERENCES constructoras(id),
  obra_id        UUID REFERENCES obras(id) ON DELETE SET NULL,  -- NULL = cuenta de empresa, no de un proyecto
  nombre         TEXT NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'banco',   -- 'banco' | 'caja'
  moneda         TEXT NOT NULL DEFAULT 'USD',     -- 'ARS' | 'USD'
  saldo_inicial  DECIMAL(15,2) NOT NULL DEFAULT 0,
  activa         BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID REFERENCES auth.users(id),
  updated_by     UUID REFERENCES auth.users(id),
  updated_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proveedores (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  constructora_id UUID NOT NULL REFERENCES constructoras(id),
  razon_social    TEXT NOT NULL,
  cuit            TEXT,
  email           TEXT,
  telefono        TEXT,
  direccion       TEXT,
  notas           TEXT,
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cuentas_proveedor (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  constructora_id UUID REFERENCES constructoras(id),  -- se completa vía trigger desde proveedor_id
  proveedor_id    UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL DEFAULT 'CBU',    -- 'CBU' | 'Alias' | 'Efectivo' | 'Cheque' | 'Otro'
  denominacion    TEXT,
  numero          TEXT,
  moneda          TEXT NOT NULL DEFAULT 'ARS',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categorias_costo (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  constructora_id UUID NOT NULL REFERENCES constructoras(id),
  nombre          TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT '#6366f1',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gastos (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  constructora_id      UUID NOT NULL REFERENCES constructoras(id),
  obra_id              UUID REFERENCES obras(id) ON DELETE SET NULL,  -- NULL = gasto administrativo de empresa
  proveedor_id         UUID REFERENCES proveedores(id),
  cuenta_proveedor_id  UUID REFERENCES cuentas_proveedor(id),
  categoria_id         UUID REFERENCES categorias_costo(id),
  cuenta_propia_id     UUID REFERENCES cuentas_propias(id),
  descripcion          TEXT NOT NULL,
  monto                DECIMAL(15,2) NOT NULL,
  moneda               TEXT NOT NULL DEFAULT 'ARS',
  fecha_vencimiento    DATE NOT NULL,
  fecha_pago           DATE,
  estado               TEXT NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente', 'Pagado')),
  numero_comprobante   TEXT,
  comprobante_url      TEXT,
  notas                TEXT,
  monto_neto           DECIMAL(15,2),  -- desglose informativo (OCR de factura), no afecta cálculos de tesorería/caja
  iva                  DECIMAL(15,2),
  percepciones         DECIMAL(15,2),
  created_by           UUID REFERENCES auth.users(id),
  updated_by           UUID REFERENCES auth.users(id),
  updated_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FLUJO DESARROLLO (venta de unidades)
-- ============================================================

CREATE TABLE IF NOT EXISTS tipologias (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  constructora_id   UUID NOT NULL REFERENCES constructoras(id),
  obra_id           UUID NOT NULL REFERENCES obras(id),
  nombre            TEXT NOT NULL,
  m2_propios        DECIMAL(10,2) NOT NULL,
  m2_comunes        DECIMAL(10,2) NOT NULL DEFAULT 0,
  m2_totales        DECIMAL(10,2) GENERATED ALWAYS AS (m2_propios + m2_comunes) STORED,
  descripcion       TEXT,
  url_recorrido_360 TEXT,
  imagen_portada    TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS unidades (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  constructora_id     UUID NOT NULL REFERENCES constructoras(id),
  obra_id             UUID NOT NULL REFERENCES obras(id),
  piso                INTEGER NOT NULL,
  numero              TEXT NOT NULL,
  letra               TEXT,
  orientacion         TEXT,
  m2                  DECIMAL(8,2),
  tipologia_id        UUID REFERENCES tipologias(id) NOT NULL,
  precio_lista        DECIMAL(15,2) NOT NULL,
  entrega_minima_pct  DECIMAL(5,2) NOT NULL DEFAULT 30,
  max_cuotas          INTEGER NOT NULL DEFAULT 36,
  estado_comercial    estado_comercial NOT NULL DEFAULT 'Disponible',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (obra_id, piso, numero, letra)
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS unidades_updated_at ON unidades;
CREATE TRIGGER unidades_updated_at
  BEFORE UPDATE ON unidades
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS amenities (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  constructora_id UUID NOT NULL REFERENCES constructoras(id),
  obra_id         UUID NOT NULL REFERENCES obras(id),
  nombre          TEXT NOT NULL,
  descripcion     TEXT,
  icono           TEXT,
  orden           INTEGER NOT NULL DEFAULT 0,
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS amenity_imagenes (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  amenity_id  UUID REFERENCES amenities(id) ON DELETE CASCADE NOT NULL,
  url         TEXT NOT NULL,
  alt         TEXT,
  orden       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Entidad "cliente" compartida entre DESARROLLO (compradores de unidades)
-- y OBRA (comitentes de un contrato de construcción, vía contratos_obra.cliente_id).
-- Se mantiene el nombre histórico `compradores` para no forzar un rename
-- cosmético sobre el flujo DESARROLLO ya en producción.
CREATE TABLE IF NOT EXISTS compradores (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  constructora_id  UUID NOT NULL REFERENCES constructoras(id),
  nombre_completo  TEXT NOT NULL,
  dni_cuit         TEXT,  -- opcional: un cliente de obra puede no tener CUIT cargado
  email            TEXT,
  telefono         TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (constructora_id, dni_cuit)
);

CREATE TABLE IF NOT EXISTS contratos_venta (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  constructora_id   UUID NOT NULL REFERENCES constructoras(id),
  obra_id           UUID NOT NULL REFERENCES obras(id),
  unidad_id         UUID REFERENCES unidades(id) UNIQUE NOT NULL,
  comprador_id      UUID REFERENCES compradores(id) NOT NULL,
  precio_final      DECIMAL(15,2) NOT NULL,
  entrega_efectiva  DECIMAL(15,2) NOT NULL,
  cantidad_cuotas   INTEGER NOT NULL,
  fecha_firma       DATE NOT NULL DEFAULT CURRENT_DATE,
  cuenta_propia_id  UUID REFERENCES cuentas_propias(id),
  notas             TEXT,
  created_by        UUID REFERENCES auth.users(id),
  updated_by        UUID REFERENCES auth.users(id),
  updated_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cuotas (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  constructora_id   UUID NOT NULL REFERENCES constructoras(id),
  contrato_id       UUID REFERENCES contratos_venta(id) ON DELETE CASCADE NOT NULL,
  numero_cuota      INTEGER NOT NULL,
  monto_base        DECIMAL(15,2) NOT NULL,
  monto_cobrado     DECIMAL(15,2),
  fecha_vencimiento DATE NOT NULL,
  estado_pago       estado_pago NOT NULL DEFAULT 'Pendiente',
  fecha_pago        TIMESTAMPTZ,
  notas_pago        TEXT,
  cuenta_propia_id  UUID REFERENCES cuentas_propias(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (contrato_id, numero_cuota)
);

CREATE TABLE IF NOT EXISTS reservas (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  constructora_id   UUID NOT NULL REFERENCES constructoras(id),
  obra_id           UUID NOT NULL REFERENCES obras(id),
  unidad_id         UUID REFERENCES unidades(id) NOT NULL,
  comprador_id      UUID REFERENCES compradores(id) NOT NULL,
  fecha_reserva     DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE NOT NULL,
  monto_sena        DECIMAL(15,2),
  cuenta_propia_id  UUID REFERENCES cuentas_propias(id),
  notas             TEXT,
  estado            TEXT NOT NULL DEFAULT 'Vigente'
    CHECK (estado IN ('Vigente', 'Convertida', 'Caída')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FLUJO OBRA (construcción por contrato — certificados de avance)
-- ============================================================

-- Un contrato por obra tipo='obra' (1:1 impuesto por la app, no por
-- constraint). cliente_id apunta a la misma tabla `compradores` que
-- usa DESARROLLO — ver nota arriba.
CREATE TABLE IF NOT EXISTS contratos_obra (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id            UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  constructora_id    UUID NOT NULL REFERENCES constructoras(id),
  cliente_id         UUID NOT NULL REFERENCES compradores(id),
  monto_total        NUMERIC(15,2) NOT NULL,
  moneda             TEXT NOT NULL DEFAULT 'ARS',
  fecha_inicio       DATE,
  fecha_fin_estimada DATE,
  descripcion        TEXT,
  estado             TEXT NOT NULL DEFAULT 'vigente'
    CHECK (estado IN ('vigente', 'terminado', 'rescindido')),
  created_by         UUID REFERENCES auth.users(id),
  updated_by         UUID REFERENCES auth.users(id),
  updated_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS certificados_avance (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_obra_id    UUID NOT NULL REFERENCES contratos_obra(id) ON DELETE CASCADE,
  obra_id             UUID NOT NULL REFERENCES obras(id),
  constructora_id     UUID NOT NULL REFERENCES constructoras(id),
  numero              INTEGER NOT NULL,  -- asignado por trigger (advisory lock + MAX+1)
  periodo             TEXT NOT NULL,
  porcentaje_avance   NUMERIC(5,2) NOT NULL CHECK (porcentaje_avance >= 0 AND porcentaje_avance <= 100),
  monto_certificado   NUMERIC(15,2) NOT NULL,
  descripcion_avances TEXT,
  estado              TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'presentado', 'aprobado')),  -- 'cobrado' vive en cobros_proyecto.estado
  fecha_presentacion  DATE,
  fecha_aprobacion    DATE,
  notas               TEXT,
  created_by          UUID REFERENCES auth.users(id),
  updated_by          UUID REFERENCES auth.users(id),
  updated_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (contrato_obra_id, numero)
);

CREATE TABLE IF NOT EXISTS cobros_proyecto (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id            UUID NOT NULL REFERENCES obras(id),
  constructora_id    UUID NOT NULL REFERENCES constructoras(id),
  certificado_id     UUID REFERENCES certificados_avance(id) ON DELETE SET NULL,
  numero             INTEGER,  -- asignado por trigger cuando hay certificado_id
  fecha              DATE NOT NULL,  -- histórico: fecha de cobro efectivo (ver fecha_pago)
  fecha_vencimiento  DATE,
  fecha_pago         DATE,
  monto              NUMERIC(15,2) NOT NULL,
  moneda             TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
  estado             TEXT NOT NULL DEFAULT 'cobrado' CHECK (estado IN ('pendiente', 'cobrado')),
  cuenta_propia_id   UUID REFERENCES cuentas_propias(id) ON DELETE SET NULL,
  notas              TEXT,
  created_by         UUID REFERENCES auth.users(id),
  updated_by         UUID REFERENCES auth.users(id),
  updated_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUDITORÍA — historial completo (antes/después) de cambios en
-- las tablas financieras. Las columnas created_by/updated_by de
-- cada tabla dicen quién tocó el registro por última vez; esta
-- tabla guarda cada cambio con sus valores completos.
-- ============================================================

CREATE TABLE IF NOT EXISTS auditoria (
  id              BIGSERIAL PRIMARY KEY,
  tabla           TEXT NOT NULL,
  operacion       TEXT NOT NULL,
  registro_id     UUID,
  constructora_id UUID,
  usuario_id      UUID,
  datos_antes     JSONB,
  datos_despues   JSONB,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- FUNCIONES
-- ============================================================

-- mis_constructoras(): base de TODO el RLS del sistema. Lee de
-- perfiles.constructora_id (no de miembros) — SECURITY DEFINER
-- para no recursar sobre las policies de perfiles.
CREATE OR REPLACE FUNCTION mis_constructoras()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT constructora_id FROM perfiles WHERE id = auth.uid() AND constructora_id IS NOT NULL
$$;

-- NULL para admins siempre (aunque por error tuvieran algo cargado) y
-- para operadores "de toda la empresa". Un valor = acotado a esa obra.
CREATE OR REPLACE FUNCTION mi_obra_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN rol = 'admin' THEN NULL ELSE obra_id END FROM perfiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION es_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT rol = 'admin' FROM perfiles WHERE id = auth.uid()), false)
$$;

-- Replica lib/permisos.ts:tienePermiso() del lado del servidor:
-- admin => true siempre; permisos NULL => legado sin restricción;
-- si no, el módulo tiene que estar en el array.
CREATE OR REPLACE FUNCTION tiene_permiso(p_modulo TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT CASE
       WHEN rol = 'admin' THEN true
       WHEN permisos IS NULL THEN true
       ELSE p_modulo = ANY(permisos)
     END
     FROM perfiles WHERE id = auth.uid()),
    false
  )
$$;

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

  UPDATE cuotas
  SET monto_base = monto_base + (saldo_restante - (monto_cuota * NEW.cantidad_cuotas))
  WHERE contrato_id = NEW.id AND numero_cuota = NEW.cantidad_cuotas;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION marcar_cuotas_vencidas()
RETURNS void AS $$
BEGIN
  UPDATE cuotas SET estado_pago = 'Vencido'
  WHERE estado_pago = 'Pendiente' AND fecha_vencimiento < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_contrato_tenant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.constructora_id IS NULL OR NEW.obra_id IS NULL THEN
    SELECT constructora_id, obra_id INTO NEW.constructora_id, NEW.obra_id
    FROM unidades WHERE id = NEW.unidad_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_reserva_tenant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.constructora_id IS NULL OR NEW.obra_id IS NULL THEN
    SELECT constructora_id, obra_id INTO NEW.constructora_id, NEW.obra_id
    FROM unidades WHERE id = NEW.unidad_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_cuenta_proveedor_tenant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.constructora_id IS NULL THEN
    SELECT constructora_id INTO NEW.constructora_id FROM proveedores WHERE id = NEW.proveedor_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- SECURITY DEFINER pero sin EXECUTE para authenticated/anon (ver REVOKE
-- más abajo) — solo se llama server-side con el admin client desde el
-- onboarding de superadmin.
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

CREATE OR REPLACE FUNCTION set_auditoria_campos()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.updated_by := auth.uid();
    NEW.updated_at := NOW();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_by := OLD.created_by;
    NEW.updated_by := auth.uid();
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- current_setting('app.bypass_inmutable', true) = 'true' permite que
-- purgar_constructora_completa() (llamada sin usuario autenticado, vía
-- service role) borre registros en estado terminal sin pasar por es_admin().
CREATE OR REPLACE FUNCTION proteger_registro_financiero_terminal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF es_admin() OR current_setting('app.bypass_inmutable', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'No se puede eliminar: el registro ya está % y solo un admin puede modificarlo.', OLD.estado;
  END IF;
  RAISE EXCEPTION 'No se puede editar: el registro ya está % y solo un admin puede modificarlo.', OLD.estado;
END;
$$;

CREATE OR REPLACE FUNCTION proteger_saldo_inicial()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT es_admin() AND NEW.saldo_inicial IS DISTINCT FROM OLD.saldo_inicial THEN
    RAISE EXCEPTION 'Solo un admin puede modificar el saldo inicial de una cuenta.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION asignar_numero_certificado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('certificados_avance:' || NEW.contrato_obra_id::text));
  SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
  FROM certificados_avance WHERE contrato_obra_id = NEW.contrato_obra_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION asignar_numero_cobro_proyecto()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.certificado_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('cobros_proyecto:' || NEW.certificado_id::text));
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM cobros_proyecto WHERE certificado_id = NEW.certificado_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validar_monto_certificado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_monto_total NUMERIC(15,2);
  v_suma_otros  NUMERIC(15,2);
BEGIN
  SELECT monto_total INTO v_monto_total FROM contratos_obra WHERE id = NEW.contrato_obra_id;
  SELECT COALESCE(SUM(monto_certificado), 0) INTO v_suma_otros
  FROM certificados_avance WHERE contrato_obra_id = NEW.contrato_obra_id AND id != NEW.id;

  IF v_monto_total IS NOT NULL AND (v_suma_otros + NEW.monto_certificado) > v_monto_total THEN
    RAISE EXCEPTION 'El monto certificado acumulado (%) supera el monto total del contrato (%)',
      v_suma_otros + NEW.monto_certificado, v_monto_total;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION registrar_auditoria()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_constructora_id UUID;
BEGIN
  v_constructora_id := COALESCE(
    (to_jsonb(NEW)->>'constructora_id')::uuid,
    (to_jsonb(OLD)->>'constructora_id')::uuid
  );
  INSERT INTO auditoria (tabla, operacion, registro_id, constructora_id, usuario_id, datos_antes, datos_despues)
  VALUES (
    TG_TABLE_NAME, TG_OP,
    COALESCE((to_jsonb(NEW)->>'id')::uuid, (to_jsonb(OLD)->>'id')::uuid),
    v_constructora_id, auth.uid(),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- No auto-asigna constructora: el onboarding (superadmin o invitación)
-- setea perfiles.constructora_id explícitamente después de crear el
-- auth user. Un perfil con constructora_id NULL no resuelve tenant
-- (ver lib/tenant.ts) y por lo tanto no accede a ningún dato.
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nombre TEXT;
BEGIN
  v_nombre := COALESCE(
    NEW.raw_user_meta_data->>'nombre',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1),
    'Usuario'
  );
  INSERT INTO perfiles (id, nombre, rol, constructora_id)
  VALUES (NEW.id, v_nombre, 'operador', NULL)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ============================================================
-- TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS generar_cuotas_on_contrato ON contratos_venta;
CREATE TRIGGER generar_cuotas_on_contrato
  AFTER INSERT ON contratos_venta
  FOR EACH ROW EXECUTE FUNCTION generar_cuotas_contrato();

DROP TRIGGER IF EXISTS trg_contrato_tenant ON contratos_venta;
CREATE TRIGGER trg_contrato_tenant
  BEFORE INSERT ON contratos_venta
  FOR EACH ROW EXECUTE FUNCTION set_contrato_tenant();

DROP TRIGGER IF EXISTS trg_reserva_tenant ON reservas;
CREATE TRIGGER trg_reserva_tenant
  BEFORE INSERT ON reservas
  FOR EACH ROW EXECUTE FUNCTION set_reserva_tenant();

DROP TRIGGER IF EXISTS trg_cuenta_proveedor_tenant ON cuentas_proveedor;
CREATE TRIGGER trg_cuenta_proveedor_tenant
  BEFORE INSERT ON cuentas_proveedor
  FOR EACH ROW EXECUTE FUNCTION set_cuenta_proveedor_tenant();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

DROP TRIGGER IF EXISTS trg_cuentas_propias_saldo_inicial ON cuentas_propias;
CREATE TRIGGER trg_cuentas_propias_saldo_inicial
  BEFORE UPDATE ON cuentas_propias
  FOR EACH ROW EXECUTE FUNCTION proteger_saldo_inicial();

DROP TRIGGER IF EXISTS trg_gastos_inmutable ON gastos;
CREATE TRIGGER trg_gastos_inmutable
  BEFORE UPDATE OR DELETE ON gastos
  FOR EACH ROW WHEN (OLD.estado = 'Pagado')
  EXECUTE FUNCTION proteger_registro_financiero_terminal();

DROP TRIGGER IF EXISTS trg_certificados_numero ON certificados_avance;
CREATE TRIGGER trg_certificados_numero
  BEFORE INSERT ON certificados_avance
  FOR EACH ROW EXECUTE FUNCTION asignar_numero_certificado();

DROP TRIGGER IF EXISTS trg_validar_monto_certificado ON certificados_avance;
CREATE TRIGGER trg_validar_monto_certificado
  BEFORE INSERT OR UPDATE ON certificados_avance
  FOR EACH ROW EXECUTE FUNCTION validar_monto_certificado();

DROP TRIGGER IF EXISTS trg_certificados_avance_inmutable ON certificados_avance;
CREATE TRIGGER trg_certificados_avance_inmutable
  BEFORE UPDATE OR DELETE ON certificados_avance
  FOR EACH ROW WHEN (OLD.estado = 'aprobado')
  EXECUTE FUNCTION proteger_registro_financiero_terminal();

DROP TRIGGER IF EXISTS trg_cobros_proyecto_numero ON cobros_proyecto;
CREATE TRIGGER trg_cobros_proyecto_numero
  BEFORE INSERT ON cobros_proyecto
  FOR EACH ROW EXECUTE FUNCTION asignar_numero_cobro_proyecto();

DROP TRIGGER IF EXISTS trg_cobros_proyecto_inmutable ON cobros_proyecto;
CREATE TRIGGER trg_cobros_proyecto_inmutable
  BEFORE UPDATE OR DELETE ON cobros_proyecto
  FOR EACH ROW WHEN (OLD.estado = 'cobrado')
  EXECUTE FUNCTION proteger_registro_financiero_terminal();

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['certificados_avance', 'cobros_proyecto', 'contratos_obra', 'contratos_venta', 'gastos', 'cuentas_propias']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditoria_campos ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_auditoria_campos BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_auditoria_campos()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_registrar_auditoria ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_registrar_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION registrar_auditoria()', t);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION seed_constructora_defaults(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION seed_constructora_defaults(UUID) FROM anon;

-- Purga completa de una constructora (obras, unidades, contratos, gastos,
-- cuentas, etc.), en el orden que exigen las FK reales — la mayoría son
-- RESTRICT a propósito para el uso normal de la app (evita que borrar una
-- obra por error destruya datos financieros en cascada), así que este
-- purgado explícito es la única forma de eliminar una constructora con
-- datos reales. SECURITY DEFINER + sin EXECUTE para authenticated/anon —
-- solo se llama server-side con el admin client desde
-- app/api/superadmin/constructoras/route.ts.
CREATE OR REPLACE FUNCTION purgar_constructora_completa(p_constructora_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- transaction-local: deja pasar la purga a través de los triggers de
  -- inmutabilidad financiera, que de otro modo exigen es_admin() (NULL
  -- en este contexto de service role sin usuario autenticado).
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM cobros_proyecto   WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_obra    WHERE constructora_id = p_constructora_id;
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

REVOKE EXECUTE ON FUNCTION purgar_constructora_completa(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION purgar_constructora_completa(UUID) FROM anon;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE perfiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE constructoras        ENABLE ROW LEVEL SECURITY;
ALTER TABLE miembros             ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras                ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipologias           ENABLE ROW LEVEL SECURITY;
ALTER TABLE unidades             ENABLE ROW LEVEL SECURITY;
ALTER TABLE amenities            ENABLE ROW LEVEL SECURITY;
ALTER TABLE amenity_imagenes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE compradores          ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratos_venta      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuotas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas_propias      ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas_proveedor    ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias_costo     ENABLE ROW LEVEL SECURITY;
ALTER TABLE gastos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratos_obra       ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificados_avance  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cobros_proyecto      ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria            ENABLE ROW LEVEL SECURITY;

-- Cada usuario ve/edita solo su propio perfil (el admin gestiona su
-- equipo vía createAdminClient(), que bypasea RLS a propósito).
DROP POLICY IF EXISTS "perfiles_propios" ON perfiles;
CREATE POLICY "perfiles_propios" ON perfiles
  FOR ALL TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "constructoras_miembros_ven" ON constructoras;
CREATE POLICY "constructoras_miembros_ven" ON constructoras
  FOR SELECT TO authenticated USING (id IN (SELECT mis_constructoras()));

DROP POLICY IF EXISTS "constructoras_owner_edita" ON constructoras;
CREATE POLICY "constructoras_owner_edita" ON constructoras
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "miembros_ven_propios" ON miembros;
CREATE POLICY "miembros_ven_propios" ON miembros
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "obras_tenant" ON obras;
CREATE POLICY "obras_tenant" ON obras
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND (mi_obra_id() IS NULL OR id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND (mi_obra_id() IS NULL OR id = mi_obra_id()));

DROP POLICY IF EXISTS "tipologias_tenant" ON tipologias;
CREATE POLICY "tipologias_tenant" ON tipologias
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('tipologias') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('tipologias') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "unidades_tenant" ON unidades;
CREATE POLICY "unidades_tenant" ON unidades
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('unidades') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('unidades') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "amenities_tenant" ON amenities;
CREATE POLICY "amenities_tenant" ON amenities
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('amenities') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('amenities') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "amenity_imagenes_tenant" ON amenity_imagenes;
CREATE POLICY "amenity_imagenes_tenant" ON amenity_imagenes
  FOR ALL TO authenticated
  USING (
    tiene_permiso('amenities') AND
    amenity_id IN (
      SELECT id FROM amenities
      WHERE constructora_id IN (SELECT mis_constructoras())
        AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id())
    )
  )
  WITH CHECK (
    tiene_permiso('amenities') AND
    amenity_id IN (
      SELECT id FROM amenities
      WHERE constructora_id IN (SELECT mis_constructoras())
        AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id())
    )
  );

-- compradores: entidad compartida entre reservas/ventas (DESARROLLO) y
-- certificados de obra (OBRA) — basta con cualquiera de los 3 módulos.
DROP POLICY IF EXISTS "compradores_tenant" ON compradores;
CREATE POLICY "compradores_tenant" ON compradores
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras())
    AND (tiene_permiso('reservas') OR tiene_permiso('contratos') OR tiene_permiso('certificados'))
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras())
    AND (tiene_permiso('reservas') OR tiene_permiso('contratos') OR tiene_permiso('certificados'))
  );

DROP POLICY IF EXISTS "contratos_tenant" ON contratos_venta;
CREATE POLICY "contratos_tenant" ON contratos_venta
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('contratos') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('contratos') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

-- cuotas no tiene columna obra_id propia — cuelga de contratos_venta.
DROP POLICY IF EXISTS "cuotas_tenant" ON cuotas;
CREATE POLICY "cuotas_tenant" ON cuotas
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('contratos')
    AND (mi_obra_id() IS NULL OR contrato_id IN (SELECT id FROM contratos_venta WHERE obra_id = mi_obra_id()))
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('contratos')
    AND (mi_obra_id() IS NULL OR contrato_id IN (SELECT id FROM contratos_venta WHERE obra_id = mi_obra_id()))
  );

DROP POLICY IF EXISTS "reservas_tenant" ON reservas;
CREATE POLICY "reservas_tenant" ON reservas
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('reservas') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('reservas') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "cuentas_propias_tenant" ON cuentas_propias;
CREATE POLICY "cuentas_propias_tenant" ON cuentas_propias
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('cuentas') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('cuentas') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "proveedores_tenant" ON proveedores;
CREATE POLICY "proveedores_tenant" ON proveedores
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('proveedores'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('proveedores'));

DROP POLICY IF EXISTS "cuentas_proveedor_tenant" ON cuentas_proveedor;
CREATE POLICY "cuentas_proveedor_tenant" ON cuentas_proveedor
  FOR ALL TO authenticated
  USING (
    tiene_permiso('proveedores') AND
    proveedor_id IN (SELECT id FROM proveedores WHERE constructora_id IN (SELECT mis_constructoras()))
  )
  WITH CHECK (
    tiene_permiso('proveedores') AND
    proveedor_id IN (SELECT id FROM proveedores WHERE constructora_id IN (SELECT mis_constructoras()))
  );

DROP POLICY IF EXISTS "categorias_costo_tenant" ON categorias_costo;
CREATE POLICY "categorias_costo_tenant" ON categorias_costo
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('gastos'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('gastos'));

DROP POLICY IF EXISTS "gastos_tenant" ON gastos;
CREATE POLICY "gastos_tenant" ON gastos
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('gastos') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('gastos') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "contratos_obra_tenant" ON contratos_obra;
CREATE POLICY "contratos_obra_tenant" ON contratos_obra
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('certificados') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('certificados') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "certificados_avance_tenant" ON certificados_avance;
CREATE POLICY "certificados_avance_tenant" ON certificados_avance
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('certificados') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('certificados') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "cobros_proyecto_tenant" ON cobros_proyecto;
CREATE POLICY "cobros_proyecto_tenant" ON cobros_proyecto
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('cobros') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('cobros') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

-- Nadie escribe directo — solo el trigger registrar_auditoria() (SECURITY
-- DEFINER). Solo un admin lee la auditoría de su propia constructora.
DROP POLICY IF EXISTS "auditoria_admin_lee" ON auditoria;
CREATE POLICY "auditoria_admin_lee" ON auditoria
  FOR SELECT TO authenticated
  USING (es_admin() AND constructora_id IN (SELECT mis_constructoras()));

-- ============================================================
-- ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_miembros_user_id           ON miembros(user_id);
CREATE INDEX IF NOT EXISTS idx_miembros_constructora       ON miembros(constructora_id);
CREATE INDEX IF NOT EXISTS idx_obras_constructora          ON obras(constructora_id);
CREATE INDEX IF NOT EXISTS idx_perfiles_obra               ON perfiles(obra_id);

CREATE INDEX IF NOT EXISTS idx_tipologias_obra             ON tipologias(obra_id);
CREATE INDEX IF NOT EXISTS idx_unidades_obra                ON unidades(obra_id);
CREATE INDEX IF NOT EXISTS idx_unidades_constructora        ON unidades(constructora_id);
CREATE INDEX IF NOT EXISTS idx_amenities_obra                ON amenities(obra_id);

CREATE INDEX IF NOT EXISTS idx_contratos_constructora        ON contratos_venta(constructora_id);
CREATE INDEX IF NOT EXISTS idx_contratos_venta_obra_id       ON contratos_venta(obra_id);
CREATE INDEX IF NOT EXISTS idx_reservas_constructora         ON reservas(constructora_id);
CREATE INDEX IF NOT EXISTS idx_reservas_unidad_estado        ON reservas(unidad_id, estado);
CREATE INDEX IF NOT EXISTS idx_cuotas_constructora           ON cuotas(constructora_id);
CREATE INDEX IF NOT EXISTS idx_cuotas_pendientes_vencimiento ON cuotas(fecha_vencimiento) WHERE estado_pago = 'Pendiente';

CREATE INDEX IF NOT EXISTS idx_gastos_constructora           ON gastos(constructora_id);
CREATE INDEX IF NOT EXISTS idx_proveedores_constructora      ON proveedores(constructora_id);
CREATE INDEX IF NOT EXISTS idx_compradores_constructora      ON compradores(constructora_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_propias_constructora  ON cuentas_propias(constructora_id);
CREATE INDEX IF NOT EXISTS idx_categorias_constructora       ON categorias_costo(constructora_id);

CREATE INDEX IF NOT EXISTS idx_contratos_obra_constructora   ON contratos_obra(constructora_id);
CREATE INDEX IF NOT EXISTS idx_contratos_obra_obra           ON contratos_obra(obra_id);
CREATE INDEX IF NOT EXISTS idx_contratos_obra_cliente        ON contratos_obra(cliente_id);

CREATE INDEX IF NOT EXISTS idx_certificados_constructora     ON certificados_avance(constructora_id);
CREATE INDEX IF NOT EXISTS idx_certificados_contrato_obra    ON certificados_avance(contrato_obra_id);
CREATE INDEX IF NOT EXISTS idx_certificados_obra             ON certificados_avance(obra_id);

CREATE INDEX IF NOT EXISTS idx_cobros_proyecto_constructora  ON cobros_proyecto(constructora_id);
CREATE INDEX IF NOT EXISTS idx_cobros_proyecto_obra          ON cobros_proyecto(obra_id);
CREATE INDEX IF NOT EXISTS idx_cobros_proyecto_certificado   ON cobros_proyecto(certificado_id);
CREATE INDEX IF NOT EXISTS idx_cobros_proyecto_cuenta_propia ON cobros_proyecto(cuenta_propia_id);

CREATE INDEX IF NOT EXISTS idx_auditoria_constructora        ON auditoria(constructora_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_tabla_registro       ON auditoria(tabla, registro_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_creado_en            ON auditoria(creado_en);

-- Nota: los datos de seed (categorías de costo por defecto) ya no se
-- insertan acá de forma global — cada constructora nueva las recibe
-- vía seed_constructora_defaults() en el onboarding de superadmin
-- (ver app/api/superadmin/constructoras/route.ts).
