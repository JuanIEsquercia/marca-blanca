-- ------------------------------------------------------------
-- migration_076.sql — Buscador global del panel: una sola RPC para todos
-- los tipos de dato.
--
-- Por qué una función y no N consultas desde el cliente: el buscador se
-- dispara mientras el usuario tipea. Con una consulta por tabla serían 5
-- round-trips por búsqueda; acá es uno solo, y cada rama trae como mucho 5
-- filas (tope duro de 25 resultados por búsqueda, sin importar el tamaño
-- del tenant).
--
-- SECURITY INVOKER (default, sin declarar): corre con la RLS de quien
-- llama, así que el buscador solo encuentra lo que esa persona ya podía
-- ver desde el panel. Un operador sin el módulo Proveedores no obtiene
-- proveedores, uno sin acceso a un proyecto no obtiene sus unidades — sin
-- una sola línea de lógica de permisos acá adentro. Es la misma razón por
-- la que las tools del chat usan el cliente de sesión y no el service role.
--
-- Búsqueda insensible a mayúsculas Y a tildes (unaccent, ya instalado para
-- normalizar rubros/productos): en este rubro se escribe "Hormigon" tanto
-- como "Hormigón", y "Perez" tanto como "Pérez".
--
-- Las RUTAS no se arman acá a propósito: la función devuelve `tipo` +
-- `obra_id` y el destino lo resuelve lib/buscador.ts. Las rutas son de la
-- app, no de la base — si mañana cambia una URL no hay que tocar SQL.
--
-- Deliberadamente NO se buscan gastos ni cobros: son las tablas que más
-- crecen, no tienen pantalla de detalle propia a la que llevar, y sus
-- módulos ya tienen filtros mejores que un buscador global.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION buscar_global(p_termino TEXT)
RETURNS TABLE(
  tipo      TEXT,
  id        UUID,
  titulo    TEXT,
  subtitulo TEXT,
  obra_id   UUID
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH t AS (
    SELECT '%' || unaccent(lower(btrim(p_termino))) || '%' AS q
  )
  (
    SELECT 'proyecto'::TEXT, o.id, o.nombre,
           CASE WHEN o.tipo = 'desarrollo' THEN 'Desarrollo' ELSE 'Obra' END::TEXT,
           o.id
    FROM obras o, t
    WHERE unaccent(lower(o.nombre)) LIKE t.q
    ORDER BY o.nombre
    LIMIT 5
  )
  UNION ALL
  (
    SELECT 'proveedor'::TEXT, p.id, p.razon_social,
           COALESCE(NULLIF(p.cuit, ''), 'Proveedor')::TEXT,
           NULL::UUID
    FROM proveedores p, t
    WHERE unaccent(lower(p.razon_social)) LIKE t.q
       OR unaccent(lower(COALESCE(p.cuit, ''))) LIKE t.q
    ORDER BY p.razon_social
    LIMIT 5
  )
  UNION ALL
  (
    SELECT 'cliente'::TEXT, c.id, c.nombre_completo,
           COALESCE(NULLIF(c.dni_cuit, ''), 'Cliente')::TEXT,
           NULL::UUID
    FROM compradores c, t
    WHERE unaccent(lower(c.nombre_completo)) LIKE t.q
       OR unaccent(lower(COALESCE(c.dni_cuit, ''))) LIKE t.q
    ORDER BY c.nombre_completo
    LIMIT 5
  )
  UNION ALL
  (
    SELECT 'unidad'::TEXT, u.id,
           ('Piso ' || u.piso || COALESCE(' - ' || u.numero, '') || COALESCE(u.letra, ''))::TEXT,
           (o.nombre || ' · ' || u.estado_comercial)::TEXT,
           u.obra_id
    FROM unidades u
    JOIN obras o ON o.id = u.obra_id, t
    WHERE unaccent(lower(COALESCE(u.numero, ''))) LIKE t.q
       OR unaccent(lower(COALESCE(u.letra, ''))) LIKE t.q
       OR unaccent(lower('piso ' || u.piso)) LIKE t.q
    ORDER BY u.piso, u.numero
    LIMIT 5
  )
  UNION ALL
  (
    SELECT 'presupuesto'::TEXT, pr.id, pr.cliente_nombre,
           ('Presupuesto · ' || pr.estado)::TEXT,
           pr.obra_id
    FROM presupuestos pr, t
    WHERE unaccent(lower(pr.cliente_nombre)) LIKE t.q
       OR unaccent(lower(COALESCE(pr.cliente_cuit, ''))) LIKE t.q
    ORDER BY pr.created_at DESC
    LIMIT 5
  );
$$;

-- anon no tiene sesión, así que la RLS no le daría nada igual; se revoca
-- para dejarlo explícito.
REVOKE EXECUTE ON FUNCTION buscar_global(TEXT) FROM anon;
