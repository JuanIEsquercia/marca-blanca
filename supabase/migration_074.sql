-- ------------------------------------------------------------
-- migration_074.sql — Control de obra pasa a tener su PROPIO módulo de
-- permiso, en vez de exigir dos ('certificados' + 'gastos').
--
-- Por qué cambia, dos días después de migration_073: exigir los dos
-- módulos era un parche, no un permiso. Traía tres problemas:
--
--   1. No se podía dar acceso al análisis SIN dar acceso a editar gastos
--      y contratos. Un dueño o un jefe de obra que solo tiene que MIRAR
--      cómo viene la obra terminaba con permisos de escritura que no
--      necesita — al revés de lo que un ERP debería permitir.
--   2. La función era SECURITY INVOKER, así que con un módulo solo la RLS
--      devolvía la mitad de los datos EN SILENCIO: el margen salía
--      falso, no incompleto. Se tapaba exigiendo ambos módulos en la
--      página y en el chat, o sea que la corrección vivía en la app y no
--      en la base.
--   3. Obligó a inventar un `permisoExtra` en el sidebar, un concepto que
--      no existía en ningún otro lado del sistema.
--
-- Ahora la función es SECURITY DEFINER con los chequeos adentro: o
-- devuelve el análisis COMPLETO, o falla con un mensaje claro. Nunca a
-- medias. Como DEFINER saltea la RLS de las tablas que lee, el chequeo de
-- tenant de acá adentro es la única barrera real entre constructoras —
-- por eso va primero y es explícito.
--
-- El módulo 'control' se declara en lib/permisos.ts (soloTipo: 'obra').
-- Los operadores que ya existían NO lo tienen: un admin se lo tiene que
-- tildar en Usuarios. Los admin lo ven de entrada (es_admin() en
-- tiene_permiso_proyecto).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION resumen_rubros_obra(p_obra_id UUID)
RETURNS TABLE(
  rubro               TEXT,
  moneda_contrato     TEXT,
  monto_contratado    NUMERIC,
  monto_certificado   NUMERIC,
  pct_certificado     NUMERIC,
  costo_ars           NUMERIC,
  costo_usd           NUMERIC,
  costo_pendiente_ars NUMERIC,
  costo_pendiente_usd NUMERIC,
  cantidad_gastos     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- SECURITY DEFINER = la RLS de contratos_obra/gastos/etc. NO aplica acá
  -- adentro. Este chequeo es lo único que impide leer la obra de otra
  -- constructora pasando su UUID.
  IF NOT EXISTS (
    SELECT 1 FROM obras
    WHERE id = p_obra_id AND constructora_id IN (SELECT mis_constructoras())
  ) THEN
    RAISE EXCEPTION 'Proyecto no encontrado';
  END IF;

  -- tiene_permiso_proyecto ya contempla es_admin().
  IF NOT tiene_permiso_proyecto(p_obra_id, 'control') THEN
    RAISE EXCEPTION 'No tenés el módulo Control de obra habilitado en este proyecto';
  END IF;

  RETURN QUERY
  WITH contrato_cliente AS (
    SELECT c.id, c.moneda
    FROM contratos_obra c
    WHERE c.obra_id = p_obra_id AND c.tipo = 'cliente'
  ),
  avance_por_item AS (
    SELECT ci2.contrato_obra_item_id, MAX(ci2.pct_avance_acumulado) AS pct_max
    FROM certificado_items ci2
    GROUP BY ci2.contrato_obra_item_id
  ),
  presupuesto AS (
    SELECT
      ci.rubro                                                    AS rubro,
      MIN(cc.moneda)                                              AS moneda,
      SUM(ci.monto_contratado)                                    AS contratado,
      SUM(COALESCE(a.pct_max, 0) / 100.0 * ci.monto_contratado)   AS certificado
    FROM contrato_obra_items ci
    JOIN contrato_cliente cc    ON cc.id = ci.contrato_obra_id
    LEFT JOIN avance_por_item a ON a.contrato_obra_item_id = ci.id
    GROUP BY ci.rubro
  ),
  costos AS (
    SELECT
      r.nombre                                                                             AS rubro,
      SUM(CASE WHEN g.moneda = 'ARS' THEN g.monto ELSE 0 END)                               AS costo_ars,
      SUM(CASE WHEN g.moneda = 'USD' THEN g.monto ELSE 0 END)                               AS costo_usd,
      SUM(CASE WHEN g.moneda = 'ARS' AND g.estado = 'Pendiente' THEN g.monto ELSE 0 END)     AS pend_ars,
      SUM(CASE WHEN g.moneda = 'USD' AND g.estado = 'Pendiente' THEN g.monto ELSE 0 END)     AS pend_usd,
      COUNT(*)::INTEGER                                                                     AS cantidad
    FROM gastos g
    LEFT JOIN rubros r ON r.id = g.rubro_id
    WHERE g.obra_id = p_obra_id
    GROUP BY r.nombre
  )
  SELECT
    COALESCE(p.rubro, c.rubro),
    p.moneda,
    COALESCE(p.contratado, 0),
    ROUND(COALESCE(p.certificado, 0), 2),
    CASE
      WHEN COALESCE(p.contratado, 0) > 0
        THEN ROUND(COALESCE(p.certificado, 0) / p.contratado * 100, 2)
      ELSE 0
    END,
    COALESCE(c.costo_ars, 0),
    COALESCE(c.costo_usd, 0),
    COALESCE(c.pend_ars, 0),
    COALESCE(c.pend_usd, 0),
    COALESCE(c.cantidad, 0)
  FROM presupuesto p
  FULL OUTER JOIN costos c ON c.rubro = p.rubro
  ORDER BY (COALESCE(p.rubro, c.rubro) IS NULL), COALESCE(p.contratado, 0) DESC, 1;
END;
$$;

-- La función se autoriza sola por dentro; anon no tiene sesión, así que no
-- tiene nada que hacer acá.
REVOKE EXECUTE ON FUNCTION resumen_rubros_obra(UUID) FROM anon;
