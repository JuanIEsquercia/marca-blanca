-- ============================================================
-- MIGRATION 015: Hardening multi-tenant SaaS
-- 1) Los permisos granulares de perfiles.permisos (hoy solo UI) se
--    aplican también en RLS — un operador sin acceso a un módulo no
--    puede leer/escribir esa tabla ni yendo directo contra la API.
-- 2) Certificados aprobados y cobros cobrados quedan inmutables
--    para no-admins (no se pueden editar/eliminar sin dejar rastro).
-- 3) Columnas de auditoría (created_by/updated_by/updated_at) en
--    las tablas financieras.
-- 4) numero de certificado/cobro se asigna en la base de datos
--    (elimina la race condition del cálculo MAX()+1 en el cliente).
-- 5) monto_certificado no puede superar el monto_total del contrato.
-- 6) Se eliminan las políticas anon sin scope de constructora
--    (no hay landing pública que las use — ver app/page.tsx).
-- 7) Tabla `auditoria` — historial completo (antes/después en JSONB)
--    de cambios en las tablas financieras, no solo quién/cuándo.
-- 8) Gastos en estado 'Pagado' quedan inmutables para no-admins.
-- 9) saldo_inicial de cuentas_propias solo lo puede tocar un admin.
-- 10) Índices en las tablas del flujo OBRA (antes sin indexar) y en
--     auditoria, para que el aislamiento por RLS escale con volumen.
-- Idempotente — seguro de ejecutar múltiples veces.
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================


-- ============================================================
-- PASO 1: Funciones helper de rol/permiso (SECURITY DEFINER,
-- mismo patrón que mis_constructoras())
-- ============================================================

CREATE OR REPLACE FUNCTION es_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT rol = 'admin' FROM perfiles WHERE id = auth.uid()), false)
$$;

-- Replica lib/permisos.ts:tienePermiso() del lado del servidor:
-- admin => true siempre; permisos NULL => legado sin restricción;
-- si no, el módulo tiene que estar en el array.
CREATE OR REPLACE FUNCTION tiene_permiso(p_modulo TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN rol = 'admin' THEN true
        WHEN permisos IS NULL THEN true
        ELSE p_modulo = ANY(permisos)
      END
      FROM perfiles WHERE id = auth.uid()
    ),
    false
  )
$$;


-- ============================================================
-- PASO 2: RLS por módulo — mismos módulos que MODULOS en lib/permisos.ts
-- ============================================================

DROP POLICY IF EXISTS "tipologias_tenant" ON tipologias;
CREATE POLICY "tipologias_tenant" ON tipologias
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('tipologias'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('tipologias'));

DROP POLICY IF EXISTS "unidades_tenant" ON unidades;
CREATE POLICY "unidades_tenant" ON unidades
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('unidades'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('unidades'));

DROP POLICY IF EXISTS "reservas_tenant" ON reservas;
CREATE POLICY "reservas_tenant" ON reservas
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('reservas'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('reservas'));

DROP POLICY IF EXISTS "contratos_tenant" ON contratos_venta;
CREATE POLICY "contratos_tenant" ON contratos_venta
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('contratos'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('contratos'));

DROP POLICY IF EXISTS "cuotas_tenant" ON cuotas;
CREATE POLICY "cuotas_tenant" ON cuotas
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('contratos'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('contratos'));

DROP POLICY IF EXISTS "amenities_tenant" ON amenities;
CREATE POLICY "amenities_tenant" ON amenities
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('amenities'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('amenities'));

DROP POLICY IF EXISTS "amenity_imagenes_tenant" ON amenity_imagenes;
CREATE POLICY "amenity_imagenes_tenant" ON amenity_imagenes
  FOR ALL TO authenticated
  USING (
    tiene_permiso('amenities') AND
    amenity_id IN (SELECT id FROM amenities WHERE constructora_id IN (SELECT mis_constructoras()))
  )
  WITH CHECK (
    tiene_permiso('amenities') AND
    amenity_id IN (SELECT id FROM amenities WHERE constructora_id IN (SELECT mis_constructoras()))
  );

