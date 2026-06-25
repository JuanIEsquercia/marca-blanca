-- ============================================================
-- MIGRATION 001: Formularios ERP dinámicos
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Agregar orientacion y m2 propio por unidad
ALTER TABLE unidades
  ADD COLUMN IF NOT EXISTS orientacion TEXT,
  ADD COLUMN IF NOT EXISTS m2 DECIMAL(8,2);

-- 2. Agregar iframe 360 a tipologias
ALTER TABLE tipologias
  ADD COLUMN IF NOT EXISTS url_recorrido_360 TEXT;

-- 3. Tabla de amenities
CREATE TABLE IF NOT EXISTS amenities (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  icono       TEXT,
  orden       INTEGER NOT NULL DEFAULT 0,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabla de imágenes de amenities (carrusel)
CREATE TABLE IF NOT EXISTS amenity_imagenes (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  amenity_id  UUID REFERENCES amenities(id) ON DELETE CASCADE NOT NULL,
  url         TEXT NOT NULL,
  alt         TEXT,
  orden       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 5. RLS para amenities
ALTER TABLE amenities        ENABLE ROW LEVEL SECURITY;
ALTER TABLE amenity_imagenes ENABLE ROW LEVEL SECURITY;

-- Lectura pública de amenities activos
CREATE POLICY "amenities_lectura_publica" ON amenities
  FOR SELECT USING (activo = true);

CREATE POLICY "amenities_escritura_autenticados" ON amenities
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "amenity_imagenes_lectura_publica" ON amenity_imagenes
  FOR SELECT USING (true);

CREATE POLICY "amenity_imagenes_escritura_autenticados" ON amenity_imagenes
  FOR ALL USING (auth.role() = 'authenticated');

-- 6. Actualizar la vista pública para usar m2 por unidad si existe,
--    y exponer orientacion
DROP VIEW IF EXISTS vista_stock_publico;

CREATE OR REPLACE VIEW vista_stock_publico AS
SELECT
  u.id,
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
  -- m2 por unidad tiene prioridad sobre el de tipologia
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

-- 7. Supabase Storage bucket para imágenes (ejecutar por separado si falla aquí)
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('amenities', 'amenities', true)
-- ON CONFLICT DO NOTHING;
