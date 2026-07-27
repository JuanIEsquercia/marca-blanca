-- ============================================================
-- MIGRATION 049: el linter de seguridad de Supabase detectó que
-- purgar_constructora_completa() y seed_constructora_defaults() son
-- ejecutables directamente vía /rest/v1/rpc/... por cualquier usuario
-- `authenticated` (y `anon`) — aunque migration_018/019/016 ya hacían
-- este mismo REVOKE, el permiso volvió a estar abierto en la base viva
-- (lo más probable: un DROP FUNCTION + recreate en el medio, que sí
-- resetea los grants a los defaults de Postgres, a diferencia de
-- CREATE OR REPLACE que los conserva).
--
-- Son SECURITY DEFINER sin chequeo interno de quién llama — su única
-- protección hoy es que la app las invoca desde
-- app/api/superadmin/constructoras/route.ts (verifySuperAdmin()) con el
-- service_role key, que ya bypassea RLS y no necesita el grant de
-- authenticated/anon para nada. El REVOKE no rompe ese flujo: el
-- service_role no está sujeto a estos grants.
-- ============================================================

REVOKE EXECUTE ON FUNCTION purgar_constructora_completa(UUID) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION seed_constructora_defaults(UUID) FROM PUBLIC, authenticated, anon;
