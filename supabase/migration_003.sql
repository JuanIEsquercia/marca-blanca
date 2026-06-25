-- ============================================================
-- MIGRATION 003: Módulo de Tesorería — Proveedores, Gastos, Cuentas
-- ============================================================

-- Cuentas bancarias / cajas propias del desarrollador
CREATE TABLE cuentas_propias (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre       TEXT NOT NULL,                        -- "Cta. Cte. Galicia", "Caja USD", etc.
  tipo         TEXT NOT NULL DEFAULT 'banco',        -- 'banco' | 'caja'
  moneda       TEXT NOT NULL DEFAULT 'USD',          -- 'ARS' | 'USD'
  saldo_inicial DECIMAL(15,2) NOT NULL DEFAULT 0,
  activa       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Proveedores de obra / servicios
CREATE TABLE proveedores (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  razon_social TEXT NOT NULL,
  cuit         TEXT,
  email        TEXT,
  telefono     TEXT,
  direccion    TEXT,
  notas        TEXT,
  activo       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Cuentas de cobro del proveedor (CBU, alias, efectivo, etc.)
CREATE TABLE cuentas_proveedor (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  proveedor_id   UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL DEFAULT 'CBU',    -- 'CBU' | 'Alias' | 'Efectivo' | 'Cheque' | 'Otro'
  denominacion   TEXT,                           -- "Banco Galicia cta cte", "Alias personal", etc.
  numero         TEXT,                           -- CBU, alias, o nro. de cheque
  moneda         TEXT NOT NULL DEFAULT 'ARS',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Categorías de costo configurables
CREATE TABLE categorias_costo (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre     TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Categorías por defecto
INSERT INTO categorias_costo (nombre, color) VALUES
  ('Materiales',                '#f59e0b'),
  ('Mano de obra',              '#ef4444'),
  ('Honorarios profesionales',  '#8b5cf6'),
  ('Marketing y ventas',        '#06b6d4'),
  ('Gastos administrativos',    '#64748b'),
  ('Terreno',                   '#10b981'),
  ('Impuestos y tasas',         '#f97316');

-- Gastos / egresos del desarrollo
CREATE TABLE gastos (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  proveedor_id         UUID REFERENCES proveedores(id),
  cuenta_proveedor_id  UUID REFERENCES cuentas_proveedor(id),
  categoria_id         UUID REFERENCES categorias_costo(id),
  cuenta_propia_id     UUID REFERENCES cuentas_propias(id),    -- de donde salió el pago
  descripcion          TEXT NOT NULL,
  monto                DECIMAL(15,2) NOT NULL,
  moneda               TEXT NOT NULL DEFAULT 'ARS',
  fecha_vencimiento    DATE NOT NULL,
  fecha_pago           DATE,
  estado               TEXT NOT NULL DEFAULT 'Pendiente',
  numero_comprobante   TEXT,
  comprobante_url      TEXT,
  notas                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT gastos_estado_check CHECK (estado IN ('Pendiente', 'Pagado'))
);

-- Vincular cobros de cuotas a cuentas propias
ALTER TABLE cuotas
  ADD COLUMN IF NOT EXISTS cuenta_propia_id UUID REFERENCES cuentas_propias(id);

-- Vincular entrega inicial del contrato a cuenta propia
ALTER TABLE contratos_venta
  ADD COLUMN IF NOT EXISTS cuenta_propia_id UUID REFERENCES cuentas_propias(id);

-- ============================================================
-- RLS — Todas las tablas nuevas: solo usuarios autenticados
-- ============================================================
ALTER TABLE cuentas_propias    ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas_proveedor  ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias_costo   ENABLE ROW LEVEL SECURITY;
ALTER TABLE gastos             ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_cuentas_propias"   ON cuentas_propias   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_proveedores"       ON proveedores        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_cuentas_proveedor" ON cuentas_proveedor  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_categorias_costo"  ON categorias_costo   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_gastos"            ON gastos             FOR ALL TO authenticated USING (true) WITH CHECK (true);
