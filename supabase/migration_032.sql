-- ============================================================
-- MIGRATION 032: Inventario de maquinaria/equipos — asignación
-- vigente + historial completo, mismo patrón que reservas/contratos
-- (una fila "abierta" por equipo a la vez, cerrarla es la única forma
-- de reasignar, así el historial completo queda escrito solo).
--
-- Módulo de Empresa (como Proveedores/Presupuestos): el registro de
-- equipos es transversal a todos los proyectos — alguien decidiendo
-- a qué obra mandar un martillo necesita ver el estado de TODOS los
-- equipos, no solo los de un proyecto. Se gatea con tiene_permiso(),
-- no tiene_permiso_proyecto().
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS equipos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id UUID NOT NULL REFERENCES constructoras(id),
  nombre          TEXT NOT NULL,
  tipo            TEXT,
  marca           TEXT,
  modelo          TEXT,
  nro_serie       TEXT,
  estado          TEXT NOT NULL DEFAULT 'disponible'
    CHECK (estado IN ('disponible', 'asignado', 'mantenimiento', 'baja')),
  notas           TEXT,
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  updated_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS equipo_asignaciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipo_id       UUID NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
  obra_id         UUID NOT NULL REFERENCES obras(id),
  constructora_id UUID NOT NULL REFERENCES constructoras(id),
  fecha_desde     DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_hasta     DATE,  -- NULL = asignación vigente
  asignado_por    UUID REFERENCES auth.users(id),
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Un equipo no puede estar "vigente" en dos proyectos a la vez — mismo
-- mecanismo que idx_reservas_unica_vigente (migration_028).
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipo_asignaciones_unica_vigente
  ON equipo_asignaciones(equipo_id) WHERE fecha_hasta IS NULL;

CREATE INDEX IF NOT EXISTS idx_equipos_constructora              ON equipos(constructora_id);
CREATE INDEX IF NOT EXISTS idx_equipo_asignaciones_equipo        ON equipo_asignaciones(equipo_id);
CREATE INDEX IF NOT EXISTS idx_equipo_asignaciones_obra          ON equipo_asignaciones(obra_id);
CREATE INDEX IF NOT EXISTS idx_equipo_asignaciones_constructora  ON equipo_asignaciones(constructora_id);

DROP TRIGGER IF EXISTS trg_auditoria_campos ON equipos;
CREATE TRIGGER trg_auditoria_campos
  BEFORE INSERT OR UPDATE ON equipos
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_campos();

DROP TRIGGER IF EXISTS trg_registrar_auditoria ON equipos;
CREATE TRIGGER trg_registrar_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON equipos
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

-- ------------------------------------------------------------
-- Asignar/reasignar: cierra la asignación vigente (si hay) y abre una
-- nueva — atómico, SECURITY INVOKER (respeta tiene_permiso('inventario')
-- vía RLS igual que cualquier INSERT/UPDATE hecho a mano).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION asignar_equipo(p_equipo_id UUID, p_obra_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_equipo      equipos%ROWTYPE;
  v_obra_actual UUID;
BEGIN
  SELECT * INTO v_equipo FROM equipos WHERE id = p_equipo_id;
  IF v_equipo.id IS NULL THEN
    RAISE EXCEPTION 'Equipo no encontrado';
  END IF;
  IF v_equipo.estado = 'baja' THEN
    RAISE EXCEPTION 'No se puede asignar un equipo dado de baja';
  END IF;

  SELECT obra_id INTO v_obra_actual FROM equipo_asignaciones
  WHERE equipo_id = p_equipo_id AND fecha_hasta IS NULL;

  IF v_obra_actual = p_obra_id THEN
    RAISE EXCEPTION 'Ya está asignado a ese proyecto';
  END IF;

  UPDATE equipo_asignaciones SET fecha_hasta = CURRENT_DATE
  WHERE equipo_id = p_equipo_id AND fecha_hasta IS NULL;

  INSERT INTO equipo_asignaciones (equipo_id, obra_id, constructora_id, fecha_desde, asignado_por)
  VALUES (p_equipo_id, p_obra_id, v_equipo.constructora_id, CURRENT_DATE, auth.uid());

  UPDATE equipos SET estado = 'asignado' WHERE id = p_equipo_id;
END;
$$;

-- ------------------------------------------------------------
-- Devolver / mandar a mantenimiento / dar de baja: cierra la
-- asignación vigente (si hay) y deja el equipo en el estado pedido.
-- Reactivar (mantenimiento/baja -> disponible) también pasa por acá
-- (no hay asignación que cerrar, es un UPDATE simple).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION liberar_equipo(p_equipo_id UUID, p_nuevo_estado TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_nuevo_estado NOT IN ('disponible', 'mantenimiento', 'baja') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_nuevo_estado;
  END IF;

  UPDATE equipo_asignaciones SET fecha_hasta = CURRENT_DATE
  WHERE equipo_id = p_equipo_id AND fecha_hasta IS NULL;

  UPDATE equipos SET estado = p_nuevo_estado WHERE id = p_equipo_id;
END;
$$;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE equipos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipo_asignaciones  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipos_tenant" ON equipos;
CREATE POLICY "equipos_tenant" ON equipos
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('inventario'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('inventario'));

DROP POLICY IF EXISTS "equipo_asignaciones_tenant" ON equipo_asignaciones;
CREATE POLICY "equipo_asignaciones_tenant" ON equipo_asignaciones
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('inventario'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('inventario'));

-- ------------------------------------------------------------
-- purgar_constructora_completa: sumar equipos (equipo_asignaciones
-- cae en cascada).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION purgar_constructora_completa(p_constructora_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM cobros_proyecto   WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_obra    WHERE constructora_id = p_constructora_id;
  DELETE FROM presupuestos      WHERE constructora_id = p_constructora_id;
  DELETE FROM equipos           WHERE constructora_id = p_constructora_id;
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
