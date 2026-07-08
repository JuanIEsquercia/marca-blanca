-- ============================================================
-- MIGRATION 016: Cierre de gaps de la auditoría multi-tenant 2026-07-07
-- 1) El flujo OBRA (contratos_obra, certificados_avance, cobros_proyecto)
--    nunca tuvo gating por módulo en RLS — un operador sin ningún permiso
--    asignado podía leer/crear/editar certificados y cobros de obra.
--    Se agregan las keys 'certificados' y 'cobros' (ver lib/permisos.ts)
--    y se exige tiene_permiso() igual que el resto de las tablas.
-- 2) handle_new_auth_user() asignaba todo usuario nuevo en auth.users
--    (signup público, invitaciones, o el propio auth.admin.createUser()
--    del onboarding) a la PRIMERA constructora creada en el sistema,
--    como operador con permisos NULL (= sin restricción). Se corrige
--    para dejar constructora_id NULL si no hay invitación explícita.
-- 3) seed_constructora_defaults(p_constructora_id) era un RPC
--    SECURITY DEFINER sin validar el caller — cualquier autenticado
--    podía sembrar categorías en una constructora ajena. Se revoca
--    el permiso de ejecución para 'authenticated'.
-- Idempotente — seguro de ejecutar múltiples veces.
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================


-- ============================================================
-- PASO 1: RLS por módulo en el flujo OBRA
-- ============================================================

DROP POLICY IF EXISTS "contratos_obra_tenant" ON contratos_obra;
CREATE POLICY "contratos_obra_tenant" ON contratos_obra
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('certificados'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('certificados'));

DROP POLICY IF EXISTS "certificados_avance_tenant" ON certificados_avance;
CREATE POLICY "certificados_avance_tenant" ON certificados_avance
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('certificados'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('certificados'));

DROP POLICY IF EXISTS "cobros_proyecto_tenant" ON cobros_proyecto;
CREATE POLICY "cobros_proyecto_tenant" ON cobros_proyecto
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('cobros'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('cobros'));


-- ============================================================
-- PASO 2: handle_new_auth_user() — no auto-asignar constructora
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nombre TEXT;
BEGIN
  v_nombre := COALESCE(
    NEW.raw_user_meta_data->>'nombre',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1),
    'Usuario'
  );

  -- No auto-asignamos constructora: el onboarding (superadmin o invitación)
  -- es quien setea perfiles.constructora_id explícitamente después de crear
  -- el auth user. Un perfil con constructora_id NULL no puede resolver tenant
  -- (ver lib/tenant.ts) y por lo tanto no tiene acceso a ningún dato.
  INSERT INTO perfiles (id, nombre, rol, constructora_id)
  VALUES (NEW.id, v_nombre, 'operador', NULL)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


-- ============================================================
-- PASO 3: seed_constructora_defaults() — ya no ejecutable por
-- cualquier autenticado vía RPC directo. Solo se llama server-side
-- con el admin client (bypassea RLS a propósito, como ya se hace
-- en app/api/superadmin/constructoras/route.ts).
-- ============================================================

REVOKE EXECUTE ON FUNCTION seed_constructora_defaults(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION seed_constructora_defaults(UUID) FROM anon;


-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- Como operador sin permiso 'certificados': SELECT * FROM certificados_avance debe devolver 0 filas.
-- Como operador sin permiso 'cobros': SELECT * FROM cobros_proyecto debe devolver 0 filas.
-- Crear un usuario nuevo (auth.admin.createUser) y verificar que perfiles.constructora_id quede NULL.
-- Como cualquier autenticado: SELECT seed_constructora_defaults('<uuid-ajeno>') debe fallar con "permission denied".
