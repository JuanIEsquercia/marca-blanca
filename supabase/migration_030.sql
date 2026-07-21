-- ============================================================
-- MIGRATION 030: agregar conteo de unidades por proyecto en SQL
--
-- app/admin/page.tsx (home) traía TODAS las filas de `unidades` de los
-- proyectos tipo desarrollo (sin límite) y contaba vendidas/reservadas/
-- disponibles con un .reduce() en JS — mismo patrón de riesgo ya
-- documentado para tesoreria/gastos (límite default de PostgREST ~1000
-- filas, subestima silenciosamente con historial largo). Esta función
-- agrega en Postgres y solo devuelve un conteo por obra, no las filas.
--
-- SECURITY INVOKER (default, no se marca DEFINER): corre con los
-- privilegios del caller, así que la policy RLS de `unidades`
-- (tiene_permiso_proyecto) sigue aplicando igual que si se hiciera un
-- SELECT normal desde el cliente.
--
-- Idempotente.
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
