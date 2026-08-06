-- ============================================================
-- SCHEMA CANÓNICO — ERP multi-tenant para constructoras
-- Refleja el estado final acumulado de schema.sql + migration_001
-- a migration_038. Ver supabase/README.md para la convención.
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
  permisos    TEXT[] DEFAULT '{}',  -- bucket Empresa únicamente ('proveedores'/'tesoreria') — ver perfil_proyectos para módulos por-proyecto
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS constructoras (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre      TEXT NOT NULL,
  owner_id    UUID REFERENCES perfiles(id) ON DELETE SET NULL,
  activa      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- migration_045: datos fiscales/de facturación (suscripción de la
-- plataforma), todos opcionales — el superadmin los carga a mano por
-- ahora, ver migration_045.sql.
ALTER TABLE constructoras ADD COLUMN IF NOT EXISTS razon_social TEXT;
ALTER TABLE constructoras ADD COLUMN IF NOT EXISTS cuit TEXT;
ALTER TABLE constructoras ADD COLUMN IF NOT EXISTS condicion_iva TEXT
  CHECK (condicion_iva IS NULL OR condicion_iva IN ('responsable_inscripto', 'monotributo', 'exento', 'consumidor_final'));
ALTER TABLE constructoras ADD COLUMN IF NOT EXISTS email_facturacion TEXT;
ALTER TABLE constructoras ADD COLUMN IF NOT EXISTS telefono_contacto TEXT;
ALTER TABLE constructoras ADD COLUMN IF NOT EXISTS direccion TEXT;

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

-- LEGADO — reemplazado por perfil_proyectos (migration_022). Columna y
-- mi_obra_id() quedan dormidas (nada las lee/escribe) pero no se dropean
-- todavía, para poder auditar/revertir fácil en producción.
ALTER TABLE perfiles
  ADD COLUMN IF NOT EXISTS obra_id UUID REFERENCES obras(id) ON DELETE SET NULL;

-- Árbol de permisos: un operador puede tener VARIOS proyectos asignados,
-- cada uno con su propio set de módulos (permisos). Reemplaza el modelo
-- de un solo perfiles.obra_id.
CREATE TABLE IF NOT EXISTS perfil_proyectos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil_id       UUID NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  obra_id         UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  constructora_id UUID NOT NULL REFERENCES constructoras(id) ON DELETE CASCADE,
  permisos        TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (perfil_id, obra_id)
);

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
  moneda         TEXT NOT NULL DEFAULT 'USD' CHECK (moneda IN ('ARS', 'USD')),
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
  moneda               TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
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
  cliente_id         UUID REFERENCES compradores(id),  -- migration_047: nullable, ver tipo/proveedor_id abajo
  monto_total        NUMERIC(15,2) NOT NULL,
  moneda             TEXT NOT NULL DEFAULT 'ARS',
  fecha_inicio       DATE,
  fecha_fin_estimada DATE,
  descripcion        TEXT,
  estado             TEXT NOT NULL DEFAULT 'vigente'
    CHECK (estado IN ('vigente', 'terminado', 'rescindido')),
  presupuesto_id     UUID,  -- FK real se agrega más abajo (migration_031), presupuestos se declara después
  created_by         UUID REFERENCES auth.users(id),
  updated_by         UUID REFERENCES auth.users(id),
  updated_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- migration_047: una obra admite más de un contrato — 'cliente' (entra
-- plata, certifica hacia cobros_proyecto, comportamiento de siempre) o
-- 'subcontratista' (sale plata, certifica hacia gastos). Pensado para
-- constructoras que actúan como comitente/gerenciadoras y subcontratan
-- cada rubro a un tercero distinto, en moneda distinta. Ver
-- migration_047.sql para el detalle comentado.
ALTER TABLE contratos_obra ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'cliente'
  CHECK (tipo IN ('cliente', 'subcontratista'));
ALTER TABLE contratos_obra ADD COLUMN IF NOT EXISTS proveedor_id UUID REFERENCES proveedores(id);
ALTER TABLE contratos_obra DROP CONSTRAINT IF EXISTS contratos_obra_parte_check;
ALTER TABLE contratos_obra ADD CONSTRAINT contratos_obra_parte_check CHECK (
  (tipo = 'cliente' AND cliente_id IS NOT NULL AND proveedor_id IS NULL)
  OR (tipo = 'subcontratista' AND proveedor_id IS NOT NULL AND cliente_id IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_contratos_obra_proveedor ON contratos_obra(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_contratos_obra_tipo ON contratos_obra(obra_id, tipo);

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

-- migration_047: trazabilidad de qué certificado de un subcontratista
-- generó este gasto — ON DELETE SET NULL, no CASCADE (mismo criterio
-- que cobros_proyecto.certificado_id, borrar el certificado no borra
-- el gasto ya registrado). Va acá (no junto a la tabla gastos, más
-- arriba en el archivo) porque certificados_avance recién se define
-- en este punto.
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS certificado_id UUID REFERENCES certificados_avance(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_gastos_certificado ON gastos(certificado_id);

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
  estado             TEXT NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente', 'Cobrado')),
  cuenta_propia_id   UUID REFERENCES cuentas_propias(id) ON DELETE SET NULL,
  notas              TEXT,
  created_by         UUID REFERENCES auth.users(id),
  updated_by         UUID REFERENCES auth.users(id),
  updated_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- migration_048: una obra puede tener más de un contrato con el
-- cliente (etapas firmadas por separado) — cobros_proyecto necesita
-- saber a cuál pertenece de forma directa, no solo vía certificado_id
-- (nullable, un cobro "sin certificado" quedaría ambiguo con varios
-- contratos cliente). Nullable a propósito, ver migration_048.sql.
ALTER TABLE cobros_proyecto ADD COLUMN IF NOT EXISTS contrato_obra_id UUID REFERENCES contratos_obra(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_cobros_proyecto_contrato ON cobros_proyecto(contrato_obra_id);

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

-- Bucket Empresa únicamente (proveedores/tesoreria) — perfiles.permisos ya
-- no mezcla módulos de proyecto. Sin acceso implícito: permisos vacío = sin
-- acceso a ese módulo.
CREATE OR REPLACE FUNCTION tiene_permiso(p_modulo TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT es_admin() OR COALESCE(
    (SELECT p_modulo = ANY(permisos) FROM perfiles WHERE id = auth.uid()),
    false
  )
$$;

-- Módulo dentro de UN proyecto específico — perfil_proyectos es la fuente
-- de verdad para todo módulo por-proyecto (tipologias, amenities, unidades,
-- reservas, contratos, certificados, cobros, gastos, cuentas).
CREATE OR REPLACE FUNCTION tiene_permiso_proyecto(p_obra_id UUID, p_modulo TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT es_admin() OR EXISTS (
    SELECT 1 FROM perfil_proyectos
    WHERE perfil_id = auth.uid()
      AND obra_id = p_obra_id
      AND p_modulo = ANY(permisos)
  )
$$;

-- Módulo en CUALQUIERA de los proyectos asignados — para tablas sin
-- obra_id propio que dependen de un módulo por-proyecto (categorias_costo,
-- compradores) y para la lectura del pool de cuentas compartidas.
CREATE OR REPLACE FUNCTION tiene_permiso_en_algun_proyecto(p_modulo TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT es_admin() OR EXISTS (
    SELECT 1 FROM perfil_proyectos
    WHERE perfil_id = auth.uid() AND p_modulo = ANY(permisos)
  )
$$;

-- Reemplaza el árbol de proyectos de un operador de forma atómica (DELETE +
-- INSERT en una sola sentencia) — usada por el PATCH de
-- app/api/admin/usuarios/route.ts al editar permisos. Sin REVOKE, cualquier
-- autenticado podría llamarla con un perfil_id ajeno (mismo bug real que
-- tuvo seed_constructora_defaults) — solo se invoca vía createAdminClient()
-- desde una route que ya verificó rol='admin'.
CREATE OR REPLACE FUNCTION sync_perfil_proyectos(p_perfil_id UUID, p_constructora_id UUID, p_rows JSONB)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM perfil_proyectos WHERE perfil_id = p_perfil_id;

  INSERT INTO perfil_proyectos (perfil_id, obra_id, constructora_id, permisos)
  SELECT
    p_perfil_id,
    (r->>'obraId')::UUID,
    p_constructora_id,
    ARRAY(SELECT jsonb_array_elements_text(r->'permisos'))
  FROM jsonb_array_elements(p_rows) AS r;
END;
$$;

REVOKE EXECUTE ON FUNCTION sync_perfil_proyectos(UUID, UUID, JSONB) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION generar_cuotas_contrato()
RETURNS TRIGGER AS $$
DECLARE
  saldo_restante  DECIMAL(15,2);
  monto_cuota     DECIMAL(15,2);
  i               INTEGER;
  fecha_venc      DATE;
BEGIN
  -- cantidad_cuotas=0 solo se valida min=1 en el cliente (SaleForm) — un
  -- insert por otra vía (RPC, service role) sin este guard dividiría por
  -- cero.
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

-- marcar_cuotas_vencidas() eliminada en migration_059: código muerto
-- (nada la llamaba) que persistía un tercer estado ('Vencido') en
-- cuotas.estado_pago, contradiciendo el criterio general del sistema
-- (vencido se calcula al vuelo con estaVencido(), nunca se guarda).

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

-- migration_029: cuotas Pagadas inmutables para no-admin — mismo patrón que
-- proteger_registro_financiero_terminal, pero la columna se llama
-- estado_pago (no estado) así que no se puede reusar esa función genérica.
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

-- migration_029: contratos_venta no tiene columna "estado" propia (a
-- diferencia de gastos/certificados/cobros) — la inmutabilidad se decide
-- mirando si ya tiene cuotas Pagadas o una entrega_efectiva ya cobrada.
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

-- migration_028: "perfiles_propios" es FOR ALL y solo restringe LA FILA
-- (id = auth.uid()), no las columnas — sin este trigger, cualquier usuario
-- autenticado podía hacer PATCH .../perfiles?id=eq.<su-id> con {rol:'admin'}
-- (o pisar constructora_id) directo por PostgREST, sin pasar por la app.
-- Las escrituras legítimas de estas columnas siempre vienen del service
-- role (app/api/admin/usuarios, app/api/superadmin/constructoras).
CREATE OR REPLACE FUNCTION proteger_columnas_sensibles_perfil()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.rol IS DISTINCT FROM OLD.rol
     OR NEW.permisos IS DISTINCT FROM OLD.permisos
     OR NEW.constructora_id IS DISTINCT FROM OLD.constructora_id
     OR NEW.activo IS DISTINCT FROM OLD.activo THEN
    RAISE EXCEPTION 'No podés modificar rol, permisos, constructora o estado de tu propio perfil.';
  END IF;

  RETURN NEW;
END;
$$;

-- Bloquea escritura en tablas obra-scoped cuando obras.estado = 'finalizada'.
-- A propósito sin excepción para admin (ver migration_023.sql) — el banner de
-- "proyecto cerrado" no distingue rol, así que el trigger tampoco. Respeta
-- app.bypass_inmutable para no romper purgar_constructora_completa().
CREATE OR REPLACE FUNCTION bloquear_escritura_proyecto_cerrado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_obra_id UUID := COALESCE(NEW.obra_id, OLD.obra_id);
  v_estado  TEXT;
BEGIN
  IF current_setting('app.bypass_inmutable', true) = 'true' OR v_obra_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT estado INTO v_estado FROM obras WHERE id = v_obra_id;

  IF v_estado = 'finalizada' THEN
    RAISE EXCEPTION 'El proyecto está cerrado. Reactivalo para poder modificar sus datos.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- amenity_imagenes cuelga de amenities (sin obra_id propio).
CREATE OR REPLACE FUNCTION bloquear_escritura_proyecto_cerrado_amenity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_obra_id UUID;
  v_estado  TEXT;
BEGIN
  IF current_setting('app.bypass_inmutable', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT obra_id INTO v_obra_id FROM amenities WHERE id = COALESCE(NEW.amenity_id, OLD.amenity_id);
  IF v_obra_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT estado INTO v_estado FROM obras WHERE id = v_obra_id;

  IF v_estado = 'finalizada' THEN
    RAISE EXCEPTION 'El proyecto está cerrado. Reactivalo para poder modificar sus datos.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- cuotas cuelga de contratos_venta (sin obra_id propio).
CREATE OR REPLACE FUNCTION bloquear_escritura_proyecto_cerrado_cuota()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_obra_id UUID;
  v_estado  TEXT;
BEGIN
  IF current_setting('app.bypass_inmutable', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT obra_id INTO v_obra_id FROM contratos_venta WHERE id = COALESCE(NEW.contrato_id, OLD.contrato_id);
  IF v_obra_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT estado INTO v_estado FROM obras WHERE id = v_obra_id;

  IF v_estado = 'finalizada' THEN
    RAISE EXCEPTION 'El proyecto está cerrado. Reactivalo para poder modificar sus datos.';
  END IF;

  RETURN COALESCE(NEW, OLD);
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

DROP TRIGGER IF EXISTS trg_proteger_columnas_sensibles_perfil ON perfiles;
CREATE TRIGGER trg_proteger_columnas_sensibles_perfil
  BEFORE UPDATE ON perfiles
  FOR EACH ROW EXECUTE FUNCTION proteger_columnas_sensibles_perfil();

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
  FOR EACH ROW WHEN (OLD.estado = 'Cobrado')
  EXECUTE FUNCTION proteger_registro_financiero_terminal();

DROP TRIGGER IF EXISTS trg_cuotas_inmutable ON cuotas;
CREATE TRIGGER trg_cuotas_inmutable
  BEFORE UPDATE OR DELETE ON cuotas
  FOR EACH ROW WHEN (OLD.estado_pago = 'Pagado')
  EXECUTE FUNCTION proteger_cuota_pagada();

DROP TRIGGER IF EXISTS trg_contratos_venta_con_cobros ON contratos_venta;
CREATE TRIGGER trg_contratos_venta_con_cobros
  BEFORE UPDATE OR DELETE ON contratos_venta
  FOR EACH ROW EXECUTE FUNCTION proteger_contrato_con_cobros();

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tipologias', 'unidades', 'amenities', 'contratos_venta', 'reservas',
    'gastos', 'contratos_obra', 'certificados_avance', 'cobros_proyecto', 'cuentas_propias'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_bloquear_cerrado ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_bloquear_cerrado BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION bloquear_escritura_proyecto_cerrado()', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_bloquear_cerrado ON amenity_imagenes;
CREATE TRIGGER trg_bloquear_cerrado
  BEFORE INSERT OR UPDATE OR DELETE ON amenity_imagenes
  FOR EACH ROW EXECUTE FUNCTION bloquear_escritura_proyecto_cerrado_amenity();

DROP TRIGGER IF EXISTS trg_bloquear_cerrado ON cuotas;
CREATE TRIGGER trg_bloquear_cerrado
  BEFORE INSERT OR UPDATE OR DELETE ON cuotas
  FOR EACH ROW EXECUTE FUNCTION bloquear_escritura_proyecto_cerrado_cuota();

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
ALTER TABLE perfil_proyectos     ENABLE ROW LEVEL SECURITY;
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

-- Cada usuario ve/edita solo su propio perfil. La policy de fila NO alcanza
-- para bloquear escalación de privilegios (rol/permisos/constructora_id) —
-- ver trigger proteger_columnas_sensibles_perfil (migration_028) más abajo,
-- que sí impide que esas columnas se toquen fuera del service role.
DROP POLICY IF EXISTS "perfiles_propios" ON perfiles;
CREATE POLICY "perfiles_propios" ON perfiles
  FOR ALL TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Policy ADICIONAL de SELECT (migration_026): un admin puede listar el
-- equipo de su propia constructora vía RLS normal, sin depender de
-- createAdminClient(). No reemplaza "perfiles_propios" — Postgres OR-ea
-- policies permisivas del mismo comando, así que esto solo amplía lectura;
-- INSERT/UPDATE/DELETE siguen exclusivos de id = auth.uid() (la escritura
-- del equipo sigue haciéndose vía app/api/admin/usuarios con admin client).
DROP POLICY IF EXISTS "perfiles_admin_lee_equipo" ON perfiles;
CREATE POLICY "perfiles_admin_lee_equipo" ON perfiles
  FOR SELECT TO authenticated
  USING (es_admin() AND constructora_id IN (SELECT mis_constructoras()));

DROP POLICY IF EXISTS "constructoras_miembros_ven" ON constructoras;
CREATE POLICY "constructoras_miembros_ven" ON constructoras
  FOR SELECT TO authenticated USING (id IN (SELECT mis_constructoras()));

DROP POLICY IF EXISTS "constructoras_owner_edita" ON constructoras;
CREATE POLICY "constructoras_owner_edita" ON constructoras
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "miembros_ven_propios" ON miembros;
CREATE POLICY "miembros_ven_propios" ON miembros
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "perfil_proyectos_propio_lee" ON perfil_proyectos;
CREATE POLICY "perfil_proyectos_propio_lee" ON perfil_proyectos
  FOR SELECT TO authenticated USING (perfil_id = auth.uid());

-- migration_028: separada en SELECT (cualquier asignado) vs INSERT/UPDATE/
-- DELETE (solo admin) — antes era FOR ALL y bastaba tener un solo módulo
-- asignado en el proyecto para poder cerrarlo/eliminarlo por completo.
DROP POLICY IF EXISTS "obras_tenant" ON obras;

CREATE POLICY "obras_ven_asignados" ON obras
  FOR SELECT TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras())
    AND (es_admin() OR EXISTS (SELECT 1 FROM perfil_proyectos WHERE perfil_id = auth.uid() AND obra_id = obras.id))
  );

CREATE POLICY "obras_admin_crea" ON obras
  FOR INSERT TO authenticated
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND es_admin());

CREATE POLICY "obras_admin_actualiza" ON obras
  FOR UPDATE TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND es_admin())
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND es_admin());

CREATE POLICY "obras_admin_elimina" ON obras
  FOR DELETE TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()) AND es_admin());

DROP POLICY IF EXISTS "tipologias_tenant" ON tipologias;
CREATE POLICY "tipologias_tenant" ON tipologias
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'tipologias'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'tipologias'));

DROP POLICY IF EXISTS "unidades_tenant" ON unidades;
CREATE POLICY "unidades_tenant" ON unidades
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'unidades'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'unidades'));

