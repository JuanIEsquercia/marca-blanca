-- ============================================================
-- SCHEMA COMPLETO - Sistema ERP Inmobiliario
-- ============================================================

-- Habilitar extensión para UUIDs
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
-- TABLA: perfiles (extiende auth.users de Supabase)
-- ============================================================
CREATE TABLE IF NOT EXISTS perfiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  nombre      TEXT NOT NULL,
  rol         rol_usuario NOT NULL DEFAULT 'operador',
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLA: tipologias
-- ============================================================
CREATE TABLE IF NOT EXISTS tipologias (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre      TEXT NOT NULL,
  m2_propios  DECIMAL(10,2) NOT NULL,
  m2_comunes  DECIMAL(10,2) NOT NULL DEFAULT 0,
  m2_totales  DECIMAL(10,2) GENERATED ALWAYS AS (m2_propios + m2_comunes) STORED,
  descripcion TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLA: unidades
-- ============================================================
CREATE TABLE IF NOT EXISTS unidades (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  piso                INTEGER NOT NULL,
  numero              TEXT NOT NULL,
  letra               TEXT,
  tipologia_id        UUID REFERENCES tipologias(id) NOT NULL,
  precio_lista        DECIMAL(15,2) NOT NULL,
  entrega_minima_pct  DECIMAL(5,2) NOT NULL DEFAULT 30,
  max_cuotas          INTEGER NOT NULL DEFAULT 36,
  estado_comercial    estado_comercial NOT NULL DEFAULT 'Disponible',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(piso, numero, letra)
);

-- Trigger para actualizar updated_at automáticamente
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

-- ============================================================
-- TABLA: compradores
-- ============================================================
CREATE TABLE IF NOT EXISTS compradores (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre_completo  TEXT NOT NULL,
  dni_cuit         TEXT NOT NULL UNIQUE,
  email            TEXT,
  telefono         TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLA: contratos_venta
-- ============================================================
CREATE TABLE IF NOT EXISTS contratos_venta (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  unidad_id        UUID REFERENCES unidades(id) UNIQUE NOT NULL,
  comprador_id     UUID REFERENCES compradores(id) NOT NULL,
  precio_final     DECIMAL(15,2) NOT NULL,
  entrega_efectiva DECIMAL(15,2) NOT NULL,
  cantidad_cuotas  INTEGER NOT NULL,
  fecha_firma      DATE NOT NULL DEFAULT CURRENT_DATE,
  notas            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLA: cuotas
-- ============================================================
CREATE TABLE IF NOT EXISTS cuotas (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contrato_id       UUID REFERENCES contratos_venta(id) ON DELETE CASCADE NOT NULL,
  numero_cuota      INTEGER NOT NULL,
  monto_base        DECIMAL(15,2) NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  estado_pago       estado_pago NOT NULL DEFAULT 'Pendiente',
  fecha_pago        TIMESTAMPTZ,
  notas_pago        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contrato_id, numero_cuota)
);

-- ============================================================
-- FUNCIÓN: generar cuotas al crear un contrato
-- ============================================================
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
    INSERT INTO cuotas (contrato_id, numero_cuota, monto_base, fecha_vencimiento)
    VALUES (NEW.id, i, monto_cuota, fecha_venc);
  END LOOP;

  -- Ajuste de diferencia de centavos en última cuota
  UPDATE cuotas
  SET monto_base = monto_base + (saldo_restante - (monto_cuota * NEW.cantidad_cuotas))
  WHERE contrato_id = NEW.id AND numero_cuota = NEW.cantidad_cuotas;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS generar_cuotas_on_contrato ON contratos_venta;
CREATE TRIGGER generar_cuotas_on_contrato
  AFTER INSERT ON contratos_venta
  FOR EACH ROW EXECUTE FUNCTION generar_cuotas_contrato();

-- ============================================================
-- FUNCIÓN: marcar cuotas vencidas automáticamente
-- ============================================================
CREATE OR REPLACE FUNCTION marcar_cuotas_vencidas()
RETURNS void AS $$
BEGIN
  UPDATE cuotas
  SET estado_pago = 'Vencido'
  WHERE estado_pago = 'Pendiente'
    AND fecha_vencimiento < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- DATOS INICIALES DE EJEMPLO
-- ============================================================
INSERT INTO tipologias (nombre, m2_propios, m2_comunes, descripcion) VALUES
  ('Monoambiente',  32.00, 8.50, 'Ambiente integrado con kitchenette'),
  ('2 Ambientes',   48.00, 12.00, 'Living-comedor + 1 dormitorio'),
  ('3 Ambientes',   65.00, 15.00, 'Living-comedor + 2 dormitorios'),
  ('4 Ambientes',   85.00, 18.00, 'Living-comedor + 3 dormitorios')
ON CONFLICT DO NOTHING;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE perfiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipologias       ENABLE ROW LEVEL SECURITY;
ALTER TABLE unidades         ENABLE ROW LEVEL SECURITY;
ALTER TABLE compradores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratos_venta  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuotas           ENABLE ROW LEVEL SECURITY;

-- ---- PERFILES ----
-- Solo el propio usuario ve su perfil; admin ve todos
CREATE POLICY "perfil_propio" ON perfiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "admin_ve_todos_perfiles" ON perfiles
  FOR ALL USING (
    EXISTS (SELECT 1 FROM perfiles WHERE id = auth.uid() AND rol = 'admin')
  );

-- ---- TIPOLOGIAS: lectura pública ----
CREATE POLICY "tipologias_lectura_publica" ON tipologias
  FOR SELECT USING (true);

CREATE POLICY "tipologias_escritura_autenticados" ON tipologias
  FOR ALL USING (auth.role() = 'authenticated');

-- ---- UNIDADES: lectura pública solo Disponible/Reservado ----
CREATE POLICY "unidades_lectura_publica" ON unidades
  FOR SELECT USING (estado_comercial IN ('Disponible', 'Reservado'));

CREATE POLICY "unidades_todo_autenticados" ON unidades
  FOR ALL USING (auth.role() = 'authenticated');

-- ---- COMPRADORES: solo usuarios autenticados ----
CREATE POLICY "compradores_solo_autenticados" ON compradores
  FOR ALL USING (auth.role() = 'authenticated');

-- ---- CONTRATOS: solo usuarios autenticados ----
CREATE POLICY "contratos_solo_autenticados" ON contratos_venta
  FOR ALL USING (auth.role() = 'authenticated');

-- ---- CUOTAS: solo usuarios autenticados ----
CREATE POLICY "cuotas_solo_autenticados" ON cuotas
  FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- VISTA PÚBLICA: stock para landing (sin datos sensibles)
-- ============================================================
CREATE OR REPLACE VIEW vista_stock_publico AS
SELECT
  u.id,
  u.piso,
  u.numero,
  u.letra,
  u.precio_lista,
  u.entrega_minima_pct,
  u.max_cuotas,
  u.estado_comercial,
  t.nombre        AS tipologia_nombre,
  t.m2_propios,
  t.m2_comunes,
  t.m2_totales,
  t.descripcion   AS tipologia_descripcion,
  ROUND(u.precio_lista / NULLIF(t.m2_totales, 0), 2) AS precio_por_m2,
  ROUND(u.precio_lista * u.entrega_minima_pct / 100, 2) AS monto_entrega_minima
FROM unidades u
JOIN tipologias t ON t.id = u.tipologia_id
WHERE u.estado_comercial IN ('Disponible', 'Reservado');
