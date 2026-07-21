-- ============================================================
-- MIGRATION 026: Admin puede listar su equipo (perfiles) vía RLS normal
--
-- Gap identificado en la auditoría 2026-07-07 y nunca migrado hasta ahora:
-- la única policy de `perfiles` es "perfiles_propios" (id = auth.uid()),
-- FOR ALL — un admin no puede leer el perfil de un compañero de su propia
-- constructora salvo bypasseando RLS con createAdminClient() (service
-- role), que es justo lo que hoy hace app/admin/usuarios/ para poder
-- listar el equipo. Funciona, pero es un patrón frágil: cualquier código
-- nuevo que necesite listar perfiles del equipo (por ejemplo, futuras
-- pantallas) va a repetir la misma dependencia del admin client en vez de
-- poder confiar en RLS.
--
-- Fix: se agrega una policy ADICIONAL de SELECT para admins. No reemplaza
-- "perfiles_propios" — Postgres OR-ea policies permisivas del mismo
-- comando, así que esto solo AMPLÍA qué se puede LEER. INSERT/UPDATE/DELETE
-- siguen gobernados únicamente por "perfiles_propios" (id = auth.uid()),
-- sin ningún cambio: un admin sigue sin poder escribir el perfil de otro
-- vía RLS normal (para eso ya existe app/api/admin/usuarios con admin
-- client, que valida rol server-side).
--
-- Idempotente.
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================

DROP POLICY IF EXISTS "perfiles_admin_lee_equipo" ON perfiles;
CREATE POLICY "perfiles_admin_lee_equipo" ON perfiles
  FOR SELECT TO authenticated
  USING (es_admin() AND constructora_id IN (SELECT mis_constructoras()));

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- Como admin: SELECT * FROM perfiles WHERE constructora_id = '<tu constructora>' debe traer TODO el equipo (antes solo traía tu propia fila).
-- Como admin: intentar UPDATE perfiles SET nombre = 'x' WHERE id = '<otro perfil de tu equipo>' debe seguir fallando (0 filas afectadas) — la escritura sigue exclusiva de app/api/admin/usuarios con admin client.
-- Como admin de la constructora B: SELECT * FROM perfiles WHERE constructora_id = '<constructora A>' debe devolver 0 filas (aislamiento de tenant intacto).
-- Como operador: SELECT * FROM perfiles debe seguir devolviendo solo su propia fila.