DROP POLICY IF EXISTS "amenities_tenant" ON amenities;
CREATE POLICY "amenities_tenant" ON amenities
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'amenities'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'amenities'));

DROP POLICY IF EXISTS "amenity_imagenes_tenant" ON amenity_imagenes;
CREATE POLICY "amenity_imagenes_tenant" ON amenity_imagenes
  FOR ALL TO authenticated
  USING (
    amenity_id IN (
      SELECT id FROM amenities a
      WHERE a.constructora_id IN (SELECT mis_constructoras())
        AND tiene_permiso_proyecto(a.obra_id, 'amenities')
    )
  )
  WITH CHECK (
    amenity_id IN (
      SELECT id FROM amenities a
      WHERE a.constructora_id IN (SELECT mis_constructoras())
        AND tiene_permiso_proyecto(a.obra_id, 'amenities')
    )
  );

-- compradores: entidad compartida sin obra_id propio — basta con tener
-- alguno de los 3 módulos en CUALQUIER proyecto asignado.
DROP POLICY IF EXISTS "compradores_tenant" ON compradores;
CREATE POLICY "compradores_tenant" ON compradores
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras())
    AND (
      tiene_permiso('clientes')
      OR tiene_permiso_en_algun_proyecto('reservas')
      OR tiene_permiso_en_algun_proyecto('contratos')
      OR tiene_permiso_en_algun_proyecto('certificados')
    )
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras())
    AND (
      tiene_permiso('clientes')
      OR tiene_permiso_en_algun_proyecto('reservas')
      OR tiene_permiso_en_algun_proyecto('contratos')
      OR tiene_permiso_en_algun_proyecto('certificados')
    )
  );

DROP POLICY IF EXISTS "contratos_tenant" ON contratos_venta;
CREATE POLICY "contratos_tenant" ON contratos_venta
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'contratos'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'contratos'));

-- cuotas no tiene columna obra_id propia — cuelga de contratos_venta.
DROP POLICY IF EXISTS "cuotas_tenant" ON cuotas;
CREATE POLICY "cuotas_tenant" ON cuotas
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras())
    AND contrato_id IN (SELECT id FROM contratos_venta cv WHERE tiene_permiso_proyecto(cv.obra_id, 'contratos'))
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras())
    AND contrato_id IN (SELECT id FROM contratos_venta cv WHERE tiene_permiso_proyecto(cv.obra_id, 'contratos'))
  );

DROP POLICY IF EXISTS "reservas_tenant" ON reservas;
CREATE POLICY "reservas_tenant" ON reservas
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'reservas'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'reservas'));

-- cuentas_propias: obra_id NULL es el pool compartido de la empresa. Lectura
-- permitida a cualquiera con 'cuentas' en ALGÚN proyecto (lo necesitan las
-- páginas de proyecto en modo_cuentas='empresa'); escritura de filas sin
-- proyecto queda solo para admin.
DROP POLICY IF EXISTS "cuentas_propias_tenant" ON cuentas_propias;
CREATE POLICY "cuentas_propias_tenant" ON cuentas_propias
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras()) AND (
      (obra_id IS NULL AND (es_admin() OR tiene_permiso_en_algun_proyecto('cuentas')))
      OR (obra_id IS NOT NULL AND tiene_permiso_proyecto(obra_id, 'cuentas'))
    )
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras()) AND (
      (obra_id IS NULL AND es_admin())
      OR (obra_id IS NOT NULL AND tiene_permiso_proyecto(obra_id, 'cuentas'))
    )
  );

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

-- categorias_costo: sin obra_id propio, gateada por 'gastos' en cualquier proyecto.
DROP POLICY IF EXISTS "categorias_costo_tenant" ON categorias_costo;
CREATE POLICY "categorias_costo_tenant" ON categorias_costo
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_en_algun_proyecto('gastos'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_en_algun_proyecto('gastos'));

-- gastos: obra_id NULL = gasto administrativo de la constructora, solo admin
-- (las páginas de proyecto solo leen filas con obra_id = esa obra, nunca NULL).
DROP POLICY IF EXISTS "gastos_tenant" ON gastos;
CREATE POLICY "gastos_tenant" ON gastos
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras()) AND (
      (obra_id IS NULL AND es_admin())
      OR (obra_id IS NOT NULL AND tiene_permiso_proyecto(obra_id, 'gastos'))
    )
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras()) AND (
      (obra_id IS NULL AND es_admin())
      OR (obra_id IS NOT NULL AND tiene_permiso_proyecto(obra_id, 'gastos'))
    )
  );

DROP POLICY IF EXISTS "contratos_obra_tenant" ON contratos_obra;
CREATE POLICY "contratos_obra_tenant" ON contratos_obra
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'certificados'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'certificados'));

DROP POLICY IF EXISTS "certificados_avance_tenant" ON certificados_avance;
CREATE POLICY "certificados_avance_tenant" ON certificados_avance
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'certificados'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'certificados'));

DROP POLICY IF EXISTS "cobros_proyecto_tenant" ON cobros_proyecto;
CREATE POLICY "cobros_proyecto_tenant" ON cobros_proyecto
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'cobros'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'cobros'));

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
CREATE INDEX IF NOT EXISTS idx_perfiles_obra               ON perfiles(obra_id);  -- legado, ver perfil_proyectos
CREATE INDEX IF NOT EXISTS idx_perfiles_permisos_gin       ON perfiles USING GIN (permisos);

CREATE INDEX IF NOT EXISTS idx_perfil_proyectos_perfil       ON perfil_proyectos(perfil_id);
CREATE INDEX IF NOT EXISTS idx_perfil_proyectos_obra         ON perfil_proyectos(obra_id);
CREATE INDEX IF NOT EXISTS idx_perfil_proyectos_constructora ON perfil_proyectos(constructora_id);

CREATE INDEX IF NOT EXISTS idx_tipologias_obra             ON tipologias(obra_id);
CREATE INDEX IF NOT EXISTS idx_unidades_obra                ON unidades(obra_id);
CREATE INDEX IF NOT EXISTS idx_unidades_constructora        ON unidades(constructora_id);
CREATE INDEX IF NOT EXISTS idx_amenities_obra                ON amenities(obra_id);
-- migration_039: faltaba, cascada de amenities la escaneaba entera
CREATE INDEX IF NOT EXISTS idx_amenity_imagenes_amenity      ON amenity_imagenes(amenity_id);

CREATE INDEX IF NOT EXISTS idx_contratos_constructora        ON contratos_venta(constructora_id);
CREATE INDEX IF NOT EXISTS idx_contratos_venta_obra_id       ON contratos_venta(obra_id);
CREATE INDEX IF NOT EXISTS idx_reservas_constructora         ON reservas(constructora_id);
CREATE INDEX IF NOT EXISTS idx_reservas_unidad_estado        ON reservas(unidad_id, estado);
-- migration_039: faltaba, purgar_obra_completa() escaneaba la tabla entera
CREATE INDEX IF NOT EXISTS idx_reservas_obra                 ON reservas(obra_id);

-- migration_028: evita dos reservas 'Vigente' simultáneas sobre la misma
-- unidad (contratos_venta.unidad_id ya era UNIQUE, esto era el hueco).
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservas_unica_vigente
  ON reservas (unidad_id) WHERE estado = 'Vigente';
CREATE INDEX IF NOT EXISTS idx_cuotas_constructora           ON cuotas(constructora_id);
CREATE INDEX IF NOT EXISTS idx_cuotas_pendientes_vencimiento ON cuotas(fecha_vencimiento) WHERE estado_pago = 'Pendiente';
-- migration_039: faltaba, cascada de contratos_venta la escaneaba entera
CREATE INDEX IF NOT EXISTS idx_cuotas_contrato                ON cuotas(contrato_id);
-- migration_051: tesorería/caja filtran estado_pago='Pagado' tan seguido como
-- 'Pendiente' (arriba), pero solo ese último tenía índice
CREATE INDEX IF NOT EXISTS idx_cuotas_pagado                 ON cuotas(estado_pago) WHERE estado_pago = 'Pagado';

