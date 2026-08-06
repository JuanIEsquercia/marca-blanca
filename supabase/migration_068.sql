-- ------------------------------------------------------------
-- Módulo "Clientes" nuevo (lib/permisos.ts): CRUD standalone de
-- `compradores` + selector compartido con búsqueda/reuso/actualización
-- usado en Presupuestos, Contrato directo, Reservas y Ventas. La RLS de
-- `compradores` solo dejaba pasar a quien tuviera 'reservas'/'contratos'/
-- 'certificados' en algún proyecto — un usuario con SOLO el permiso nuevo
-- 'clientes' (para la pantalla standalone) no podía ni leer ni escribir.
-- Se agrega esa alternativa sin sacar las anteriores.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "compradores_tenant" ON compradores;
CREATE POLICY "compradores_tenant" ON compradores
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras())
    AND (
      tiene_permiso('clientes')
      OR tiene_permiso_en_algun_proyecto('reservas')
      OR tiene_permiso_en_algun_proyecto('contratos')
      OR tiene_permiso_en_algun_proyecto('certificados')
    )
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras())
    AND (
      tiene_permiso('clientes')
      OR tiene_permiso_en_algun_proyecto('reservas')
      OR tiene_permiso_en_algun_proyecto('contratos')
      OR tiene_permiso_en_algun_proyecto('certificados')
    )
  );
