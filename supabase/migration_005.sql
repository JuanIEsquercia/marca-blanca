-- migration_005: sistema de permisos granulares por usuario
-- Correr en Supabase SQL Editor

ALTER TABLE perfiles
  ADD COLUMN IF NOT EXISTS permisos text[] DEFAULT NULL;

-- NULL = sin restricciones (admins y usuarios legados)
-- [] = sin acceso a ningún módulo
-- ['reservas', 'contratos', ...] = acceso solo a esos módulos
