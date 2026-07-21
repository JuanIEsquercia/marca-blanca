-- ============================================================
-- MIGRATION 028: hardening de seguridad — control de código 2026-07-20
--
-- Tres fixes independientes encontrados en una auditoría completa del
-- código (no un incidente en producción, análisis estático):
--
-- 1. Escalación de privilegios vía "perfiles_propios": esa policy es
--    FOR ALL y solo restringe LA FILA (id = auth.uid()), no las columnas.
--    Como el browser habla PostgREST directo con la anon key, cualquier
--    operador autenticado podía hacer PATCH .../perfiles?id=eq.<su-id>
--    con { rol: 'admin' } (o pisar constructora_id) sin pasar por ningún
--    código de la app. Las escrituras LEGÍTIMAS de rol/permisos/
--    constructora_id siempre pasan por app/api/admin/usuarios/route.ts
--    (o /api/superadmin/constructoras) con el service role — nunca desde
--    el cliente browser — así que bloquear esas columnas para cualquier
--    request que no sea service_role no rompe ningún flujo real.
--
-- 2. "obras_tenant" era FOR ALL y solo exigía tener ALGÚN permiso en el
--    proyecto (no rol admin) para poder UPDATE/DELETE la obra completa —
--    components/admin/ProyectoAcciones.tsx no filtra por rol tampoco, así
--    que un operador con un solo módulo asignado podía cerrar/eliminar el
--    proyecto entero. Se separa en SELECT (igual que antes, cualquier
--    asignado) vs INSERT/UPDATE/DELETE (solo admin) — no hay ningún flujo
--    de operador que cree/edite/borre obras hoy (confirmado por grep).
--
-- 3. "reservas" no tenía ningún constraint que impida dos reservas
--    'Vigente' simultáneas sobre la misma unidad (a diferencia de
--    contratos_venta.unidad_id, que sí es UNIQUE) — dos operadores podían
--    reservar la misma unidad casi al mismo tiempo.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Bloquear auto-escalación de privilegios en perfiles
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION proteger_columnas_sensibles_perfil()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Las únicas escrituras legítimas de estas columnas vienen del service
  -- role (rutas /api/admin/usuarios, /api/superadmin/constructoras). Toda
  -- escritura autenticada normal (browser, RLS de "perfiles_propios") que
  -- intente tocarlas se bloquea acá, sin importar si el actor ya es admin.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.rol IS DISTINCT FROM OLD.rol
     OR NEW.permisos IS DISTINCT FROM OLD.permisos
     OR NEW.constructora_id IS DISTINCT FROM OLD.constructora_id
     OR NEW.activo IS DISTINCT FROM OLD.activo THEN
    RAISE EXCEPTION 'No podés modificar rol, permisos, constructora o estado de tu propio perfil.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_columnas_sensibles_perfil ON perfiles;
CREATE TRIGGER trg_proteger_columnas_sensibles_perfil
  BEFORE UPDATE ON perfiles
  FOR EACH ROW EXECUTE FUNCTION proteger_columnas_sensibles_perfil();

-- ------------------------------------------------------------
-- 2. obras_tenant: separar lectura (asignados) de escritura (solo admin)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "obras_tenant" ON obras;

CREATE POLICY "obras_ven_asignados" ON obras
  FOR SELECT TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras())
    AND (es_admin() OR EXISTS (SELECT 1 FROM perfil_proyectos WHERE perfil_id = auth.uid() AND obra_id = obras.id))
  );

CREATE POLICY "obras_admin_crea" ON obras
  FOR INSERT TO authenticated
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND es_admin());

CREATE POLICY "obras_admin_actualiza" ON obras
  FOR UPDATE TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND es_admin())
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND es_admin());

CREATE POLICY "obras_admin_elimina" ON obras
  FOR DELETE TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()) AND es_admin());

-- ------------------------------------------------------------
-- 3. Evitar doble reserva vigente sobre la misma unidad
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservas_unica_vigente
  ON reservas (unidad_id) WHERE estado = 'Vigente';
