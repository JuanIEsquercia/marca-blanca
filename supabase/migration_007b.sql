-- ============================================================
-- MIGRATION 007b: Fix RLS — eliminar recursión infinita en miembros
--
-- PROBLEMA: la política de miembros usaba una subconsulta que
-- volvía a leer miembros → recursión infinita → todo caído.
--
-- SOLUCIÓN: función SECURITY DEFINER que lee miembros sin RLS
-- aplicado, rompiendo el ciclo.
-- ============================================================

-- 1. Función que devuelve las constructoras del usuario actual
--    SECURITY DEFINER = corre como el dueño de la función (postgres),
--    no como el llamador → lee miembros sin pasar por RLS → sin recursión.
CREATE OR REPLACE FUNCTION mis_constructoras()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT constructora_id FROM miembros WHERE user_id = auth.uid()
$$;

-- 2. Arreglar miembros — la política original era self-referencial
DROP POLICY IF EXISTS "miembros_ven_propios" ON miembros;
CREATE POLICY "miembros_ven_propios" ON miembros
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 3. Reemplazar todas las políticas por la versión con la función
--    (que no tiene el problema de recursión)

-- CONSTRUCTORAS
DROP POLICY IF EXISTS "constructoras_miembros_ven" ON constructoras;
CREATE POLICY "constructoras_miembros_ven" ON constructoras
  FOR SELECT TO authenticated
  USING (id IN (SELECT mis_constructoras()));

-- OBRAS
DROP POLICY IF EXISTS "obras_tenant" ON obras;
CREATE POLICY "obras_tenant" ON obras
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- TIPOLOGIAS
DROP POLICY IF EXISTS "tipologias_tenant" ON tipologias;
CREATE POLICY "tipologias_tenant" ON tipologias
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- UNIDADES
DROP POLICY IF EXISTS "unidades_tenant" ON unidades;
CREATE POLICY "unidades_tenant" ON unidades
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- COMPRADORES
DROP POLICY IF EXISTS "compradores_tenant" ON compradores;
CREATE POLICY "compradores_tenant" ON compradores
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- CONTRATOS_VENTA
DROP POLICY IF EXISTS "contratos_tenant" ON contratos_venta;
CREATE POLICY "contratos_tenant" ON contratos_venta
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- CUOTAS
DROP POLICY IF EXISTS "cuotas_tenant" ON cuotas;
CREATE POLICY "cuotas_tenant" ON cuotas
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- RESERVAS
DROP POLICY IF EXISTS "reservas_tenant" ON reservas;
CREATE POLICY "reservas_tenant" ON reservas
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- LEADS
DROP POLICY IF EXISTS "leads_tenant" ON leads;
CREATE POLICY "leads_tenant" ON leads
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- AMENITIES
DROP POLICY IF EXISTS "amenities_tenant" ON amenities;
CREATE POLICY "amenities_tenant" ON amenities
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- AMENITY_IMAGENES (sin constructora_id propio, va por join)
DROP POLICY IF EXISTS "amenity_imagenes_tenant" ON amenity_imagenes;
CREATE POLICY "amenity_imagenes_tenant" ON amenity_imagenes
  FOR ALL TO authenticated
  USING (
    amenity_id IN (
      SELECT id FROM amenities WHERE constructora_id IN (SELECT mis_constructoras())
    )
  )
  WITH CHECK (
    amenity_id IN (
      SELECT id FROM amenities WHERE constructora_id IN (SELECT mis_constructoras())
    )
  );

-- CUENTAS_PROPIAS
DROP POLICY IF EXISTS "cuentas_propias_tenant" ON cuentas_propias;
CREATE POLICY "cuentas_propias_tenant" ON cuentas_propias
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- PROVEEDORES
DROP POLICY IF EXISTS "proveedores_tenant" ON proveedores;
CREATE POLICY "proveedores_tenant" ON proveedores
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- CUENTAS_PROVEEDOR (sin constructora_id propio, va por join)
DROP POLICY IF EXISTS "cuentas_proveedor_tenant" ON cuentas_proveedor;
CREATE POLICY "cuentas_proveedor_tenant" ON cuentas_proveedor
  FOR ALL TO authenticated
  USING (
    proveedor_id IN (
      SELECT id FROM proveedores WHERE constructora_id IN (SELECT mis_constructoras())
    )
  )
  WITH CHECK (
    proveedor_id IN (
      SELECT id FROM proveedores WHERE constructora_id IN (SELECT mis_constructoras())
    )
  );

-- CATEGORIAS_COSTO
DROP POLICY IF EXISTS "categorias_costo_tenant" ON categorias_costo;
CREATE POLICY "categorias_costo_tenant" ON categorias_costo
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- GASTOS
DROP POLICY IF EXISTS "gastos_tenant" ON gastos;
CREATE POLICY "gastos_tenant" ON gastos
  FOR ALL TO authenticated
  USING (constructora_id IN (SELECT mis_constructoras()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()));

-- PERFILES — simplificar: admin usa createAdminClient() que bypasea RLS.
--   Solo necesitamos que cada usuario vea su propio perfil.
DROP POLICY IF EXISTS "perfiles_mismo_tenant" ON perfiles;
DROP POLICY IF EXISTS "admin_edita_perfiles_tenant" ON perfiles;
