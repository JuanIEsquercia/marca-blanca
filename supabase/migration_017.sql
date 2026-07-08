-- ============================================================
-- MIGRATION 017: Depuración de relaciones + cierre de gap de permisos
-- Ejecutar DESPUÉS de migration_016.sql.
-- 1) Sincroniza `miembros` (quedaba huérfana para usuarios nuevos desde
--    que migration_016 dejó de auto-asignar constructora en el trigger).
-- 2) Unifica el "cliente" de OBRA (hoy 4 columnas de texto libre en
--    contratos_obra) con la tabla `compradores` ya usada por DESARROLLO —
--    misma entidad de negocio, evita duplicación y habilita ver el
--    historial de un cliente entre ambos flujos.
-- 3) `compradores` nunca tuvo gating por módulo (a diferencia de las 12
--    tablas cubiertas en migration_015/016) — un operador sin ningún
--    permiso podía leer/escribir clientes directo. Se cierra el gap.
-- 4) Elimina `leads` y `vista_stock_publico` — remanentes de la landing
--    pública eliminada, sin ninguna referencia en el código actual.
-- Idempotente — seguro de ejecutar múltiples veces.
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================


-- ============================================================
-- PASO 1: Sincronizar miembros con el estado real de perfiles
-- (mismo patrón que migration_010.sql PASO 6d)
-- ============================================================

INSERT INTO miembros (constructora_id, user_id, rol)
SELECT
  p.constructora_id,
  p.id,
  CASE WHEN p.rol = 'admin' THEN 'admin' ELSE 'miembro' END
FROM perfiles p
LEFT JOIN miembros m
  ON m.user_id = p.id AND m.constructora_id = p.constructora_id
WHERE p.constructora_id IS NOT NULL
  AND m.user_id IS NULL
ON CONFLICT DO NOTHING;


-- ============================================================
-- PASO 2: Unificar cliente de OBRA en `compradores`
-- ============================================================

-- dni_cuit pasa a ser opcional — un cliente de obra puede no tener
-- CUIT cargado todavía. UNIQUE sigue funcionando (Postgres permite
-- múltiples NULL bajo una constraint UNIQUE).
ALTER TABLE compradores ALTER COLUMN dni_cuit DROP NOT NULL;

ALTER TABLE contratos_obra ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES compradores(id);

-- Backfill: para cada contrato de obra existente, reutilizar un
-- comprador ya cargado con el mismo (constructora_id, cuit) o crear uno.
DO $$
DECLARE
  r RECORD;
  v_cliente_id UUID;
BEGIN
  FOR r IN
    SELECT id, constructora_id, cliente_nombre, cliente_cuit, cliente_email, cliente_telefono
    FROM contratos_obra
    WHERE cliente_id IS NULL
  LOOP
    v_cliente_id := NULL;

    IF r.cliente_cuit IS NOT NULL THEN
      SELECT id INTO v_cliente_id
      FROM compradores
      WHERE constructora_id = r.constructora_id AND dni_cuit = r.cliente_cuit;
    END IF;

    IF v_cliente_id IS NULL THEN
      INSERT INTO compradores (constructora_id, nombre_completo, dni_cuit, email, telefono)
      VALUES (r.constructora_id, r.cliente_nombre, r.cliente_cuit, r.cliente_email, r.cliente_telefono)
      RETURNING id INTO v_cliente_id;
    END IF;

    UPDATE contratos_obra SET cliente_id = v_cliente_id WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE contratos_obra ALTER COLUMN cliente_id SET NOT NULL;

ALTER TABLE contratos_obra
  DROP COLUMN IF EXISTS cliente_nombre,
  DROP COLUMN IF EXISTS cliente_cuit,
  DROP COLUMN IF EXISTS cliente_email,
  DROP COLUMN IF EXISTS cliente_telefono;

CREATE INDEX IF NOT EXISTS idx_contratos_obra_cliente ON contratos_obra(cliente_id);


-- ============================================================
-- PASO 3: Cerrar el gap de permisos en `compradores`
-- Se accede desde 3 módulos distintos (reservas, ventas, certificados
-- de obra) — alcanza con tener cualquiera de los tres habilitado.
-- ============================================================

DROP POLICY IF EXISTS "compradores_tenant" ON compradores;
CREATE POLICY "compradores_tenant" ON compradores
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras())
    AND (tiene_permiso('reservas') OR tiene_permiso('contratos') OR tiene_permiso('certificados'))
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras())
    AND (tiene_permiso('reservas') OR tiene_permiso('contratos') OR tiene_permiso('certificados'))
  );


-- ============================================================
-- PASO 4: Eliminar objetos muertos (remanentes de la landing pública
-- eliminada — sin referencias en el código actual)
-- ============================================================

DROP TABLE IF EXISTS leads CASCADE;
DROP VIEW IF EXISTS vista_stock_publico;


-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- SELECT constructora_id, user_id, rol FROM miembros ORDER BY constructora_id;
-- SELECT p.id FROM perfiles p LEFT JOIN miembros m ON m.user_id = p.id WHERE p.constructora_id IS NOT NULL AND m.user_id IS NULL;  -- debe devolver 0 filas
-- SELECT id, cliente_id FROM contratos_obra WHERE cliente_id IS NULL;  -- debe devolver 0 filas
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'contratos_obra' AND column_name LIKE 'cliente_%';  -- solo cliente_id
-- Como operador con permisos = '{}' (ningún módulo): SELECT * FROM compradores debe devolver 0 filas.
-- SELECT * FROM leads;  -- debe fallar: relation "leads" does not exist