DROP POLICY IF EXISTS "gastos_tenant" ON gastos;
CREATE POLICY "gastos_tenant" ON gastos
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('gastos'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('gastos'));

DROP POLICY IF EXISTS "categorias_costo_tenant" ON categorias_costo;
CREATE POLICY "categorias_costo_tenant" ON categorias_costo
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('gastos'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('gastos'));

DROP POLICY IF EXISTS "proveedores_tenant" ON proveedores;
CREATE POLICY "proveedores_tenant" ON proveedores
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('proveedores'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('proveedores'));

DROP POLICY IF EXISTS "cuentas_proveedor_tenant" ON cuentas_proveedor;
CREATE POLICY "cuentas_proveedor_tenant" ON cuentas_proveedor
  FOR ALL TO authenticated
  USING (
    tiene_permiso('proveedores') AND
    proveedor_id IN (SELECT id FROM proveedores WHERE constructora_id IN (SELECT mis_constructoras()))
  )
  WITH CHECK (
    tiene_permiso('proveedores') AND
    proveedor_id IN (SELECT id FROM proveedores WHERE constructora_id IN (SELECT mis_constructoras()))
  );

DROP POLICY IF EXISTS "cuentas_propias_tenant" ON cuentas_propias;
CREATE POLICY "cuentas_propias_tenant" ON cuentas_propias
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('cuentas'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('cuentas'));


-- ============================================================
-- PASO 3: Eliminar accesos anon sin scope de tenant.
-- No queda ninguna landing pública (app/page.tsx redirige a /admin),
-- así que este acceso anónimo es superficie sin uso legítimo.
-- ============================================================

DROP POLICY IF EXISTS "tipologias_anon_lee"          ON tipologias;
DROP POLICY IF EXISTS "amenities_anon_lee"            ON amenities;
DROP POLICY IF EXISTS "amenity_imagenes_anon_lee"     ON amenity_imagenes;
DROP POLICY IF EXISTS "unidades_anon_lee_publicas"    ON unidades;

REVOKE SELECT ON vista_stock_publico FROM anon;


-- ============================================================
-- PASO 4: Columnas de auditoría en tablas financieras
-- ============================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['certificados_avance', 'cobros_proyecto', 'contratos_obra', 'contratos_venta', 'gastos', 'cuentas_propias']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id)', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id)', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION set_auditoria_campos()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.updated_by := auth.uid();
    NEW.updated_at := NOW();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_by := OLD.created_by;
    NEW.updated_by := auth.uid();
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['certificados_avance', 'cobros_proyecto', 'contratos_obra', 'contratos_venta', 'gastos', 'cuentas_propias']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditoria_campos ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_auditoria_campos BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_auditoria_campos()', t);
  END LOOP;
END $$;


-- ============================================================
-- PASO 5: Inmutabilidad — certificados aprobados y cobros cobrados
-- no se pueden editar ni eliminar salvo por un admin.
-- ============================================================

CREATE OR REPLACE FUNCTION proteger_registro_financiero_terminal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF es_admin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'No se puede eliminar: el registro ya está % y solo un admin puede modificarlo.', OLD.estado;
  END IF;

  RAISE EXCEPTION 'No se puede editar: el registro ya está % y solo un admin puede modificarlo.', OLD.estado;
END;
$$;

DROP TRIGGER IF EXISTS trg_certificados_avance_inmutable ON certificados_avance;
CREATE TRIGGER trg_certificados_avance_inmutable
  BEFORE UPDATE OR DELETE ON certificados_avance
  FOR EACH ROW
  WHEN (OLD.estado = 'aprobado')
  EXECUTE FUNCTION proteger_registro_financiero_terminal();