CREATE INDEX IF NOT EXISTS idx_gastos_constructora           ON gastos(constructora_id);
-- migration_039: faltaba, purgar_obra_completa() escaneaba la tabla entera
CREATE INDEX IF NOT EXISTS idx_gastos_obra                   ON gastos(obra_id);
-- migration_051: tesorería/caja/gastos filtran siempre (constructora_id u
-- obra_id) + estado juntos, sin índice compuesto que lo cubriera
CREATE INDEX IF NOT EXISTS idx_gastos_constructora_estado    ON gastos(constructora_id, estado);
CREATE INDEX IF NOT EXISTS idx_gastos_obra_estado            ON gastos(obra_id, estado) WHERE obra_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proveedores_constructora      ON proveedores(constructora_id);
CREATE INDEX IF NOT EXISTS idx_compradores_constructora      ON compradores(constructora_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_propias_constructora  ON cuentas_propias(constructora_id);
-- migration_039: faltaba, SET NULL al borrar la obra escaneaba la tabla entera
CREATE INDEX IF NOT EXISTS idx_cuentas_propias_obra          ON cuentas_propias(obra_id);
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

-- ============================================================
-- MIGRATION 030 — resumen_unidades_por_obra() (agregado en Postgres
-- del conteo de unidades por proyecto, ver migration_030.sql)
-- ============================================================
CREATE OR REPLACE FUNCTION resumen_unidades_por_obra(p_obra_ids UUID[])
RETURNS TABLE(obra_id UUID, total INTEGER, vendidas INTEGER, reservadas INTEGER, disponibles INTEGER)
LANGUAGE sql
STABLE
AS $$
  SELECT
    u.obra_id,
    COUNT(*)::INTEGER AS total,
    COUNT(*) FILTER (WHERE u.estado_comercial = 'Vendido')::INTEGER AS vendidas,
    COUNT(*) FILTER (WHERE u.estado_comercial = 'Reservado')::INTEGER AS reservadas,
    COUNT(*) FILTER (WHERE u.estado_comercial = 'Disponible')::INTEGER AS disponibles
  FROM unidades u
  WHERE u.obra_id = ANY(p_obra_ids)
  GROUP BY u.obra_id;
$$;

-- ============================================================
-- MIGRATION 031 — Presupuestos como origen de una obra +
-- certificación de avance por ítem/rubro (ver migration_031.sql para
-- el detalle comentado de cada pieza).
-- ============================================================

CREATE TABLE IF NOT EXISTS presupuestos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id   UUID NOT NULL REFERENCES constructoras(id),
  obra_id           UUID REFERENCES obras(id) ON DELETE SET NULL,
  contrato_obra_id  UUID REFERENCES contratos_obra(id) ON DELETE SET NULL,
  cliente_nombre    TEXT NOT NULL,
  cliente_cuit      TEXT,
  cliente_email     TEXT,
  cliente_telefono  TEXT,
  moneda            TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
  estado            TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'enviado', 'aceptado', 'rechazado')),
  fecha_inicio        DATE,
  fecha_fin_estimada  DATE,
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

CREATE INDEX IF NOT EXISTS idx_presupuestos_constructora     ON presupuestos(constructora_id);
-- migration_039: faltaban, SET NULL al borrar obra/contrato_obra escaneaba la tabla entera
CREATE INDEX IF NOT EXISTS idx_presupuestos_obra              ON presupuestos(obra_id);
CREATE INDEX IF NOT EXISTS idx_presupuestos_contrato_obra      ON presupuestos(contrato_obra_id);
CREATE INDEX IF NOT EXISTS idx_presupuesto_items_presupuesto ON presupuesto_items(presupuesto_id);

ALTER TABLE contratos_obra DROP CONSTRAINT IF EXISTS contratos_obra_presupuesto_id_fkey;
ALTER TABLE contratos_obra ADD CONSTRAINT contratos_obra_presupuesto_id_fkey
  FOREIGN KEY (presupuesto_id) REFERENCES presupuestos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contratos_obra_presupuesto ON contratos_obra(presupuesto_id);

-- migration_043: unidad/cantidad/precio_unitario agregados, misma
-- estructura que presupuesto_items — monto_contratado es GENERATED
-- (cantidad × precio_unitario), ya no se tipea/inserta directo.
CREATE TABLE IF NOT EXISTS contrato_obra_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_obra_id  UUID NOT NULL REFERENCES contratos_obra(id) ON DELETE CASCADE,
  constructora_id   UUID NOT NULL REFERENCES constructoras(id),
  orden             INTEGER NOT NULL DEFAULT 0,
  rubro             TEXT NOT NULL,
  unidad            TEXT,
  cantidad          NUMERIC(15,2) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario   NUMERIC(15,2) NOT NULL CHECK (precio_unitario >= 0),
  monto_contratado  NUMERIC(15,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
  origen            TEXT NOT NULL DEFAULT 'presupuesto' CHECK (origen IN ('presupuesto', 'adicional', 'directo')),
  notas             TEXT,
  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contrato_obra_items_contrato ON contrato_obra_items(contrato_obra_id);

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

DROP TRIGGER IF EXISTS trg_auditoria_campos ON presupuestos;
CREATE TRIGGER trg_auditoria_campos
  BEFORE INSERT OR UPDATE ON presupuestos
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_campos();

DROP TRIGGER IF EXISTS trg_registrar_auditoria ON presupuestos;
CREATE TRIGGER trg_registrar_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON presupuestos
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

-- Reemplaza la versión de más arriba: suma el borrado de presupuestos
-- (contrato_obra_items/certificado_items ya caen en cascada desde
-- contratos_obra/certificados_avance, que se borran antes acá).
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

CREATE OR REPLACE FUNCTION aceptar_presupuesto(
  p_presupuesto_id       UUID,
  p_obra_id              UUID DEFAULT NULL,
  p_nueva_obra_nombre    TEXT DEFAULT NULL,
  p_nueva_obra_direccion TEXT DEFAULT NULL,
  p_modo_cuentas         TEXT DEFAULT 'empresa',
  p_replicar_cuentas     BOOLEAN DEFAULT false
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
  IF p_modo_cuentas NOT IN ('empresa', 'especificas') THEN
    RAISE EXCEPTION 'modo_cuentas inválido: %', p_modo_cuentas;
  END IF;

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
    -- migration_048: ya no bloquea si la obra ya tiene contrato(s) con
    -- el cliente — puede sumar otro (ej. una nueva etapa firmada aparte).
    v_obra_id := p_obra_id;
  ELSE
    IF p_nueva_obra_nombre IS NULL OR btrim(p_nueva_obra_nombre) = '' THEN
      RAISE EXCEPTION 'Falta el nombre del proyecto nuevo';
    END IF;
    INSERT INTO obras (constructora_id, nombre, direccion, tipo, estado, modo_cuentas)
    VALUES (v_presupuesto.constructora_id, btrim(p_nueva_obra_nombre), NULLIF(btrim(COALESCE(p_nueva_obra_direccion, '')), ''), 'obra', 'activa', p_modo_cuentas)
    RETURNING id INTO v_obra_id;

    IF p_modo_cuentas = 'especificas' AND p_replicar_cuentas THEN
      INSERT INTO cuentas_propias (constructora_id, obra_id, nombre, tipo, moneda, saldo_inicial, activa)
      SELECT constructora_id, v_obra_id, nombre, tipo, moneda, 0, true
      FROM cuentas_propias
      WHERE constructora_id = v_presupuesto.constructora_id AND obra_id IS NULL AND activa = true;
    END IF;
  END IF;

  IF v_presupuesto.cliente_cuit IS NOT NULL THEN
    SELECT id INTO v_cliente_id FROM compradores
    WHERE constructora_id = v_presupuesto.constructora_id AND dni_cuit = v_presupuesto.cliente_cuit;
  END IF;
  IF v_cliente_id IS NULL THEN
    INSERT INTO compradores (constructora_id, nombre_completo, dni_cuit, email, telefono)
    VALUES (v_presupuesto.constructora_id, v_presupuesto.cliente_nombre, v_presupuesto.cliente_cuit, v_presupuesto.cliente_email, v_presupuesto.cliente_telefono)
    RETURNING id INTO v_cliente_id;
  END IF;

  INSERT INTO contratos_obra (obra_id, constructora_id, tipo, cliente_id, monto_total, moneda, descripcion, presupuesto_id, fecha_inicio, fecha_fin_estimada, iva_pct)
  VALUES (v_obra_id, v_presupuesto.constructora_id, 'cliente', v_cliente_id, v_monto_total, v_presupuesto.moneda, v_presupuesto.descripcion, p_presupuesto_id, v_presupuesto.fecha_inicio, v_presupuesto.fecha_fin_estimada, v_presupuesto.iva_pct)
  RETURNING id INTO v_contrato_id;

  INSERT INTO contrato_obra_items (contrato_obra_id, constructora_id, orden, rubro, unidad, cantidad, precio_unitario, origen)
  SELECT v_contrato_id, constructora_id, orden, rubro, unidad, cantidad, precio_unitario, 'presupuesto'
  FROM presupuesto_items WHERE presupuesto_id = p_presupuesto_id;

  UPDATE presupuestos SET estado = 'aceptado', obra_id = v_obra_id, contrato_obra_id = v_contrato_id
  WHERE id = p_presupuesto_id;

  RETURN v_obra_id;
END;
$$;

ALTER TABLE presupuestos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE presupuesto_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE contrato_obra_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificado_items   ENABLE ROW LEVEL SECURITY;

-- migration_041: separada de FOR ALL — eliminar queda admin-only y solo en
-- estado 'borrador' (mantener registro histórico una vez enviado/aceptado/
-- rechazado). Una policy FOR ALL no se puede "restringir" agregando otra
-- encima (Postgres combina policies permisivas con OR), hay que separar
-- por comando — mismo patrón que obras_tenant en migration_028.
DROP POLICY IF EXISTS "presupuestos_tenant" ON presupuestos;

CREATE POLICY "presupuestos_ve" ON presupuestos
  FOR SELECT TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('presupuestos'));

CREATE POLICY "presupuestos_crea" ON presupuestos
  FOR INSERT TO authenticated
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('presupuestos'));

CREATE POLICY "presupuestos_actualiza" ON presupuestos
  FOR UPDATE TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('presupuestos'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('presupuestos'));

-- migration_042: ya no se limita a 'borrador' — no tiene sentido mantener
-- para siempre presupuestos rechazados/aceptados de años atrás. Seguro en
-- cualquier estado: contratos_obra.presupuesto_id es ON DELETE SET NULL,
-- borrar un presupuesto "aceptado" no afecta el contrato/proyecto que generó.
CREATE POLICY "presupuestos_admin_elimina" ON presupuestos
  FOR DELETE TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()) AND es_admin());

DROP POLICY IF EXISTS "presupuesto_items_tenant" ON presupuesto_items;
CREATE POLICY "presupuesto_items_tenant" ON presupuesto_items
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('presupuestos'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('presupuestos'));

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

-- ============================================================
-- MIGRATION 032 — Inventario de maquinaria/equipos: asignación
-- vigente + historial (mismo patrón que reservas/contratos). Ver
-- migration_032.sql para el detalle comentado.
-- ============================================================

CREATE TABLE IF NOT EXISTS equipos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id UUID NOT NULL REFERENCES constructoras(id),
  nombre          TEXT NOT NULL,
  tipo            TEXT,
  marca           TEXT,
  modelo          TEXT,
  nro_serie       TEXT,
  estado          TEXT NOT NULL DEFAULT 'disponible'
    CHECK (estado IN ('disponible', 'asignado', 'mantenimiento', 'baja')),
  notas           TEXT,
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  updated_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS equipo_asignaciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipo_id       UUID NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
  obra_id         UUID NOT NULL REFERENCES obras(id),
  constructora_id UUID NOT NULL REFERENCES constructoras(id),
  fecha_desde     DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_hasta     DATE,
  asignado_por    UUID REFERENCES auth.users(id),
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_equipo_asignaciones_unica_vigente
  ON equipo_asignaciones(equipo_id) WHERE fecha_hasta IS NULL;

CREATE INDEX IF NOT EXISTS idx_equipos_constructora              ON equipos(constructora_id);
CREATE INDEX IF NOT EXISTS idx_equipo_asignaciones_equipo        ON equipo_asignaciones(equipo_id);
CREATE INDEX IF NOT EXISTS idx_equipo_asignaciones_obra          ON equipo_asignaciones(obra_id);
CREATE INDEX IF NOT EXISTS idx_equipo_asignaciones_constructora  ON equipo_asignaciones(constructora_id);

DROP TRIGGER IF EXISTS trg_auditoria_campos ON equipos;
CREATE TRIGGER trg_auditoria_campos
  BEFORE INSERT OR UPDATE ON equipos
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_campos();

DROP TRIGGER IF EXISTS trg_registrar_auditoria ON equipos;
CREATE TRIGGER trg_registrar_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON equipos
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

