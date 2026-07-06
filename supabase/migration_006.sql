-- migration_006: corregir SECURITY DEFINER en vista_stock_publico
-- Recrear como SECURITY INVOKER + políticas RLS para acceso anónimo

DROP VIEW IF EXISTS vista_stock_publico;

CREATE OR REPLACE VIEW vista_stock_publico
WITH (security_invoker = true)
AS
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

-- Grant SELECT al rol anon para que la landing page funcione sin autenticación
GRANT SELECT ON vista_stock_publico TO anon;

-- Políticas RLS para que anon pueda leer los datos subyacentes
-- (necesarias para que SECURITY INVOKER funcione con RLS activado)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'unidades'
      AND policyname = 'anon puede ver unidades publicas'
  ) THEN
    CREATE POLICY "anon puede ver unidades publicas"
    ON unidades FOR SELECT TO anon
    USING (estado_comercial IN ('Disponible', 'Reservado'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tipologias'
      AND policyname = 'anon puede ver tipologias'
  ) THEN
    CREATE POLICY "anon puede ver tipologias"
    ON tipologias FOR SELECT TO anon
    USING (true);
  END IF;
END;
$$;