DROP TRIGGER IF EXISTS trg_cobros_proyecto_inmutable ON cobros_proyecto;
CREATE TRIGGER trg_cobros_proyecto_inmutable
  BEFORE UPDATE OR DELETE ON cobros_proyecto
  FOR EACH ROW
  WHEN (OLD.estado = 'cobrado')
  EXECUTE FUNCTION proteger_registro_financiero_terminal();


-- ============================================================
-- PASO 6: numero de certificado/cobro asignado por la base de datos
-- (elimina la race condition de MAX()+1 calculado en el cliente)
-- ============================================================

CREATE OR REPLACE FUNCTION asignar_numero_certificado()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('certificados_avance:' || NEW.contrato_obra_id::text));
  SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
  FROM certificados_avance
  WHERE contrato_obra_id = NEW.contrato_obra_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_certificados_numero ON certificados_avance;
CREATE TRIGGER trg_certificados_numero
  BEFORE INSERT ON certificados_avance
  FOR EACH ROW EXECUTE FUNCTION asignar_numero_certificado();

CREATE OR REPLACE FUNCTION asignar_numero_cobro_proyecto()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.certificado_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('cobros_proyecto:' || NEW.certificado_id::text));
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM cobros_proyecto
    WHERE certificado_id = NEW.certificado_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cobros_proyecto_numero ON cobros_proyecto;
CREATE TRIGGER trg_cobros_proyecto_numero
  BEFORE INSERT ON cobros_proyecto
  FOR EACH ROW EXECUTE FUNCTION asignar_numero_cobro_proyecto();


-- ============================================================
-- PASO 7: un certificado no puede superar el monto_total del contrato
-- ============================================================

CREATE OR REPLACE FUNCTION validar_monto_certificado()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_monto_total NUMERIC(15,2);
  v_suma_otros  NUMERIC(15,2);
BEGIN
  SELECT monto_total INTO v_monto_total
  FROM contratos_obra WHERE id = NEW.contrato_obra_id;

  SELECT COALESCE(SUM(monto_certificado), 0) INTO v_suma_otros
  FROM certificados_avance
  WHERE contrato_obra_id = NEW.contrato_obra_id
    AND id != NEW.id;

  IF v_monto_total IS NOT NULL AND (v_suma_otros + NEW.monto_certificado) > v_monto_total THEN
    RAISE EXCEPTION 'El monto certificado acumulado (%) supera el monto total del contrato (%)',
      v_suma_otros + NEW.monto_certificado, v_monto_total;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_monto_certificado ON certificados_avance;
CREATE TRIGGER trg_validar_monto_certificado
  BEFORE INSERT OR UPDATE ON certificados_avance
  FOR EACH ROW EXECUTE FUNCTION validar_monto_certificado();


-- ============================================================
-- PASO 8: Tabla de auditoría — historial completo (antes/después)
-- Las columnas created_by/updated_by del PASO 4 dicen quién tocó el
-- registro por última vez; esta tabla guarda CADA cambio con sus
-- valores completos, para poder reconstruir qué pasó.
-- ============================================================

