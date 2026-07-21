-- ============================================================
-- MIGRATION 023: Enforcement real de "proyecto cerrado"
--
-- obras.estado = 'finalizada' ("Cerrar proyecto") se muestra en la
-- UI como modo solo lectura, pero hasta ahora era puramente
-- cosmético: ninguna policy RLS chequeaba obras.estado, así que
-- cualquier escritura (ej. registrar un cobro) pasaba igual. Bug
-- confirmado en vivo por el usuario.
--
-- Esta migración agrega un trigger BEFORE INSERT/UPDATE/DELETE en
-- cada tabla obra-scoped que bloquea la escritura si el proyecto
-- (obras.estado) está 'finalizada'. A propósito NO hace excepción
-- para admin — el mensaje actual de la UI ("reactivalo desde el
-- tablero") no distingue rol, así que el trigger tampoco.
--
-- Sí respeta current_setting('app.bypass_inmutable', true) = 'true'
-- (seteado por purgar_constructora_completa()) para no romper el
-- borrado masivo de una constructora completa.
--
-- compradores y categorias_costo quedan afuera a propósito — no
-- tienen obra_id propio, son entidades compartidas entre proyectos
-- (mismo motivo por el que sus RLS usan tiene_permiso_en_algun_proyecto
-- en vez de tiene_permiso_proyecto).
--
-- Idempotente — seguro de ejecutar múltiples veces.
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================


-- ============================================================
-- PASO 1: Función genérica — tablas con columna obra_id propia
-- ============================================================

CREATE OR REPLACE FUNCTION bloquear_escritura_proyecto_cerrado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_obra_id UUID := COALESCE(NEW.obra_id, OLD.obra_id);
  v_estado  TEXT;
BEGIN
  IF current_setting('app.bypass_inmutable', true) = 'true' OR v_obra_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT estado INTO v_estado FROM obras WHERE id = v_obra_id;

  IF v_estado = 'finalizada' THEN
    RAISE EXCEPTION 'El proyecto está cerrado. Reactivalo para poder modificar sus datos.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================
-- PASO 2: Variantes para tablas sin obra_id propia
-- ============================================================

-- amenity_imagenes cuelga de amenities.
CREATE OR REPLACE FUNCTION bloquear_escritura_proyecto_cerrado_amenity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_obra_id UUID;
  v_estado  TEXT;
BEGIN
  IF current_setting('app.bypass_inmutable', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT obra_id INTO v_obra_id FROM amenities WHERE id = COALESCE(NEW.amenity_id, OLD.amenity_id);
  IF v_obra_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT estado INTO v_estado FROM obras WHERE id = v_obra_id;

  IF v_estado = 'finalizada' THEN
    RAISE EXCEPTION 'El proyecto está cerrado. Reactivalo para poder modificar sus datos.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- cuotas cuelga de contratos_venta.
CREATE OR REPLACE FUNCTION bloquear_escritura_proyecto_cerrado_cuota()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_obra_id UUID;
  v_estado  TEXT;
BEGIN
  IF current_setting('app.bypass_inmutable', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT obra_id INTO v_obra_id FROM contratos_venta WHERE id = COALESCE(NEW.contrato_id, OLD.contrato_id);
  IF v_obra_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT estado INTO v_estado FROM obras WHERE id = v_obra_id;

  IF v_estado = 'finalizada' THEN
    RAISE EXCEPTION 'El proyecto está cerrado. Reactivalo para poder modificar sus datos.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================
-- PASO 3: Attach de triggers
-- ============================================================

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tipologias', 'unidades', 'amenities', 'contratos_venta', 'reservas',
    'gastos', 'contratos_obra', 'certificados_avance', 'cobros_proyecto', 'cuentas_propias'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_bloquear_cerrado ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_bloquear_cerrado BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION bloquear_escritura_proyecto_cerrado()', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_bloquear_cerrado ON amenity_imagenes;
CREATE TRIGGER trg_bloquear_cerrado
  BEFORE INSERT OR UPDATE OR DELETE ON amenity_imagenes
  FOR EACH ROW EXECUTE FUNCTION bloquear_escritura_proyecto_cerrado_amenity();

DROP TRIGGER IF EXISTS trg_bloquear_cerrado ON cuotas;
CREATE TRIGGER trg_bloquear_cerrado
  BEFORE INSERT OR UPDATE OR DELETE ON cuotas
  FOR EACH ROW EXECUTE FUNCTION bloquear_escritura_proyecto_cerrado_cuota();
