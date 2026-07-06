-- ============================================================
-- MIGRATION 008: Dos tipos de proyecto + tablas para OBRA
-- ============================================================

-- 1. Tipo de proyecto en obras (desarrollo = inmobiliario, obra = construccion)
ALTER TABLE obras ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'desarrollo'
  CHECK (tipo IN ('desarrollo', 'obra'));

-- 2. obra_id opcional en cuentas_propias (para cuentas de fideicomiso/proyecto)
ALTER TABLE cuentas_propias ADD COLUMN IF NOT EXISTS obra_id UUID
  REFERENCES obras(id) ON DELETE SET NULL;

-- 3. obra_id opcional en gastos (imputar a un proyecto especifico)
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS obra_id UUID
  REFERENCES obras(id) ON DELETE SET NULL;

-- 4. Contrato de obra (un contrato por obra tipo='obra')
CREATE TABLE IF NOT EXISTS contratos_obra (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id          UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  constructora_id  UUID NOT NULL REFERENCES constructoras(id),
  cliente_nombre   TEXT NOT NULL,
  cliente_cuit     TEXT,
  cliente_email    TEXT,
  cliente_telefono TEXT,
  monto_total      NUMERIC(15,2) NOT NULL,
  moneda           TEXT NOT NULL DEFAULT 'ARS',
  fecha_inicio     DATE,
  fecha_fin_estimada DATE,
  descripcion      TEXT,
  estado           TEXT NOT NULL DEFAULT 'vigente'
                   CHECK (estado IN ('vigente', 'terminado', 'rescindido')),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Certificados de avance
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

-- 6. Cobros del cliente (para obras de construccion)
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

-- 7. RLS para nuevas tablas
ALTER TABLE contratos_obra ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contratos_obra_tenant" ON contratos_obra
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

ALTER TABLE certificados_avance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "certificados_avance_tenant" ON certificados_avance
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

ALTER TABLE cobros_proyecto ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cobros_proyecto_tenant" ON cobros_proyecto
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));