CREATE TABLE IF NOT EXISTS auditoria (
  id              BIGSERIAL PRIMARY KEY,
  tabla           TEXT NOT NULL,
  operacion       TEXT NOT NULL,
  registro_id     UUID,
  constructora_id UUID,
  usuario_id      UUID,
  datos_antes     JSONB,
  datos_despues   JSONB,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_constructora ON auditoria(constructora_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_tabla_registro ON auditoria(tabla, registro_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_creado_en ON auditoria(creado_en);

ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;

-- Nadie escribe directo — solo la inserta el trigger (SECURITY DEFINER, más abajo).
-- Solo un admin puede leer la auditoría de su propia constructora.
DROP POLICY IF EXISTS "auditoria_admin_lee" ON auditoria;
CREATE POLICY "auditoria_admin_lee" ON auditoria
  FOR SELECT TO authenticated
  USING (es_admin() AND constructora_id IN (SELECT mis_constructoras()));

CREATE OR REPLACE FUNCTION registrar_auditoria()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_constructora_id UUID;
BEGIN
  v_constructora_id := COALESCE(
    (to_jsonb(NEW)->>'constructora_id')::uuid,
    (to_jsonb(OLD)->>'constructora_id')::uuid
  );

  INSERT INTO auditoria (tabla, operacion, registro_id, constructora_id, usuario_id, datos_antes, datos_despues)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    COALESCE((to_jsonb(NEW)->>'id')::uuid, (to_jsonb(OLD)->>'id')::uuid),
    v_constructora_id,
    auth.uid(),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['certificados_avance', 'cobros_proyecto', 'contratos_obra', 'contratos_venta', 'gastos', 'cuentas_propias']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_registrar_auditoria ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_registrar_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION registrar_auditoria()', t);
  END LOOP;
END $$;


-- ============================================================
-- PASO 9: Gastos pagados quedan inmutables para no-admins
-- (mismo mecanismo que certificados/cobros del PASO 5)
-- ============================================================

DROP TRIGGER IF EXISTS trg_gastos_inmutable ON gastos;
CREATE TRIGGER trg_gastos_inmutable
  BEFORE UPDATE OR DELETE ON gastos
  FOR EACH ROW
  WHEN (OLD.estado = 'Pagado')
  EXECUTE FUNCTION proteger_registro_financiero_terminal();


-- ============================================================
-- PASO 10: saldo_inicial de cuentas_propias — solo un admin lo cambia
-- ============================================================

CREATE OR REPLACE FUNCTION proteger_saldo_inicial()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT es_admin() AND NEW.saldo_inicial IS DISTINCT FROM OLD.saldo_inicial THEN
    RAISE EXCEPTION 'Solo un admin puede modificar el saldo inicial de una cuenta.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cuentas_propias_saldo_inicial ON cuentas_propias;
CREATE TRIGGER trg_cuentas_propias_saldo_inicial
  BEFORE UPDATE ON cuentas_propias
  FOR EACH ROW EXECUTE FUNCTION proteger_saldo_inicial();


-- ============================================================
-- PASO 11: Índices para escalar — el flujo OBRA (contratos_obra,
-- certificados_avance, cobros_proyecto) no tenía ningún índice y
-- toda policy RLS filtra por constructora_id/obra_id en cada query.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_contratos_obra_constructora   ON contratos_obra(constructora_id);
CREATE INDEX IF NOT EXISTS idx_contratos_obra_obra            ON contratos_obra(obra_id);

CREATE INDEX IF NOT EXISTS idx_certificados_constructora      ON certificados_avance(constructora_id);
CREATE INDEX IF NOT EXISTS idx_certificados_contrato_obra     ON certificados_avance(contrato_obra_id);
CREATE INDEX IF NOT EXISTS idx_certificados_obra              ON certificados_avance(obra_id);

CREATE INDEX IF NOT EXISTS idx_cobros_proyecto_constructora   ON cobros_proyecto(constructora_id);
CREATE INDEX IF NOT EXISTS idx_cobros_proyecto_obra           ON cobros_proyecto(obra_id);
CREATE INDEX IF NOT EXISTS idx_cobros_proyecto_certificado    ON cobros_proyecto(certificado_id);
CREATE INDEX IF NOT EXISTS idx_cobros_proyecto_cuenta_propia  ON cobros_proyecto(cuenta_propia_id);


-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- SELECT tiene_permiso('gastos');  -- estando logueado
-- SELECT es_admin();
-- Probar: como operador sin 'cuentas' en permisos, SELECT * FROM cuentas_propias debe devolver 0 filas.
-- Probar: intentar UPDATE/DELETE sobre un certificado en estado 'aprobado' como operador debe fallar.
-- Probar: intentar UPDATE/DELETE sobre un gasto en estado 'Pagado' como operador debe fallar.
-- Probar: como operador, UPDATE cuentas_propias SET saldo_inicial = X debe fallar.
-- SELECT * FROM auditoria ORDER BY creado_en DESC LIMIT 20;  -- como admin
