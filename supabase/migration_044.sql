-- ============================================================
-- MIGRATION 044: asignar_equipo/asignar_personal/asignar_cuadrilla
-- (migrations 032/038) nunca validaban que p_obra_id perteneciera a
-- la misma constructora que el equipo/persona/cuadrilla asignada —
-- son SECURITY INVOKER, así que RLS ya impide leer equipos/personal
-- ajenos, pero el obra_id recibido por parámetro se insertaba tal
-- cual en equipo_asignaciones/personal_asignaciones sin chequeo.
-- Mismo patrón de bug que seed_constructora_defaults (auditoría
-- 2026-07-07): un ID recibido por parámetro sin validar que sea del
-- tenant del caller. Acá no hay fuga de lectura (la fila resultante
-- sigue con constructora_id propio, invisible para el tenant dueño de
-- esa obra vía RLS), pero es una violación de integridad tenant que
-- conviene cerrar antes de que dependa de algo. aceptar_presupuesto()
-- ya tenía el chequeo correcto (obras WHERE id = p_obra_id AND
-- constructora_id = ...) — se replica ese mismo patrón acá.
-- ============================================================

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

  IF NOT EXISTS (SELECT 1 FROM obras WHERE id = p_obra_id AND constructora_id = v_equipo.constructora_id) THEN
    RAISE EXCEPTION 'Proyecto no encontrado';
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

  IF NOT EXISTS (SELECT 1 FROM obras WHERE id = p_obra_id AND constructora_id = v_personal.constructora_id) THEN
    RAISE EXCEPTION 'Proyecto no encontrado';
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

CREATE OR REPLACE FUNCTION asignar_cuadrilla(p_cuadrilla_id UUID, p_obra_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_persona          RECORD;
  v_obra_actual      UUID;
  v_count            INTEGER := 0;
  v_constructora_id  UUID;
BEGIN
  SELECT constructora_id INTO v_constructora_id FROM cuadrillas WHERE id = p_cuadrilla_id;
  IF v_constructora_id IS NULL THEN
    RAISE EXCEPTION 'Cuadrilla no encontrada';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM obras WHERE id = p_obra_id AND constructora_id = v_constructora_id) THEN
    RAISE EXCEPTION 'Proyecto no encontrado';
  END IF;

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
