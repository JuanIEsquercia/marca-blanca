-- ============================================================
-- MIGRATION 004: Reservas formales + Leads/CRM + Mejoras operativas
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Tabla de reservas formales
--    Reemplaza el simple cambio de estado: ahora captura comprador,
--    seña y fecha límite de conversión a venta.
CREATE TABLE IF NOT EXISTS reservas (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  unidad_id         UUID REFERENCES unidades(id) NOT NULL,
  comprador_id      UUID REFERENCES compradores(id) NOT NULL,
  fecha_reserva     DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE NOT NULL,
  monto_sena        DECIMAL(15,2),
  cuenta_propia_id  UUID REFERENCES cuentas_propias(id),
  notas             TEXT,
  estado            TEXT NOT NULL DEFAULT 'Vigente'
    CONSTRAINT reservas_estado_check
      CHECK (estado IN ('Vigente', 'Convertida', 'Caída')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla de leads / CRM
--    Recibe contactos del formulario de landing y los gestiona
--    hasta convertirlos en reserva o venta.
CREATE TABLE IF NOT EXISTS leads (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre              TEXT NOT NULL,
  email               TEXT,
  telefono            TEXT,
  tipologia_interes   TEXT,
  mensaje             TEXT,
  origen              TEXT NOT NULL DEFAULT 'manual',  -- 'landing' | 'manual' | 'referido'
  estado              TEXT NOT NULL DEFAULT 'Nuevo'
    CONSTRAINT leads_estado_check
      CHECK (estado IN ('Nuevo', 'Contactado', 'Interesado', 'Reservado', 'Vendido', 'Descartado')),
  notas_seguimiento   TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Monto cobrado efectivo por cuota (soporte pagos parciales / ajustados)
ALTER TABLE cuotas
  ADD COLUMN IF NOT EXISTS monto_cobrado DECIMAL(15,2);

-- 4. RLS
ALTER TABLE reservas ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_reservas" ON reservas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_leads" ON leads
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. Índices de performance
CREATE INDEX IF NOT EXISTS idx_cuotas_pendientes_vencimiento
  ON cuotas(fecha_vencimiento)
  WHERE estado_pago = 'Pendiente';

CREATE INDEX IF NOT EXISTS idx_reservas_unidad_estado
  ON reservas(unidad_id, estado);

CREATE INDEX IF NOT EXISTS idx_leads_estado_fecha
  ON leads(estado, created_at DESC);