CREATE OR REPLACE FUNCTION asignar_equipo(p_equipo_id UUID, p_obra_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_equipo      equipos%ROWTYPE;
  v_obra_actual UUID;
BEGIN
  SELECT * INTO v_equipo FROM equipos WHERE id = p_equipo_id;
  IF v_equipo.id IS NULL THEN
    RAISE EXCEPTION 'Equipo no encontrado';
  END IF;
  IF v_equipo.estado = 'baja' THEN
    RAISE EXCEPTION 'No se puede asignar un equipo dado de baja';
  END IF;

  -- migration_044: p_obra_id sin validar contra el tenant del equipo era
  -- una violación de integridad tenant (ver migration_044.sql).
  IF NOT EXISTS (SELECT 1 FROM obras WHERE id = p_obra_id AND constructora_id = v_equipo.constructora_id) THEN
    RAISE EXCEPTION 'Proyecto no encontrado';
  END IF;

  SELECT obra_id INTO v_obra_actual FROM equipo_asignaciones
  WHERE equipo_id = p_equipo_id AND fecha_hasta IS NULL;

  IF v_obra_actual = p_obra_id THEN
    RAISE EXCEPTION 'Ya está asignado a ese proyecto';
  END IF;

  UPDATE equipo_asignaciones SET fecha_hasta = CURRENT_DATE
  WHERE equipo_id = p_equipo_id AND fecha_hasta IS NULL;

  INSERT INTO equipo_asignaciones (equipo_id, obra_id, constructora_id, fecha_desde, asignado_por)
  VALUES (p_equipo_id, p_obra_id, v_equipo.constructora_id, CURRENT_DATE, auth.uid());

  UPDATE equipos SET estado = 'asignado' WHERE id = p_equipo_id;
END;
$$;

CREATE OR REPLACE FUNCTION liberar_equipo(p_equipo_id UUID, p_nuevo_estado TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_nuevo_estado NOT IN ('disponible', 'mantenimiento', 'baja') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_nuevo_estado;
  END IF;

  UPDATE equipo_asignaciones SET fecha_hasta = CURRENT_DATE
  WHERE equipo_id = p_equipo_id AND fecha_hasta IS NULL;

  UPDATE equipos SET estado = p_nuevo_estado WHERE id = p_equipo_id;
END;
$$;

ALTER TABLE equipos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipo_asignaciones  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipos_tenant" ON equipos;
CREATE POLICY "equipos_tenant" ON equipos
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('inventario'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('inventario'));

DROP POLICY IF EXISTS "equipo_asignaciones_tenant" ON equipo_asignaciones;
CREATE POLICY "equipo_asignaciones_tenant" ON equipo_asignaciones
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('inventario'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('inventario'));

-- Reemplaza la versión de más arriba: suma equipos (equipo_asignaciones
-- cae en cascada).
CREATE OR REPLACE FUNCTION purgar_constructora_completa(p_constructora_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM cobros_proyecto   WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_obra    WHERE constructora_id = p_constructora_id;
  DELETE FROM presupuestos      WHERE constructora_id = p_constructora_id;
  DELETE FROM equipos           WHERE constructora_id = p_constructora_id;
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

-- ============================================================
-- MIGRATION 033 — purgar_obra_completa(): "Eliminar proyecto" era un
-- DELETE FROM obras suelto que dependía de foreign keys para fallar
-- (a propósito casi ninguna tabla de proyecto tiene ON DELETE CASCADE
-- desde obras). Ver migration_033.sql para el detalle comentado.
-- ============================================================

-- migration_040: bypass_inmutable agregado — sin esto, purgar_obra_completa()
-- no podía eliminar un proyecto cerrado (trg_bloquear_cerrado bloqueaba sus
-- propios DELETE). "Cerrado" protege los datos DE ADENTRO del proyecto;
-- eliminar el proyecto entero es una acción de capa superior (ya gateada
-- aparte, solo admin) que debe pasar por encima de esa protección interna.
CREATE OR REPLACE FUNCTION purgar_obra_completa(p_obra_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM contratos_venta   WHERE obra_id = p_obra_id;
  DELETE FROM reservas          WHERE obra_id = p_obra_id;
  DELETE FROM unidades          WHERE obra_id = p_obra_id;
  DELETE FROM tipologias        WHERE obra_id = p_obra_id;
  DELETE FROM amenities         WHERE obra_id = p_obra_id;

  DELETE FROM cobros_proyecto     WHERE obra_id = p_obra_id;
  DELETE FROM certificados_avance WHERE obra_id = p_obra_id;
  DELETE FROM contratos_obra      WHERE obra_id = p_obra_id;

  DELETE FROM equipo_asignaciones WHERE obra_id = p_obra_id;
  DELETE FROM gastos              WHERE obra_id = p_obra_id;

  -- cuentas_propias NO se borra: su FK (obra_id ON DELETE SET NULL) la
  -- desvincula sola al llegar al DELETE FROM obras — sobrevive como
  -- cuenta de empresa en vez de perderse (representa un saldo_inicial
  -- real, no un dato de ejecución del proyecto).

  DELETE FROM obras WHERE id = p_obra_id;
END;
$$;

-- ============================================================
-- MIGRATION 035 — contratos_obra.monto_total se recalcula solo al
-- cambiar contrato_obra_items (adicionales incluidos). Ver
-- migration_035.sql para el detalle comentado.
-- ============================================================

CREATE OR REPLACE FUNCTION recalcular_monto_total_contrato()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_contrato_id UUID := COALESCE(NEW.contrato_obra_id, OLD.contrato_obra_id);
  v_total       NUMERIC(15,2);
BEGIN
  SELECT COALESCE(SUM(monto_contratado), 0) INTO v_total
  FROM contrato_obra_items WHERE contrato_obra_id = v_contrato_id;

  PERFORM set_config('app.bypass_inmutable', 'true', true);
  UPDATE contratos_obra SET monto_total = v_total WHERE id = v_contrato_id;
  PERFORM set_config('app.bypass_inmutable', 'false', true);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recalcular_monto_total_contrato ON contrato_obra_items;
CREATE TRIGGER trg_recalcular_monto_total_contrato
  AFTER INSERT OR UPDATE OR DELETE ON contrato_obra_items
  FOR EACH ROW EXECUTE FUNCTION recalcular_monto_total_contrato();

-- ============================================================
-- MIGRATION 038 — Personal: mismo patrón de asignación vigente +
-- historial que equipos (Inventario). Ver migration_038.sql para el
-- detalle comentado y las decisiones de producto.
-- ============================================================

CREATE TABLE IF NOT EXISTS personal (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id     UUID NOT NULL REFERENCES constructoras(id),
  nombre              TEXT NOT NULL,
  dni                 TEXT,
  cuil                TEXT,
  telefono            TEXT,
  tipo_contratacion   TEXT NOT NULL DEFAULT 'relacion_dependencia'
    CHECK (tipo_contratacion IN ('relacion_dependencia', 'contratado', 'subcontratista')),
  categoria           TEXT,
  jornal              NUMERIC(15,2),
  art_aseguradora     TEXT,
  art_vencimiento     DATE,
  fecha_ingreso       DATE,
  estado              TEXT NOT NULL DEFAULT 'disponible'
    CHECK (estado IN ('disponible', 'asignado', 'licencia', 'baja')),
  notas               TEXT,
  created_by          UUID REFERENCES auth.users(id),
  updated_by          UUID REFERENCES auth.users(id),
  updated_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cuadrillas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id UUID NOT NULL REFERENCES constructoras(id),
  nombre          TEXT NOT NULL,
  capataz_id      UUID REFERENCES personal(id) ON DELETE SET NULL,
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE personal ADD COLUMN IF NOT EXISTS cuadrilla_id UUID REFERENCES cuadrillas(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS personal_asignaciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_id     UUID NOT NULL REFERENCES personal(id) ON DELETE CASCADE,
  obra_id         UUID NOT NULL REFERENCES obras(id),
  constructora_id UUID NOT NULL REFERENCES constructoras(id),
  fecha_desde     DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_hasta     DATE,
  asignado_por    UUID REFERENCES auth.users(id),
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_asignaciones_unica_vigente
  ON personal_asignaciones(personal_id) WHERE fecha_hasta IS NULL;

CREATE INDEX IF NOT EXISTS idx_personal_constructora              ON personal(constructora_id);
CREATE INDEX IF NOT EXISTS idx_personal_cuadrilla                 ON personal(cuadrilla_id);
CREATE INDEX IF NOT EXISTS idx_cuadrillas_constructora            ON cuadrillas(constructora_id);
CREATE INDEX IF NOT EXISTS idx_personal_asignaciones_personal     ON personal_asignaciones(personal_id);
CREATE INDEX IF NOT EXISTS idx_personal_asignaciones_obra         ON personal_asignaciones(obra_id);
CREATE INDEX IF NOT EXISTS idx_personal_asignaciones_constructora ON personal_asignaciones(constructora_id);

DROP TRIGGER IF EXISTS trg_auditoria_campos ON personal;
CREATE TRIGGER trg_auditoria_campos
  BEFORE INSERT OR UPDATE ON personal
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_campos();

DROP TRIGGER IF EXISTS trg_registrar_auditoria ON personal;
CREATE TRIGGER trg_registrar_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON personal
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

CREATE OR REPLACE FUNCTION asignar_personal(p_personal_id UUID, p_obra_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_personal    personal%ROWTYPE;
  v_obra_actual UUID;
BEGIN
  SELECT * INTO v_personal FROM personal WHERE id = p_personal_id;
  IF v_personal.id IS NULL THEN
    RAISE EXCEPTION 'Personal no encontrado';
  END IF;
  IF v_personal.estado = 'baja' THEN
    RAISE EXCEPTION 'No se puede asignar a una persona dada de baja';
  END IF;

  -- migration_044: mismo fix que asignar_equipo.
  IF NOT EXISTS (SELECT 1 FROM obras WHERE id = p_obra_id AND constructora_id = v_personal.constructora_id) THEN
    RAISE EXCEPTION 'Proyecto no encontrado';
  END IF;

  SELECT obra_id INTO v_obra_actual FROM personal_asignaciones
  WHERE personal_id = p_personal_id AND fecha_hasta IS NULL;

  IF v_obra_actual = p_obra_id THEN
    RAISE EXCEPTION 'Ya está asignado a ese proyecto';
  END IF;

  UPDATE personal_asignaciones SET fecha_hasta = CURRENT_DATE
  WHERE personal_id = p_personal_id AND fecha_hasta IS NULL;

  INSERT INTO personal_asignaciones (personal_id, obra_id, constructora_id, fecha_desde, asignado_por)
  VALUES (p_personal_id, p_obra_id, v_personal.constructora_id, CURRENT_DATE, auth.uid());

  UPDATE personal SET estado = 'asignado' WHERE id = p_personal_id;
END;
$$;

CREATE OR REPLACE FUNCTION liberar_personal(p_personal_id UUID, p_nuevo_estado TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_nuevo_estado NOT IN ('disponible', 'licencia', 'baja') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_nuevo_estado;
  END IF;

  UPDATE personal_asignaciones SET fecha_hasta = CURRENT_DATE
  WHERE personal_id = p_personal_id AND fecha_hasta IS NULL;

  UPDATE personal SET estado = p_nuevo_estado WHERE id = p_personal_id;
END;
$$;

CREATE OR REPLACE FUNCTION asignar_cuadrilla(p_cuadrilla_id UUID, p_obra_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_persona          RECORD;
  v_obra_actual      UUID;
  v_count            INTEGER := 0;
  v_constructora_id  UUID;
BEGIN
  -- migration_044: mismo fix que asignar_equipo/asignar_personal — validar
  -- que p_obra_id sea del tenant de la cuadrilla antes de tocar nada.
  SELECT constructora_id INTO v_constructora_id FROM cuadrillas WHERE id = p_cuadrilla_id;
  IF v_constructora_id IS NULL THEN
    RAISE EXCEPTION 'Cuadrilla no encontrada';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM obras WHERE id = p_obra_id AND constructora_id = v_constructora_id) THEN
    RAISE EXCEPTION 'Proyecto no encontrado';
  END IF;

  FOR v_persona IN SELECT id, constructora_id FROM personal WHERE cuadrilla_id = p_cuadrilla_id AND estado != 'baja' LOOP
    SELECT obra_id INTO v_obra_actual FROM personal_asignaciones
    WHERE personal_id = v_persona.id AND fecha_hasta IS NULL;

    IF v_obra_actual IS DISTINCT FROM p_obra_id THEN
      UPDATE personal_asignaciones SET fecha_hasta = CURRENT_DATE
      WHERE personal_id = v_persona.id AND fecha_hasta IS NULL;

      INSERT INTO personal_asignaciones (personal_id, obra_id, constructora_id, fecha_desde, asignado_por)
      VALUES (v_persona.id, p_obra_id, v_persona.constructora_id, CURRENT_DATE, auth.uid());

      UPDATE personal SET estado = 'asignado' WHERE id = v_persona.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

ALTER TABLE personal              ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuadrillas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_asignaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_tenant" ON personal;
CREATE POLICY "personal_tenant" ON personal
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('personal'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('personal'));

DROP POLICY IF EXISTS "cuadrillas_tenant" ON cuadrillas;
CREATE POLICY "cuadrillas_tenant" ON cuadrillas
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('personal'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('personal'));

DROP POLICY IF EXISTS "personal_asignaciones_tenant" ON personal_asignaciones;
CREATE POLICY "personal_asignaciones_tenant" ON personal_asignaciones
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('personal'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('personal'));

CREATE OR REPLACE FUNCTION purgar_constructora_completa(p_constructora_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM cobros_proyecto   WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_obra    WHERE constructora_id = p_constructora_id;
  DELETE FROM presupuestos      WHERE constructora_id = p_constructora_id;
  DELETE FROM equipos           WHERE constructora_id = p_constructora_id;
  DELETE FROM personal          WHERE constructora_id = p_constructora_id;
  DELETE FROM cuadrillas        WHERE constructora_id = p_constructora_id;
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

-- ============================================================
-- MIGRATION 046 — Catálogo de rubros por constructora (estandariza
-- los nombres cargados en presupuesto_items/contrato_obra_items).
-- Ver migration_046.sql para el detalle comentado de cada decisión.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE IF NOT EXISTS rubros (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id     UUID NOT NULL REFERENCES constructoras(id),
  nombre              TEXT NOT NULL,
  nombre_normalizado  TEXT NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (constructora_id, nombre_normalizado)
);

CREATE INDEX IF NOT EXISTS idx_rubros_constructora ON rubros(constructora_id);

ALTER TABLE rubros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rubros_tenant" ON rubros;
CREATE POLICY "rubros_tenant" ON rubros
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras())
    AND (tiene_permiso('presupuestos') OR tiene_permiso_en_algun_proyecto('certificados'))
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras())
    AND (tiene_permiso('presupuestos') OR tiene_permiso_en_algun_proyecto('certificados'))
  );

CREATE OR REPLACE FUNCTION obtener_o_crear_rubro(p_constructora_id UUID, p_nombre TEXT)
RETURNS TABLE(id UUID, nombre TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_nombre_limpio       TEXT;
  v_nombre_normalizado  TEXT;
BEGIN
  v_nombre_limpio := btrim(regexp_replace(p_nombre, '\s+', ' ', 'g'));
  IF v_nombre_limpio = '' THEN
    RAISE EXCEPTION 'El nombre del rubro no puede estar vacío';
  END IF;
  v_nombre_normalizado := lower(unaccent(v_nombre_limpio));

  RETURN QUERY
  INSERT INTO rubros (constructora_id, nombre, nombre_normalizado)
  VALUES (p_constructora_id, v_nombre_limpio, v_nombre_normalizado)
  ON CONFLICT (constructora_id, nombre_normalizado)
  DO UPDATE SET nombre = rubros.nombre
  RETURNING rubros.id, rubros.nombre;
END;
$$;

-- Reemplaza la versión de más arriba: suma rubros.
CREATE OR REPLACE FUNCTION purgar_constructora_completa(p_constructora_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM cobros_proyecto   WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_obra    WHERE constructora_id = p_constructora_id;
  DELETE FROM presupuestos      WHERE constructora_id = p_constructora_id;
  DELETE FROM equipos           WHERE constructora_id = p_constructora_id;
  DELETE FROM personal          WHERE constructora_id = p_constructora_id;
  DELETE FROM cuadrillas        WHERE constructora_id = p_constructora_id;
  DELETE FROM rubros            WHERE constructora_id = p_constructora_id;
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


-- ============================================================
-- MIGRATION 049: linter de seguridad detectó que purgar_constructora_
-- completa() y seed_constructora_defaults() (SECURITY DEFINER, sin
-- chequeo interno de quién llama) eran ejecutables directo vía
-- /rest/v1/rpc/... por cualquier authenticated/anon. Ya se habían
-- revocado en migration_016/018/019, pero el grant volvió a estar
-- abierto en la base viva (un DROP FUNCTION + recreate en el medio
-- resetea los grants a los defaults, a diferencia de CREATE OR REPLACE).
-- Re-aplicado acá para que quede documentado en el estado final.
-- ============================================================

REVOKE EXECUTE ON FUNCTION purgar_constructora_completa(UUID) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION seed_constructora_defaults(UUID) FROM PUBLIC, authenticated, anon;

-- ============================================================
-- MIGRATION 050: hardening de search_path (linter, function_search_
-- path_mutable) en todas las funciones que no lo tenían fijado — ver
-- migration_050.sql para el detalle comentado. También limpia un
-- overload viejo de aceptar_presupuesto (4 parámetros, de antes de
-- migration_034) que quedó huérfano en la base porque CREATE OR REPLACE
-- no reemplaza una función cuando cambia la firma.
-- ============================================================

DROP FUNCTION IF EXISTS aceptar_presupuesto(UUID, UUID, TEXT, TEXT);

ALTER FUNCTION update_updated_at() SET search_path = public;
ALTER FUNCTION generar_cuotas_contrato() SET search_path = public;
ALTER FUNCTION marcar_cuotas_vencidas() SET search_path = public;
ALTER FUNCTION set_contrato_tenant() SET search_path = public;
ALTER FUNCTION set_reserva_tenant() SET search_path = public;
ALTER FUNCTION set_cuenta_proveedor_tenant() SET search_path = public;
ALTER FUNCTION set_auditoria_campos() SET search_path = public;
ALTER FUNCTION proteger_registro_financiero_terminal() SET search_path = public;
ALTER FUNCTION proteger_saldo_inicial() SET search_path = public;
ALTER FUNCTION proteger_cuota_pagada() SET search_path = public;
ALTER FUNCTION proteger_contrato_con_cobros() SET search_path = public;
ALTER FUNCTION proteger_columnas_sensibles_perfil() SET search_path = public;
ALTER FUNCTION bloquear_escritura_proyecto_cerrado() SET search_path = public;
ALTER FUNCTION bloquear_escritura_proyecto_cerrado_amenity() SET search_path = public;
ALTER FUNCTION bloquear_escritura_proyecto_cerrado_cuota() SET search_path = public;
ALTER FUNCTION asignar_numero_certificado() SET search_path = public;
ALTER FUNCTION asignar_numero_cobro_proyecto() SET search_path = public;
ALTER FUNCTION validar_monto_certificado() SET search_path = public;
ALTER FUNCTION validar_monto_certificado_item() SET search_path = public;
ALTER FUNCTION recalcular_monto_certificado() SET search_path = public;
ALTER FUNCTION proteger_contrato_obra_item() SET search_path = public;
ALTER FUNCTION proteger_certificado_item() SET search_path = public;
ALTER FUNCTION bloquear_escritura_proyecto_cerrado_contrato_item() SET search_path = public;
ALTER FUNCTION bloquear_escritura_proyecto_cerrado_certificado_item() SET search_path = public;
ALTER FUNCTION recalcular_monto_total_contrato() SET search_path = public;

ALTER FUNCTION seed_constructora_defaults(UUID) SET search_path = public;
ALTER FUNCTION sync_perfil_proyectos(UUID, UUID, JSONB) SET search_path = public;
ALTER FUNCTION resumen_unidades_por_obra(UUID[]) SET search_path = public;
ALTER FUNCTION aceptar_presupuesto(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) SET search_path = public;
ALTER FUNCTION asignar_equipo(UUID, UUID) SET search_path = public;
ALTER FUNCTION liberar_equipo(UUID, TEXT) SET search_path = public;
ALTER FUNCTION asignar_personal(UUID, UUID) SET search_path = public;
ALTER FUNCTION liberar_personal(UUID, TEXT) SET search_path = public;
ALTER FUNCTION asignar_cuadrilla(UUID, UUID) SET search_path = public;
ALTER FUNCTION obtener_o_crear_rubro(UUID, TEXT) SET search_path = public;
ALTER FUNCTION purgar_obra_completa(UUID) SET search_path = public;

-- ============================================================
-- A partir de acá: contenido de migration_052.sql (módulo de Compras)
-- ============================================================

-- ============================================================
-- MIGRATION 052: módulo de Compras — órdenes de compra cumplidas de
-- a partes (posiblemente por más de un proveedor), y stock repartido
-- entre obras como ledger simple (mismo espíritu que lib/tesoreria.ts:
-- nunca se decrementa un contador, "cuánto hay" se calcula sumando
-- movimientos en el momento).
--
-- Módulo de Empresa (como Proveedores/Inventario/Personal): decidir qué
-- comprar y repartir necesita ver el panorama completo de la
-- constructora, no un solo proyecto. Se gatea con tiene_permiso('compras'),
-- no tiene_permiso_proyecto().
--
-- Piezas:
--   productos                    catálogo de insumos (clon de rubros)
--   ordenes_compra                cabecera — obra_id NULLABLE (NULL = "pool
--                                 de empresa", para repartir después)
--   orden_compra_items             qué se pidió (producto + cantidad)
--   orden_compra_recepciones       cada cumplimiento parcial (proveedor,
--                                 fecha, monto) — genera un gasto al confirmar
--   orden_compra_recepcion_items   detalle de cantidad/precio por ítem recibido
--   stock_movimientos              ledger: entrada (llega mercadería) /
--                                 salida (se reparte a una obra u otra)
--
-- "Cuánto se recibió" de un orden_compra_item y "cuánto stock hay" de un
-- producto en una obra son SIEMPRE derivados (SUM de filas), nunca una
-- columna que se sincroniza a mano — mismo criterio que estaVencido()
-- en lib/utils.ts para no tener un estado que se desincronice de la realidad.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- Catálogo de productos/insumos (clon exacto del patrón de `rubros`,
-- ver schema.sql ~2283 y lib/rubros.ts) — necesario para poder sumar
-- stock de un mismo insumo entre compras distintas sin depender de que
-- todos tipeen el nombre igual.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS productos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id     UUID NOT NULL REFERENCES constructoras(id),
  nombre              TEXT NOT NULL,
  nombre_normalizado  TEXT NOT NULL,
  unidad_medida       TEXT NOT NULL DEFAULT 'unidad',
  categoria_id        UUID REFERENCES categorias_costo(id),
  activo              BOOLEAN NOT NULL DEFAULT true,
  notas               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (constructora_id, nombre_normalizado)
);

CREATE INDEX IF NOT EXISTS idx_productos_constructora ON productos(constructora_id);
CREATE INDEX IF NOT EXISTS idx_productos_categoria     ON productos(categoria_id);

CREATE OR REPLACE FUNCTION obtener_o_crear_producto(
  p_constructora_id UUID,
  p_nombre TEXT,
  p_unidad_medida TEXT DEFAULT 'unidad',
  p_categoria_id UUID DEFAULT NULL
)
RETURNS TABLE(id UUID, nombre TEXT, unidad_medida TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_nombre_limpio       TEXT;
  v_nombre_normalizado  TEXT;
  v_unidad_limpia       TEXT;
BEGIN
  v_nombre_limpio := btrim(regexp_replace(p_nombre, '\s+', ' ', 'g'));
  IF v_nombre_limpio = '' THEN
    RAISE EXCEPTION 'El nombre del producto no puede estar vacío';
  END IF;
  v_nombre_normalizado := lower(unaccent(v_nombre_limpio));
  v_unidad_limpia := COALESCE(NULLIF(btrim(p_unidad_medida), ''), 'unidad');

  -- Si ya existe (mismo nombre normalizado), NO pisa la categoría existente
  -- con NULL — solo la actualiza si se pasó una explícita.
  RETURN QUERY
  INSERT INTO productos (constructora_id, nombre, nombre_normalizado, unidad_medida, categoria_id)
  VALUES (p_constructora_id, v_nombre_limpio, v_nombre_normalizado, v_unidad_limpia, p_categoria_id)
  ON CONFLICT (constructora_id, nombre_normalizado)
  DO UPDATE SET categoria_id = COALESCE(EXCLUDED.categoria_id, productos.categoria_id)
  RETURNING productos.id, productos.nombre, productos.unidad_medida;
END;
$$;

-- ------------------------------------------------------------
-- Cabecera de la orden de compra. obra_id NULLABLE a propósito: una
-- orden puede nacer "para repartir después" (pool de empresa, igual
-- que gastos/cuentas a nivel empresa) o apuntar a una obra puntual
-- desde el vacío. `estado` es SOLO el ciclo administrativo (si se
-- puede seguir editando o si se canceló) — cuánto se cumplió es
-- derivado de orden_compra_recepcion_items, no vive acá.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ordenes_compra (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id UUID NOT NULL REFERENCES constructoras(id),
  obra_id         UUID REFERENCES obras(id),
  numero          INTEGER NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'confirmada', 'cancelada')),
  fecha_emision   DATE NOT NULL DEFAULT CURRENT_DATE,
  notas           TEXT,
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  updated_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ordenes_compra_constructora ON ordenes_compra(constructora_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_obra         ON ordenes_compra(obra_id);

-- Numeración secuencial por constructora — mismo mecanismo (advisory
-- lock + MAX+1) que asignar_numero_certificado()/asignar_numero_cobro_proyecto().
CREATE OR REPLACE FUNCTION asignar_numero_orden_compra()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ordenes_compra:' || NEW.constructora_id::text));
  SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
  FROM ordenes_compra WHERE constructora_id = NEW.constructora_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asignar_numero_orden_compra ON ordenes_compra;
CREATE TRIGGER trg_asignar_numero_orden_compra
  BEFORE INSERT ON ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION asignar_numero_orden_compra();

DROP TRIGGER IF EXISTS trg_auditoria_campos ON ordenes_compra;
CREATE TRIGGER trg_auditoria_campos
  BEFORE INSERT OR UPDATE ON ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_campos();

DROP TRIGGER IF EXISTS trg_registrar_auditoria ON ordenes_compra;
CREATE TRIGGER trg_registrar_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

-- ------------------------------------------------------------
-- Ítems de la orden (qué se pidió). constructora_id denormalizado
-- (mismo criterio que presupuesto_items/equipo_asignaciones) para RLS
-- simple sin joins — se deriva sola del padre si no se manda, así un
-- INSERT directo desde el cliente no puede colgar el ítem de una orden
-- de otro tenant aunque mande un constructora_id propio válido.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orden_compra_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_compra_id     UUID NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  constructora_id     UUID NOT NULL REFERENCES constructoras(id),
  producto_id         UUID NOT NULL REFERENCES productos(id),
  cantidad_solicitada NUMERIC(15,2) NOT NULL CHECK (cantidad_solicitada > 0),
  unidad_medida       TEXT,
  notas               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orden_compra_items_orden     ON orden_compra_items(orden_compra_id);
CREATE INDEX IF NOT EXISTS idx_orden_compra_items_producto  ON orden_compra_items(producto_id);

CREATE OR REPLACE FUNCTION set_orden_compra_item_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.constructora_id IS NULL THEN
    SELECT constructora_id INTO NEW.constructora_id FROM ordenes_compra WHERE id = NEW.orden_compra_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orden_compra_item_tenant ON orden_compra_items;
CREATE TRIGGER trg_orden_compra_item_tenant
  BEFORE INSERT ON orden_compra_items
  FOR EACH ROW EXECUTE FUNCTION set_orden_compra_item_tenant();

-- ------------------------------------------------------------
-- Cada cumplimiento parcial de la orden: quién (proveedor), cuándo, a
-- cuánto. gasto_id se completa recién al confirmar (RPC más abajo) —
-- ON DELETE SET NULL para que borrar el gasto (o purgar la obra) no
-- rompa la orden de borrado en las funciones de purgado.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orden_compra_recepciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_compra_id UUID NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  constructora_id UUID NOT NULL REFERENCES constructoras(id),
  proveedor_id    UUID NOT NULL REFERENCES proveedores(id),
  gasto_id        UUID REFERENCES gastos(id) ON DELETE SET NULL,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  moneda          TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
  notas           TEXT,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orden_compra_recepciones_orden      ON orden_compra_recepciones(orden_compra_id);
CREATE INDEX IF NOT EXISTS idx_orden_compra_recepciones_proveedor  ON orden_compra_recepciones(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_orden_compra_recepciones_gasto      ON orden_compra_recepciones(gasto_id);

CREATE OR REPLACE FUNCTION set_orden_compra_recepcion_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.constructora_id IS NULL THEN
    SELECT constructora_id INTO NEW.constructora_id FROM ordenes_compra WHERE id = NEW.orden_compra_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orden_compra_recepcion_tenant ON orden_compra_recepciones;
CREATE TRIGGER trg_orden_compra_recepcion_tenant
  BEFORE INSERT ON orden_compra_recepciones
  FOR EACH ROW EXECUTE FUNCTION set_orden_compra_recepcion_tenant();

-- ------------------------------------------------------------
-- Detalle de esa recepción: qué ítem y cuánta cantidad llegó, a qué
-- precio. "Cuánto se recibió" de un orden_compra_item = SUM(cantidad_recibida)
-- de todas sus filas acá — se calcula al leer, no se guarda.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orden_compra_recepcion_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recepcion_id         UUID NOT NULL REFERENCES orden_compra_recepciones(id) ON DELETE CASCADE,
  -- CASCADE (no default NO ACTION): esta fila y orden_compra_items comparten
  -- el mismo ancestro (ordenes_compra) por dos caminos de cascada distintos
  -- (vía recepciones y directo) — con NO ACTION, borrar la orden podría
  -- violar esta FK si Postgres procesa los caminos en el orden "equivocado".
  orden_compra_item_id UUID NOT NULL REFERENCES orden_compra_items(id) ON DELETE CASCADE,
  constructora_id      UUID NOT NULL REFERENCES constructoras(id),
  cantidad_recibida    NUMERIC(15,2) NOT NULL CHECK (cantidad_recibida > 0),
  precio_unitario      NUMERIC(15,2) NOT NULL CHECK (precio_unitario >= 0),
  subtotal             NUMERIC(15,2) GENERATED ALWAYS AS (cantidad_recibida * precio_unitario) STORED,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orden_compra_recepcion_items_recepcion ON orden_compra_recepcion_items(recepcion_id);
CREATE INDEX IF NOT EXISTS idx_orden_compra_recepcion_items_item      ON orden_compra_recepcion_items(orden_compra_item_id);

CREATE OR REPLACE FUNCTION set_recepcion_item_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.constructora_id IS NULL THEN
    SELECT constructora_id INTO NEW.constructora_id FROM orden_compra_recepciones WHERE id = NEW.recepcion_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recepcion_item_tenant ON orden_compra_recepcion_items;
CREATE TRIGGER trg_recepcion_item_tenant
  BEFORE INSERT ON orden_compra_recepcion_items
  FOR EACH ROW EXECUTE FUNCTION set_recepcion_item_tenant();

-- ------------------------------------------------------------
-- Ledger de stock. obra_id NULLABLE = pool de empresa. "Stock actual"
-- de un producto en una obra (o en el pool) = SUM(entrada) - SUM(salida),
-- calculado al leer (mismo criterio que calcularSaldosDeCuentas en
-- lib/tesoreria.ts para saldos de cuentas) — nunca un contador que se
-- decrementa, así no hay riesgo de que se desincronice de la realidad.
-- Repartir NO valida que alcance el stock (ledger simple, decisión de
-- producto) — puede dar negativo, la UI lo muestra como aviso, no bloquea.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_movimientos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id     UUID NOT NULL REFERENCES constructoras(id),
  producto_id         UUID NOT NULL REFERENCES productos(id),
  obra_id             UUID REFERENCES obras(id),
  tipo                TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
  cantidad            NUMERIC(15,2) NOT NULL CHECK (cantidad > 0),
  origen_recepcion_id UUID REFERENCES orden_compra_recepciones(id) ON DELETE SET NULL,
  notas               TEXT,
  created_by          UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movimientos_constructora ON stock_movimientos(constructora_id);
CREATE INDEX IF NOT EXISTS idx_stock_movimientos_producto     ON stock_movimientos(producto_id);
CREATE INDEX IF NOT EXISTS idx_stock_movimientos_obra         ON stock_movimientos(obra_id);
-- Consulta más frecuente: "cuánto hay de este producto en esta obra" —
-- índice compuesto para no escanear todo el ledger de la constructora.
CREATE INDEX IF NOT EXISTS idx_stock_movimientos_producto_obra ON stock_movimientos(producto_id, obra_id);

CREATE OR REPLACE FUNCTION set_stock_movimiento_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.constructora_id IS NULL THEN
    SELECT constructora_id INTO NEW.constructora_id FROM productos WHERE id = NEW.producto_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_movimiento_tenant ON stock_movimientos;
CREATE TRIGGER trg_stock_movimiento_tenant
  BEFORE INSERT ON stock_movimientos
  FOR EACH ROW EXECUTE FUNCTION set_stock_movimiento_tenant();

-- ------------------------------------------------------------
-- Confirmar una recepción: crea el gasto (proveedor/monto/moneda/obra
-- de la orden), lo linkea a la recepción, y da entrada al stock por
-- cada ítem recibido. Todo atómico (una sola llamada de función
-- plpgsql = una transacción) — evita dejar el gasto creado sin el
-- movimiento de stock si algo falla a mitad de camino.
--
-- SECURITY INVOKER a propósito (mismo criterio que aceptar_presupuesto()):
-- el caller necesita tiene_permiso('compras') para las tablas de compras
-- Y tiene_permiso_proyecto(obra_id,'gastos') (o es_admin() si obra_id es
-- NULL) para poder insertar en `gastos` — si no tiene el módulo Gastos
-- habilitado en ese proyecto, esto falla con el error de RLS de esa
-- tabla. Documentado como aviso en lib/permisos.ts (MODULOS.compras).
-- ------------------------------------------------------------
-- Ver migration_056.sql: monto_neto NO se guarda en orden_compra_recepciones
-- (siempre es SUM(subtotal) de los ítems, se calcula acá) — iva/percepciones/
-- numero_comprobante sí, se cargan una vez por recepción (como en una
-- factura real) y se copian al gasto que se genera al confirmar.
CREATE OR REPLACE FUNCTION confirmar_recepcion_compra(p_recepcion_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_recepcion   orden_compra_recepciones%ROWTYPE;
  v_orden       ordenes_compra%ROWTYPE;
  v_monto_neto  NUMERIC(15,2);
  v_monto_total NUMERIC(15,2);
  v_gasto_id    UUID;
  v_item        RECORD;
BEGIN
  SELECT * INTO v_recepcion FROM orden_compra_recepciones WHERE id = p_recepcion_id;
  IF v_recepcion.id IS NULL THEN
    RAISE EXCEPTION 'Recepción no encontrada';
  END IF;
  IF v_recepcion.gasto_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta recepción ya fue confirmada';
  END IF;

  SELECT * INTO v_orden FROM ordenes_compra WHERE id = v_recepcion.orden_compra_id;
  IF v_orden.estado = 'cancelada' THEN
    RAISE EXCEPTION 'La orden de compra está cancelada';
  END IF;

  SELECT COALESCE(SUM(subtotal), 0) INTO v_monto_neto
  FROM orden_compra_recepcion_items WHERE recepcion_id = p_recepcion_id;

  IF v_monto_neto <= 0 THEN
    RAISE EXCEPTION 'La recepción no tiene ítems cargados';
  END IF;

  -- migration_066: se agrega percepciones — antes solo neto+IVA, y esa
  -- plata también hay que pagarla al proveedor.
  v_monto_total := v_monto_neto + COALESCE(v_recepcion.iva, 0) + COALESCE(v_recepcion.percepciones, 0);

  INSERT INTO gastos (constructora_id, obra_id, proveedor_id, descripcion, monto, moneda, fecha_vencimiento, estado, notas, monto_neto, iva, percepciones, numero_comprobante)
  VALUES (
    v_recepcion.constructora_id,
    v_orden.obra_id,
    v_recepcion.proveedor_id,
    'Compra OC-' || v_orden.numero,
    v_monto_total,
    v_recepcion.moneda,
    v_recepcion.fecha,
    'Pendiente',
    v_recepcion.notas,
    v_monto_neto,
    v_recepcion.iva,
    v_recepcion.percepciones,
    v_recepcion.numero_comprobante
  )
  RETURNING id INTO v_gasto_id;

  UPDATE orden_compra_recepciones SET gasto_id = v_gasto_id WHERE id = p_recepcion_id;

  FOR v_item IN
    SELECT oci.cantidad_recibida, oi.producto_id
    FROM orden_compra_recepcion_items oci
    JOIN orden_compra_items oi ON oi.id = oci.orden_compra_item_id
    WHERE oci.recepcion_id = p_recepcion_id
  LOOP
    INSERT INTO stock_movimientos (constructora_id, producto_id, obra_id, tipo, cantidad, origen_recepcion_id, created_by)
    VALUES (v_recepcion.constructora_id, v_item.producto_id, v_orden.obra_id, 'entrada', v_item.cantidad_recibida, p_recepcion_id, auth.uid());
  END LOOP;

  IF v_orden.estado = 'borrador' THEN
    UPDATE ordenes_compra SET estado = 'confirmada' WHERE id = v_orden.id;
  END IF;

  RETURN v_gasto_id;
END;
$$;

-- ------------------------------------------------------------
-- Repartir stock entre obras (o desde/hacia el pool de empresa,
-- obra_id NULL): un par salida+entrada atómico. Sin validar que
-- alcance (ledger simple) — puede dejar el origen en negativo, es
-- responsabilidad de quien reparte fijarse en la UI.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION repartir_stock(
  p_producto_id UUID,
  p_obra_origen UUID,
  p_obra_destino UUID,
  p_cantidad NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_constructora_id UUID;
BEGIN
  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad a repartir debe ser mayor a cero';
  END IF;
  IF p_obra_origen IS NOT DISTINCT FROM p_obra_destino THEN
    RAISE EXCEPTION 'El origen y el destino no pueden ser el mismo';
  END IF;

  SELECT constructora_id INTO v_constructora_id FROM productos WHERE id = p_producto_id;
  IF v_constructora_id IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  INSERT INTO stock_movimientos (constructora_id, producto_id, obra_id, tipo, cantidad, created_by)
  VALUES (v_constructora_id, p_producto_id, p_obra_origen, 'salida', p_cantidad, auth.uid());

  INSERT INTO stock_movimientos (constructora_id, producto_id, obra_id, tipo, cantidad, created_by)
  VALUES (v_constructora_id, p_producto_id, p_obra_destino, 'entrada', p_cantidad, auth.uid());
END;
$$;

-- ------------------------------------------------------------
-- Resumen de stock agregado por producto+obra (obra_id NULL = pool de
-- empresa) — mismo criterio que resumen_unidades_por_obra: agregar en
-- Postgres en vez de traer todo el ledger al cliente para sumarlo ahí.
-- SECURITY INVOKER (default): corre con la RLS del caller, así que
-- tiene_permiso('compras') de stock_movimientos ya lo protege solo.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION resumen_stock(p_constructora_id UUID)
RETURNS TABLE(producto_id UUID, obra_id UUID, cantidad NUMERIC)
LANGUAGE sql
STABLE
AS $$
  SELECT
    producto_id,
    obra_id,
    SUM(CASE WHEN tipo = 'entrada' THEN cantidad ELSE -cantidad END) AS cantidad
  FROM stock_movimientos
  WHERE constructora_id = p_constructora_id
  GROUP BY producto_id, obra_id
  HAVING SUM(CASE WHEN tipo = 'entrada' THEN cantidad ELSE -cantidad END) != 0;
$$;

-- ------------------------------------------------------------
-- RLS — módulo de Empresa, un solo permiso ('compras') para todas las
-- tablas (catálogo, órdenes, recepciones y stock), igual que
-- Proveedores/Inventario/Personal no fragmentan el árbol de permisos.
-- ------------------------------------------------------------
ALTER TABLE productos                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes_compra                ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_compra_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_compra_recepciones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_compra_recepcion_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movimientos             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "productos_tenant" ON productos;
CREATE POLICY "productos_tenant" ON productos
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'));

DROP POLICY IF EXISTS "ordenes_compra_tenant" ON ordenes_compra;
CREATE POLICY "ordenes_compra_tenant" ON ordenes_compra
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'));

DROP POLICY IF EXISTS "orden_compra_items_tenant" ON orden_compra_items;
CREATE POLICY "orden_compra_items_tenant" ON orden_compra_items
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'));

DROP POLICY IF EXISTS "orden_compra_recepciones_tenant" ON orden_compra_recepciones;
CREATE POLICY "orden_compra_recepciones_tenant" ON orden_compra_recepciones
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'));

DROP POLICY IF EXISTS "orden_compra_recepcion_items_tenant" ON orden_compra_recepcion_items;
CREATE POLICY "orden_compra_recepcion_items_tenant" ON orden_compra_recepcion_items
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'));

DROP POLICY IF EXISTS "stock_movimientos_tenant" ON stock_movimientos;
CREATE POLICY "stock_movimientos_tenant" ON stock_movimientos
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'));

-- ------------------------------------------------------------
-- Purgas: sumar las tablas nuevas a los dos RPCs de borrado en cascada
-- ya existentes (mismo mantenimiento que se hizo con equipos/personal
-- en su momento).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION purgar_constructora_completa(p_constructora_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM stock_movimientos           WHERE constructora_id = p_constructora_id;
  DELETE FROM ordenes_compra              WHERE constructora_id = p_constructora_id;
  DELETE FROM productos                   WHERE constructora_id = p_constructora_id;

  DELETE FROM cobros_proyecto   WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_obra    WHERE constructora_id = p_constructora_id;
  DELETE FROM presupuestos      WHERE constructora_id = p_constructora_id;
  DELETE FROM equipos           WHERE constructora_id = p_constructora_id;
  DELETE FROM personal          WHERE constructora_id = p_constructora_id;
  DELETE FROM cuadrillas        WHERE constructora_id = p_constructora_id;
  DELETE FROM rubros            WHERE constructora_id = p_constructora_id;
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

-- Ver migration_053.sql: personal_asignaciones quedó afuera de esta
-- función cuando migration_038 sumó la tabla (sí se actualizó
-- purgar_constructora_completa, no esta), causando violación de FK al
-- eliminar un proyecto con personal asignado.
CREATE OR REPLACE FUNCTION purgar_obra_completa(p_obra_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM stock_movimientos WHERE obra_id = p_obra_id;
  DELETE FROM ordenes_compra    WHERE obra_id = p_obra_id;

  DELETE FROM contratos_venta   WHERE obra_id = p_obra_id;
  DELETE FROM reservas          WHERE obra_id = p_obra_id;
  DELETE FROM unidades          WHERE obra_id = p_obra_id;
  DELETE FROM tipologias        WHERE obra_id = p_obra_id;
  DELETE FROM amenities         WHERE obra_id = p_obra_id;

  DELETE FROM cobros_proyecto     WHERE obra_id = p_obra_id;
  DELETE FROM certificados_avance WHERE obra_id = p_obra_id;
  DELETE FROM contratos_obra      WHERE obra_id = p_obra_id;

  DELETE FROM equipo_asignaciones   WHERE obra_id = p_obra_id;
  DELETE FROM personal_asignaciones WHERE obra_id = p_obra_id;
  DELETE FROM gastos                WHERE obra_id = p_obra_id;

  -- cuentas_propias NO se borra: su FK (obra_id ON DELETE SET NULL) la
  -- desvincula sola al llegar al DELETE FROM obras — sobrevive como
  -- cuenta de empresa en vez de perderse (representa un saldo_inicial
  -- real, no un dato de ejecución del proyecto).

  DELETE FROM obras WHERE id = p_obra_id;
END;
$$;

-- ------------------------------------------------------------
-- search_path fijo (mismo hardening de migration_050 para el linter
-- de Supabase, categoría function_search_path_mutable).
-- ------------------------------------------------------------
ALTER FUNCTION obtener_o_crear_producto(UUID, TEXT, TEXT, UUID) SET search_path = public;
ALTER FUNCTION asignar_numero_orden_compra() SET search_path = public;
ALTER FUNCTION set_orden_compra_item_tenant() SET search_path = public;
ALTER FUNCTION set_orden_compra_recepcion_tenant() SET search_path = public;
ALTER FUNCTION set_recepcion_item_tenant() SET search_path = public;
ALTER FUNCTION set_stock_movimiento_tenant() SET search_path = public;
ALTER FUNCTION confirmar_recepcion_compra(UUID) SET search_path = public;
ALTER FUNCTION repartir_stock(UUID, UUID, UUID, NUMERIC) SET search_path = public;
ALTER FUNCTION resumen_stock(UUID) SET search_path = public;

-- ------------------------------------------------------------
-- migration_054: simetría con gastos — cobros_proyecto suma el mismo
-- desglose contable (informativo, no afecta cálculos de tesorería/caja).
-- ------------------------------------------------------------
ALTER TABLE cobros_proyecto
  ADD COLUMN IF NOT EXISTS monto_neto         DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS iva                DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS percepciones       DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS numero_comprobante TEXT,
  ADD COLUMN IF NOT EXISTS comprobante_url    TEXT;

-- ------------------------------------------------------------
-- migration_055: condición de IVA a nivel contrato/presupuesto — ver
-- comentario en migration_055.sql. aceptar_presupuesto() ya se
-- actualizó in-place más arriba para copiar iva_pct.
-- ------------------------------------------------------------
ALTER TABLE contratos_obra ADD COLUMN IF NOT EXISTS iva_pct DECIMAL(5,2);
ALTER TABLE presupuestos   ADD COLUMN IF NOT EXISTS iva_pct DECIMAL(5,2);

-- ------------------------------------------------------------
-- migration_056: desglose neto/IVA/comprobante para gastos generados
-- desde Compras — ver comentario en migration_056.sql y en
-- confirmar_recepcion_compra() más arriba (ya actualizada in-place).
-- ------------------------------------------------------------
ALTER TABLE orden_compra_recepciones
  ADD COLUMN IF NOT EXISTS iva                DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS percepciones       DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS numero_comprobante TEXT;

-- ------------------------------------------------------------
-- migration_057: desglose contable para cuotas (cobros de venta de
-- unidades) — mismo criterio informativo que gastos/cobros_proyecto.
-- ------------------------------------------------------------
ALTER TABLE cuotas
  ADD COLUMN IF NOT EXISTS monto_neto         DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS iva                DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS percepciones       DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS numero_comprobante TEXT,
  ADD COLUMN IF NOT EXISTS comprobante_url    TEXT;

-- ------------------------------------------------------------
-- migration_058: estado (vigente/rescindido) en contratos_venta —
-- ver comentario en migration_058.sql.
-- ------------------------------------------------------------
ALTER TABLE contratos_venta
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'rescindido'));

-- ------------------------------------------------------------
-- migration_061: índices faltantes en estado de contratos_venta/
-- cobros_proyecto — ver comentario en migration_061.sql.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_contratos_venta_estado ON contratos_venta(estado);
CREATE INDEX IF NOT EXISTS idx_cobros_proyecto_estado ON cobros_proyecto(estado);
-- ------------------------------------------------------------
-- Acopios: crédito prepago con un proveedor, denominado en la cantidad
-- de un "producto de referencia" (kg de acero, unidades de ladrillo,
-- lo que sea) — no en pesos, para no perder poder de compra cuando ese
-- producto sube de precio. Vive dentro de Compras, en paralelo a
-- ordenes_compra (esa tabla asume que sabés de antemano qué pedís; un
-- acopio es plata ya pagada que se define en qué se convierte después).
--
-- La conversión de un retiro es una sola fórmula para los dos casos:
--   - si el producto retirado ES el de referencia del acopio, se
--     descuenta 1 a 1 (los precios ni se piden).
--   - si es OTRO producto, se exige el precio de hoy de ambos y se
--     convierte: cantidad_descontada = (cantidad × precio_retiro) ÷ precio_referencia.
-- Esto es justo lo que hace un proveedor cuando indexa un acopio de
-- acero a otro material: convierte a precio de hoy de los dos lados.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS acopios (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id        UUID NOT NULL REFERENCES constructoras(id),
  obra_id                UUID REFERENCES obras(id),
  proveedor_id           UUID NOT NULL REFERENCES proveedores(id),
  producto_referencia_id UUID NOT NULL REFERENCES productos(id),
  numero                 INTEGER NOT NULL,
  saldo_inicial          NUMERIC(15,2) NOT NULL CHECK (saldo_inicial > 0),
  monto_pagado           NUMERIC(15,2) NOT NULL,
  moneda                 TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
  fecha                  DATE NOT NULL DEFAULT CURRENT_DATE,
  gasto_id               UUID REFERENCES gastos(id) ON DELETE SET NULL,
  estado                 TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'cerrado')),
  notas                  TEXT,
  created_by             UUID REFERENCES auth.users(id),
  updated_by             UUID REFERENCES auth.users(id),
  updated_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (constructora_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_acopios_constructora ON acopios(constructora_id);
CREATE INDEX IF NOT EXISTS idx_acopios_obra         ON acopios(obra_id);
CREATE INDEX IF NOT EXISTS idx_acopios_proveedor     ON acopios(proveedor_id);

-- "Cuánto queda" nunca se guarda — se calcula sumando acopio_retiros
-- (mismo criterio que stock_movimientos/resumen_stock).
CREATE TABLE IF NOT EXISTS acopio_retiros (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acopio_id                      UUID NOT NULL REFERENCES acopios(id) ON DELETE CASCADE,
  constructora_id                UUID NOT NULL REFERENCES constructoras(id),
  producto_id                    UUID NOT NULL REFERENCES productos(id),
  cantidad                       NUMERIC(15,2) NOT NULL CHECK (cantidad > 0),
  precio_unitario_retiro         NUMERIC(15,2),  -- NULL cuando producto_id = producto de referencia del acopio (no hace falta)
  precio_unitario_referencia     NUMERIC(15,2),
  cantidad_referencia_descontada NUMERIC(15,2) NOT NULL,  -- fijo al momento del retiro, no se recalcula después
  obra_id                        UUID REFERENCES obras(id),
  fecha                          DATE NOT NULL DEFAULT CURRENT_DATE,
  notas                          TEXT,
  created_by                     UUID REFERENCES auth.users(id),
  created_at                     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acopio_retiros_acopio       ON acopio_retiros(acopio_id);
CREATE INDEX IF NOT EXISTS idx_acopio_retiros_constructora ON acopio_retiros(constructora_id);
CREATE INDEX IF NOT EXISTS idx_acopio_retiros_producto     ON acopio_retiros(producto_id);
CREATE INDEX IF NOT EXISTS idx_acopio_retiros_obra         ON acopio_retiros(obra_id);

-- Cada retiro genera stock real, igual que una recepción de compra —
-- mismo patrón que origen_recepcion_id.
ALTER TABLE stock_movimientos
  ADD COLUMN IF NOT EXISTS origen_acopio_retiro_id UUID REFERENCES acopio_retiros(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- Tenant + numeración (mismos patrones que orden_compra_items /
-- asignar_numero_orden_compra)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_acopio_retiro_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.constructora_id IS NULL THEN
    SELECT constructora_id INTO NEW.constructora_id FROM acopios WHERE id = NEW.acopio_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_acopio_retiro_tenant ON acopio_retiros;
CREATE TRIGGER trg_acopio_retiro_tenant
  BEFORE INSERT ON acopio_retiros
  FOR EACH ROW EXECUTE FUNCTION set_acopio_retiro_tenant();

CREATE OR REPLACE FUNCTION asignar_numero_acopio()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('acopios:' || NEW.constructora_id::text));
  SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
  FROM acopios WHERE constructora_id = NEW.constructora_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asignar_numero_acopio ON acopios;
CREATE TRIGGER trg_asignar_numero_acopio
  BEFORE INSERT ON acopios
  FOR EACH ROW EXECUTE FUNCTION asignar_numero_acopio();

-- ------------------------------------------------------------
-- registrar_retiro_acopio(): la única lógica de negocio real. SECURITY
-- INVOKER a propósito (mismo criterio que confirmar_recepcion_compra/
-- repartir_stock) — corre bajo el RLS real de quien llama.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION registrar_retiro_acopio(
  p_acopio_id UUID,
  p_producto_id UUID,
  p_cantidad NUMERIC,
  p_precio_retiro NUMERIC DEFAULT NULL,
  p_precio_referencia NUMERIC DEFAULT NULL,
  p_obra_id UUID DEFAULT NULL,
  p_notas TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_acopio              acopios%ROWTYPE;
  v_cantidad_descontada NUMERIC(15,2);
  v_retiro_id           UUID;
BEGIN
  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad retirada debe ser mayor a cero';
  END IF;

  SELECT * INTO v_acopio FROM acopios WHERE id = p_acopio_id;
  IF v_acopio.id IS NULL THEN
    RAISE EXCEPTION 'Acopio no encontrado';
  END IF;

  IF p_producto_id = v_acopio.producto_referencia_id THEN
    v_cantidad_descontada := p_cantidad;
  ELSE
    IF p_precio_retiro IS NULL OR p_precio_retiro <= 0 OR p_precio_referencia IS NULL OR p_precio_referencia <= 0 THEN
      RAISE EXCEPTION 'Para retirar un producto distinto al de referencia hace falta el precio de hoy de los dos';
    END IF;
    v_cantidad_descontada := (p_cantidad * p_precio_retiro) / p_precio_referencia;
  END IF;

  INSERT INTO acopio_retiros (
    acopio_id, constructora_id, producto_id, cantidad, precio_unitario_retiro,
    precio_unitario_referencia, cantidad_referencia_descontada, obra_id, notas, created_by
  )
  VALUES (
    p_acopio_id, v_acopio.constructora_id, p_producto_id, p_cantidad, p_precio_retiro,
    p_precio_referencia, v_cantidad_descontada, p_obra_id, p_notas, auth.uid()
  )
  RETURNING id INTO v_retiro_id;

  INSERT INTO stock_movimientos (constructora_id, producto_id, obra_id, tipo, cantidad, origen_acopio_retiro_id, created_by)
  VALUES (v_acopio.constructora_id, p_producto_id, p_obra_id, 'entrada', p_cantidad, v_retiro_id, auth.uid());

  RETURN v_retiro_id;
END;
$$;

-- Agregado en Postgres (no traer todos los retiros al cliente solo para
-- sumarlos) — mismo criterio que resumen_stock.
CREATE OR REPLACE FUNCTION resumen_acopios(p_constructora_id UUID)
RETURNS TABLE(acopio_id UUID, saldo_actual NUMERIC)
LANGUAGE sql
STABLE
AS $$
  SELECT
    a.id,
    a.saldo_inicial - COALESCE(SUM(r.cantidad_referencia_descontada), 0)
  FROM acopios a
  LEFT JOIN acopio_retiros r ON r.acopio_id = a.id
  WHERE a.constructora_id = p_constructora_id
  GROUP BY a.id, a.saldo_inicial;
$$;

ALTER FUNCTION set_acopio_retiro_tenant() SET search_path = public;
ALTER FUNCTION asignar_numero_acopio() SET search_path = public;
ALTER FUNCTION registrar_retiro_acopio(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT) SET search_path = public;
ALTER FUNCTION resumen_acopios(UUID) SET search_path = public;

-- ------------------------------------------------------------
-- RLS — mismo patrón que el resto de Compras (tiene_permiso('compras')).
-- ------------------------------------------------------------
ALTER TABLE acopios        ENABLE ROW LEVEL SECURITY;
ALTER TABLE acopio_retiros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acopios_tenant" ON acopios;
CREATE POLICY "acopios_tenant" ON acopios
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'));

DROP POLICY IF EXISTS "acopio_retiros_tenant" ON acopio_retiros;
CREATE POLICY "acopio_retiros_tenant" ON acopio_retiros
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'));

-- ------------------------------------------------------------
-- Purgas: sumar acopios/acopio_retiros (antes de borrar productos/
-- proveedores/gastos, que los referencian).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION purgar_constructora_completa(p_constructora_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM acopio_retiros    WHERE constructora_id = p_constructora_id;
  DELETE FROM acopios           WHERE constructora_id = p_constructora_id;
  DELETE FROM stock_movimientos WHERE constructora_id = p_constructora_id;
  DELETE FROM ordenes_compra    WHERE constructora_id = p_constructora_id;
  DELETE FROM productos         WHERE constructora_id = p_constructora_id;

  DELETE FROM cobros_proyecto   WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_obra    WHERE constructora_id = p_constructora_id;
  DELETE FROM presupuestos      WHERE constructora_id = p_constructora_id;
  DELETE FROM equipos           WHERE constructora_id = p_constructora_id;
  DELETE FROM personal          WHERE constructora_id = p_constructora_id;
  DELETE FROM cuadrillas        WHERE constructora_id = p_constructora_id;
  DELETE FROM rubros            WHERE constructora_id = p_constructora_id;
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

REVOKE EXECUTE ON FUNCTION purgar_constructora_completa(UUID) FROM PUBLIC, authenticated, anon;

CREATE OR REPLACE FUNCTION purgar_obra_completa(p_obra_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM acopio_retiros    WHERE obra_id = p_obra_id;
  DELETE FROM acopios           WHERE obra_id = p_obra_id;
  DELETE FROM stock_movimientos WHERE obra_id = p_obra_id;
  DELETE FROM ordenes_compra    WHERE obra_id = p_obra_id;

  DELETE FROM contratos_venta   WHERE obra_id = p_obra_id;
  DELETE FROM reservas          WHERE obra_id = p_obra_id;
  DELETE FROM unidades          WHERE obra_id = p_obra_id;
  DELETE FROM tipologias        WHERE obra_id = p_obra_id;
  DELETE FROM amenities         WHERE obra_id = p_obra_id;

  DELETE FROM cobros_proyecto     WHERE obra_id = p_obra_id;
  DELETE FROM certificados_avance WHERE obra_id = p_obra_id;
  DELETE FROM contratos_obra      WHERE obra_id = p_obra_id;

  DELETE FROM equipo_asignaciones   WHERE obra_id = p_obra_id;
  DELETE FROM personal_asignaciones WHERE obra_id = p_obra_id;
  DELETE FROM gastos                WHERE obra_id = p_obra_id;

  -- cuentas_propias NO se borra: su FK (obra_id ON DELETE SET NULL) la
  -- desvincula sola al llegar al DELETE FROM obras — sobrevive como
  -- cuenta de empresa en vez de perderse (representa un saldo_inicial
  -- real, no un dato de ejecución del proyecto).

  DELETE FROM obras WHERE id = p_obra_id;
END;
$$;

-- ------------------------------------------------------------
-- migration_063: precio_referencia_inicial en acopios — ver comentario
-- en migration_063.sql.
-- ------------------------------------------------------------
ALTER TABLE acopios ADD COLUMN IF NOT EXISTS precio_referencia_inicial NUMERIC(15,2);

-- ============================================================
-- MIGRATION 064: plan de pago (cuotas/cheques) para gastos y cobros —
-- ver comentario completo en migration_064.sql.
-- ============================================================

CREATE TABLE IF NOT EXISTS gasto_pagos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gasto_id         UUID NOT NULL REFERENCES gastos(id) ON DELETE CASCADE,
  constructora_id  UUID NOT NULL REFERENCES constructoras(id),
  medio            TEXT NOT NULL DEFAULT 'cheque' CHECK (medio IN ('cheque', 'transferencia', 'efectivo', 'otro')),
  numero_cheque    TEXT,
  banco            TEXT,
  monto            DECIMAL(15,2) NOT NULL CHECK (monto > 0),
  fecha_emision    DATE,
  fecha_pago       DATE NOT NULL,
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

-- ------------------------------------------------------------
-- migration_065.sql — guardar_plan_pago: DELETE+INSERT atómico del plan
-- de pago (antes eran dos round-trips separados desde el cliente, con
-- riesgo de perder las cuotas viejas si el INSERT fallaba). Valida
-- además que la cuenta elegida por cuota coincida en moneda con el
-- gasto/cobro — antes solo se filtraba en el <select> del modal.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION guardar_plan_pago(
  p_entidad TEXT,   -- 'gasto' | 'cobro'
  p_id      UUID,   -- gasto_id o cobro_id
  p_cuotas  JSONB    -- array de {monto, fecha_pago, medio, numero_cheque, banco, cuenta_propia_id, notas}
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_estado_liquidado TEXT;
  v_moneda           TEXT;
  v_cuota            JSONB;
  v_cuenta_id        UUID;
  v_cuenta_moneda    TEXT;
BEGIN
  IF p_entidad = 'gasto' THEN
    v_estado_liquidado := 'Pagado';
    SELECT moneda INTO v_moneda FROM gastos WHERE id = p_id;
    IF v_moneda IS NULL THEN RAISE EXCEPTION 'Gasto no encontrado'; END IF;
    DELETE FROM gasto_pagos WHERE gasto_id = p_id AND estado <> v_estado_liquidado;
  ELSIF p_entidad = 'cobro' THEN
    v_estado_liquidado := 'Cobrado';
    SELECT moneda INTO v_moneda FROM cobros_proyecto WHERE id = p_id;
    IF v_moneda IS NULL THEN RAISE EXCEPTION 'Cobro no encontrado'; END IF;
    DELETE FROM cobro_pagos WHERE cobro_id = p_id AND estado <> v_estado_liquidado;
  ELSE
    RAISE EXCEPTION 'Entidad inválida: %', p_entidad;
  END IF;

  FOR v_cuota IN SELECT * FROM jsonb_array_elements(p_cuotas)
  LOOP
    v_cuenta_id := NULLIF(v_cuota->>'cuenta_propia_id', '')::UUID;

    IF v_cuenta_id IS NOT NULL THEN
      SELECT moneda INTO v_cuenta_moneda FROM cuentas_propias WHERE id = v_cuenta_id;
      IF v_cuenta_moneda IS DISTINCT FROM v_moneda THEN
        RAISE EXCEPTION 'La cuenta elegida es en % y el % es en % — no coinciden', v_cuenta_moneda, p_entidad, v_moneda;
      END IF;
    END IF;

    IF p_entidad = 'gasto' THEN
      INSERT INTO gasto_pagos (gasto_id, monto, fecha_pago, medio, numero_cheque, banco, cuenta_propia_id, notas)
      VALUES (
        p_id,
        (v_cuota->>'monto')::DECIMAL,
        (v_cuota->>'fecha_pago')::DATE,
        COALESCE(v_cuota->>'medio', 'cheque'),
        NULLIF(v_cuota->>'numero_cheque', ''),
        NULLIF(v_cuota->>'banco', ''),
        v_cuenta_id,
        NULLIF(v_cuota->>'notas', '')
      );
    ELSE
      INSERT INTO cobro_pagos (cobro_id, monto, fecha_pago, medio, numero_cheque, banco, cuenta_propia_id, notas)
      VALUES (
        p_id,
        (v_cuota->>'monto')::DECIMAL,
        (v_cuota->>'fecha_pago')::DATE,
        COALESCE(v_cuota->>'medio', 'cheque'),
        NULLIF(v_cuota->>'numero_cheque', ''),
        NULLIF(v_cuota->>'banco', ''),
        v_cuenta_id,
        NULLIF(v_cuota->>'notas', '')
      );
    END IF;
  END LOOP;
END;
$$;

ALTER FUNCTION guardar_plan_pago(TEXT, UUID, JSONB) SET search_path = public;

-- ------------------------------------------------------------
-- migration_066.sql — tope de sobre-recepción: la suma de cantidad_recibida
-- de un ítem, entre todas sus recepciones, no puede superar lo pedido (antes
-- solo se validaba en el frontend). El fix de percepciones en
-- confirmar_recepcion_compra() ya quedó aplicado in-place más arriba.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION validar_recepcion_no_supera_solicitado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_solicitada  NUMERIC(15,2);
  v_total_otros NUMERIC(15,2);
BEGIN
  SELECT cantidad_solicitada INTO v_solicitada FROM orden_compra_items WHERE id = NEW.orden_compra_item_id;

  SELECT COALESCE(SUM(cantidad_recibida), 0) INTO v_total_otros
  FROM orden_compra_recepcion_items
  WHERE orden_compra_item_id = NEW.orden_compra_item_id AND id <> NEW.id;

  IF v_total_otros + NEW.cantidad_recibida > v_solicitada THEN
    RAISE EXCEPTION 'La cantidad recibida (%) supera lo pendiente de este ítem (quedan % de % solicitadas)',
      NEW.cantidad_recibida, (v_solicitada - v_total_otros), v_solicitada;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_recepcion_no_supera_solicitado ON orden_compra_recepcion_items;
CREATE TRIGGER trg_validar_recepcion_no_supera_solicitado
  BEFORE INSERT OR UPDATE ON orden_compra_recepcion_items
  FOR EACH ROW EXECUTE FUNCTION validar_recepcion_no_supera_solicitado();

ALTER FUNCTION validar_recepcion_no_supera_solicitado() SET search_path = public;

-- ------------------------------------------------------------
-- migration_067.sql — tope de cobro/pago contra el monto del contrato, y
-- monotonía del avance certificado (ver comentario completo en el archivo
-- de migración).
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
