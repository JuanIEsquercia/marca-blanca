-- ============================================================
-- MIGRATION 046: catálogo de rubros por constructora, para
-- estandarizar los nombres que se cargan en presupuesto_items y
-- contrato_obra_items (hoy texto libre — "Losa" y "losa" quedan
-- como dos cosas distintas, lo que rompe cualquier reporte agrupado
-- por rubro más adelante).
--
-- Diseño (decidido en conversación con el usuario):
-- - `nombre` es lo que se ve (respeta may/min tal como lo tipeó quien
--   creó el rubro por primera vez) — nunca se fuerza a mayúsculas ni
--   minúsculas, eso empeoraría los PDF/contratos.
-- - `nombre_normalizado` es solo la clave de comparación: sin espacios
--   de más, todo minúscula, sin tildes (vía unaccent). Nunca se
--   muestra. Único por constructora.
-- - obtener_o_crear_rubro() es lo que llaman los managers de
--   presupuestos/certificados antes de insertar un ítem: si ya existe
--   un rubro con esa clave normalizada, devuelve su nombre canónico
--   (así todos los ítems terminan con la misma grafía); si no, lo crea.
-- - A propósito NO hay columna categoria_item_id en presupuesto_items/
--   contrato_obra_items todavía (fase 2, si el catálogo resulta útil en
--   la práctica) — por ahora es solo estandarización de texto +
--   autocomplete, sin migrar el modelo de datos existente.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE IF NOT EXISTS rubros (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id     UUID NOT NULL REFERENCES constructoras(id),
  nombre              TEXT NOT NULL,
  nombre_normalizado  TEXT NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (constructora_id, nombre_normalizado)
);

CREATE INDEX IF NOT EXISTS idx_rubros_constructora ON rubros(constructora_id);

ALTER TABLE rubros ENABLE ROW LEVEL SECURITY;

-- Mismo criterio que categorias_costo: una sola policy FOR ALL, gateada
-- por tener el módulo relevante en algún lado — acá "relevante" son los
-- dos flujos que cargan rubros (presupuestos y certificados).
DROP POLICY IF EXISTS "rubros_tenant" ON rubros;
CREATE POLICY "rubros_tenant" ON rubros
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras())
    AND (tiene_permiso('presupuestos') OR tiene_permiso_en_algun_proyecto('certificados'))
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras())
    AND (tiene_permiso('presupuestos') OR tiene_permiso_en_algun_proyecto('certificados'))
  );

-- SECURITY INVOKER (default) a propósito: corre con los permisos y la
-- RLS del que llama, igual que asignar_equipo/asignar_personal después
-- del fix de la auditoría de tenant — no hace falta bypassear nada acá.
CREATE OR REPLACE FUNCTION obtener_o_crear_rubro(p_constructora_id UUID, p_nombre TEXT)
RETURNS TABLE(id UUID, nombre TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_nombre_limpio       TEXT;
  v_nombre_normalizado  TEXT;
BEGIN
  v_nombre_limpio := btrim(regexp_replace(p_nombre, '\s+', ' ', 'g'));
  IF v_nombre_limpio = '' THEN
    RAISE EXCEPTION 'El nombre del rubro no puede estar vacío';
  END IF;
  v_nombre_normalizado := lower(unaccent(v_nombre_limpio));

  RETURN QUERY
  INSERT INTO rubros (constructora_id, nombre, nombre_normalizado)
  VALUES (p_constructora_id, v_nombre_limpio, v_nombre_normalizado)
  ON CONFLICT (constructora_id, nombre_normalizado)
  -- DO UPDATE (no-op) en vez de DO NOTHING: es la única forma de que
  -- RETURNING traiga la fila existente cuando ya había un rubro con esa
  -- clave — con DO NOTHING, RETURNING no devuelve nada en ese caso.
  DO UPDATE SET nombre = rubros.nombre
  RETURNING rubros.id, rubros.nombre;
END;
$$;

-- rubros.constructora_id es NOT NULL sin ON DELETE CASCADE (a propósito,
-- mismo criterio que el resto de las tablas tenant-scoped) — hay que
-- sumarla a la purga completa o bloquea el DELETE FROM constructoras.
CREATE OR REPLACE FUNCTION purgar_constructora_completa(p_constructora_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM cobros_proyecto   WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_obra    WHERE constructora_id = p_constructora_id;
  DELETE FROM presupuestos      WHERE constructora_id = p_constructora_id;
  DELETE FROM equipos           WHERE constructora_id = p_constructora_id;
  DELETE FROM personal          WHERE constructora_id = p_constructora_id;
  DELETE FROM cuadrillas        WHERE constructora_id = p_constructora_id;
  DELETE FROM rubros            WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_venta   WHERE constructora_id = p_constructora_id;
  DELETE FROM reservas          WHERE constructora_id = p_constructora_id;
  DELETE FROM gastos            WHERE constructora_id = p_constructora_id;
  DELETE FROM compradores       WHERE constructora_id = p_constructora_id;
  DELETE FROM unidades          WHERE constructora_id = p_constructora_id;
  DELETE FROM proveedores       WHERE constructora_id = p_constructora_id;
  DELETE FROM categorias_costo  WHERE constructora_id = p_constructora_id;
  DELETE FROM cuentas_propias   WHERE constructora_id = p_constructora_id;
  DELETE FROM tipologias        WHERE constructora_id = p_constructora_id;
  DELETE FROM amenities         WHERE constructora_id = p_constructora_id;
  DELETE FROM auditoria         WHERE constructora_id = p_constructora_id;
  DELETE FROM constructoras     WHERE id = p_constructora_id;
END;
$$;
