-- ------------------------------------------------------------
-- migration_071.sql — resumen_gastos_por_categoria(): agregado en
-- Postgres (mismo criterio que resumen_unidades_por_obra/resumen_stock,
-- ver migration_030/052) en vez de traer todos los gastos al cliente para
-- sumarlos ahí — evita el límite default de PostgREST de ~1000 filas en
-- tenants con historial largo. Pensado para el chat (lib/chat/) que pidió
-- "resumir los gastos", pero sirve para cualquier reporte futuro que
-- necesite gastos agrupados por categoría.
--
-- SECURITY INVOKER (default, sin declarar): corre con la RLS del caller,
-- así que tiene_permiso_proyecto(obra_id, 'gastos')/es_admin() de la
-- policy de `gastos` ya protege esto solo, sin lógica de permisos nueva.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION resumen_gastos_por_categoria(
  p_constructora_id UUID,
  p_obra_id UUID DEFAULT NULL,
  p_desde DATE DEFAULT NULL,
  p_hasta DATE DEFAULT NULL,
  p_solo_pendientes BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(categoria_id UUID, categoria_nombre TEXT, moneda TEXT, monto_total NUMERIC, cantidad INTEGER)
LANGUAGE sql
STABLE
AS $$
  SELECT
    g.categoria_id,
    COALESCE(cc.nombre, 'Sin categoría') AS categoria_nombre,
    g.moneda,
    SUM(g.monto) AS monto_total,
    COUNT(*)::INTEGER AS cantidad
  FROM gastos g
  LEFT JOIN categorias_costo cc ON cc.id = g.categoria_id
  WHERE g.constructora_id = p_constructora_id
    AND (p_obra_id IS NULL OR g.obra_id = p_obra_id)
    AND (p_desde IS NULL OR g.fecha_vencimiento >= p_desde)
    AND (p_hasta IS NULL OR g.fecha_vencimiento <= p_hasta)
    AND (NOT p_solo_pendientes OR g.estado = 'Pendiente')
  GROUP BY g.categoria_id, cc.nombre, g.moneda
  ORDER BY monto_total DESC;
$$;

ALTER FUNCTION resumen_gastos_por_categoria(UUID, UUID, DATE, DATE, BOOLEAN) SET search_path = public;
