-- ============================================================
-- MIGRATION 038: Personal — mismo patrón que Inventario (migration_032):
-- asignación vigente + historial completo, módulo de Empresa.
--
-- Decisiones de producto confirmadas con el usuario (no re-litigar):
-- 1. La trazabilidad vive en la PERSONA, no en la cuadrilla — la
--    composición de una cuadrilla varía seguido, así que atar el
--    historial a la cuadrilla sería frágil (¿qué pasa si alguien
--    cambia de cuadrilla en medio de una obra, o la cuadrilla se
--    disuelve?). Cada persona tiene su propia línea de tiempo,
--    igual que un equipo de Inventario.
-- 2. El costo (jornal) es de cada persona, no de la cuadrilla entera.
-- 3. Cuadrilla es una agrupación SIMPLE — solo composición actual
--    (personal.cuadrilla_id), sin historial de membresía. Si mañana
--    hace falta saber "quién estaba en la cuadrilla X en marzo", eso
--    es una migración aparte que agrega fecha_desde/fecha_hasta a la
--    membresía — no hace falta anticiparlo ahora.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS personal (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id     UUID NOT NULL REFERENCES constructoras(id),
  nombre              TEXT NOT NULL,
  dni                 TEXT,
  cuil                TEXT,
  telefono            TEXT,
  tipo_contratacion   TEXT NOT NULL DEFAULT 'relacion_dependencia'
    CHECK (tipo_contratacion IN ('relacion_dependencia', 'contratado', 'subcontratista')),
  categoria           TEXT,  -- libre: Ayudante, Medio Oficial, Oficial, Oficial Especializado, Capataz...
  jornal              NUMERIC(15,2),  -- costo por día, opcional — puerta de entrada a costo de mano de obra por proyecto
  art_aseguradora     TEXT,
  art_vencimiento     DATE,
  fecha_ingreso       DATE,
  estado              TEXT NOT NULL DEFAULT 'disponible'
    CHECK (estado IN ('disponible', 'asignado', 'licencia', 'baja')),
  notas               TEXT,
  created_by          UUID REFERENCES auth.users(id),
  updated_by          UUID REFERENCES auth.users(id),
  updated_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- cuadrillas.capataz_id referencia personal, que ya existe. personal.cuadrilla_id
-- se agrega después de crear cuadrillas (evita la dependencia circular).
CREATE TABLE IF NOT EXISTS cuadrillas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id UUID NOT NULL REFERENCES constructoras(id),
  nombre          TEXT NOT NULL,
  capataz_id      UUID REFERENCES personal(id) ON DELETE SET NULL,
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE personal ADD COLUMN IF NOT EXISTS cuadrilla_id UUID REFERENCES cuadrillas(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS personal_asignaciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_id     UUID NOT NULL REFERENCES personal(id) ON DELETE CASCADE,
  obra_id         UUID NOT NULL REFERENCES obras(id),
  constructora_id UUID NOT NULL REFERENCES constructoras(id),
  fecha_desde     DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_hasta     DATE,  -- NULL = asignación vigente
  asignado_por    UUID REFERENCES auth.users(id),
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Una persona no puede estar "vigente" en dos proyectos a la vez —
-- mismo mecanismo que idx_equipo_asignaciones_unica_vigente.
CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_asignaciones_unica_vigente
  ON personal_asignaciones(personal_id) WHERE fecha_hasta IS NULL;

CREATE INDEX IF NOT EXISTS idx_personal_constructora              ON personal(constructora_id);
CREATE INDEX IF NOT EXISTS idx_personal_cuadrilla                 ON personal(cuadrilla_id);
CREATE INDEX IF NOT EXISTS idx_cuadrillas_constructora            ON cuadrillas(constructora_id);
CREATE INDEX IF NOT EXISTS idx_personal_asignaciones_personal     ON personal_asignaciones(personal_id);
CREATE INDEX IF NOT EXISTS idx_personal_asignaciones_obra         ON personal_asignaciones(obra_id);
CREATE INDEX IF NOT EXISTS idx_personal_asignaciones_constructora ON personal_asignaciones(constructora_id);

DROP TRIGGER IF EXISTS trg_auditoria_campos ON personal;
CREATE TRIGGER trg_auditoria_campos
  BEFORE INSERT OR UPDATE ON personal
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_campos();

DROP TRIGGER IF EXISTS trg_registrar_auditoria ON personal;
CREATE TRIGGER trg_registrar_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON personal
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

-- ------------------------------------------------------------
-- Asignar/reasignar una persona — idéntico a asignar_equipo.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION asignar_personal(p_personal_id UUID, p_obra_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_personal    personal%ROWTYPE;
  v_obra_actual UUID;
BEGIN
  SELECT * INTO v_personal FROM personal WHERE id = p_personal_id;
  IF v_personal.id IS NULL THEN
    RAISE EXCEPTION 'Personal no encontrado';
  END IF;
  IF v_personal.estado = 'baja' THEN
    RAISE EXCEPTION 'No se puede asignar a una persona dada de baja';
  END IF;

  SELECT obra_id INTO v_obra_actual FROM personal_asignaciones
  WHERE personal_id = p_personal_id AND fecha_hasta IS NULL;

  IF v_obra_actual = p_obra_id THEN
    RAISE EXCEPTION 'Ya está asignado a ese proyecto';
  END IF;

  UPDATE personal_asignaciones SET fecha_hasta = CURRENT_DATE
  WHERE personal_id = p_personal_id AND fecha_hasta IS NULL;

  INSERT INTO personal_asignaciones (personal_id, obra_id, constructora_id, fecha_desde, asignado_por)
  VALUES (p_personal_id, p_obra_id, v_personal.constructora_id, CURRENT_DATE, auth.uid());

  UPDATE personal SET estado = 'asignado' WHERE id = p_personal_id;
END;
$$;

-- ------------------------------------------------------------
-- Devolver / licencia / baja / reactivar — idéntico a liberar_equipo.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION liberar_personal(p_personal_id UUID, p_nuevo_estado TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_nuevo_estado NOT IN ('disponible', 'licencia', 'baja') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_nuevo_estado;
  END IF;

  UPDATE personal_asignaciones SET fecha_hasta = CURRENT_DATE
  WHERE personal_id = p_personal_id AND fecha_hasta IS NULL;

  UPDATE personal SET estado = p_nuevo_estado WHERE id = p_personal_id;
END;
$$;

-- ------------------------------------------------------------
-- Asignar una cuadrilla completa a un proyecto — asigna a cada
-- integrante actual (personal.cuadrilla_id) individualmente, sin
-- fallar si alguno ya estaba en ese mismo proyecto (lo salta en vez
-- de abortar el resto del lote) ni si alguno está de baja (se
-- excluye). Devuelve cuántas personas se (re)asignaron.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION asignar_cuadrilla(p_cuadrilla_id UUID, p_obra_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_persona     RECORD;
  v_obra_actual UUID;
  v_count       INTEGER := 0;
BEGIN
  FOR v_persona IN SELECT id, constructora_id FROM personal WHERE cuadrilla_id = p_cuadrilla_id AND estado != 'baja' LOOP
    SELECT obra_id INTO v_obra_actual FROM personal_asignaciones
    WHERE personal_id = v_persona.id AND fecha_hasta IS NULL;

    IF v_obra_actual IS DISTINCT FROM p_obra_id THEN
      UPDATE personal_asignaciones SET fecha_hasta = CURRENT_DATE
      WHERE personal_id = v_persona.id AND fecha_hasta IS NULL;

      INSERT INTO personal_asignaciones (personal_id, obra_id, constructora_id, fecha_desde, asignado_por)
      VALUES (v_persona.id, p_obra_id, v_persona.constructora_id, CURRENT_DATE, auth.uid());

      UPDATE personal SET estado = 'asignado' WHERE id = v_persona.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ------------------------------------------------------------
-- RLS — módulo de Empresa, mismo criterio que equipos/presupuestos.
-- ------------------------------------------------------------
ALTER TABLE personal              ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuadrillas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_asignaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_tenant" ON personal;
CREATE POLICY "personal_tenant" ON personal
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('personal'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('personal'));

DROP POLICY IF EXISTS "cuadrillas_tenant" ON cuadrillas;
CREATE POLICY "cuadrillas_tenant" ON cuadrillas
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('personal'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('personal'));

DROP POLICY IF EXISTS "personal_asignaciones_tenant" ON personal_asignaciones;
CREATE POLICY "personal_asignaciones_tenant" ON personal_asignaciones
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('personal'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('personal'));

-- ------------------------------------------------------------
-- purgar_constructora_completa: sumar personal/cuadrillas
-- (personal_asignaciones cae en cascada desde personal).
-- ------------------------------------------------------------
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
