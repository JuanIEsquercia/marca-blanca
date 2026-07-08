-- ============================================================
-- MIGRATION 020: Alcance por proyecto en los permisos de operador
--
-- Hoy perfiles.permisos es un array de módulos aplicado a TODA la
-- constructora — un operador con 'gastos' ve/edita los gastos de
-- todos los proyectos, incluso los administrativos de la empresa.
-- No hay forma de decir "este operador solo existe para la Obra X".
--
-- Se agrega perfiles.obra_id (nullable). NULL = operador de toda la
-- empresa (comportamiento actual, sin cambios — cero regresión para
-- operadores existentes). Un valor = acotado a esa obra: las tablas
-- con columna obra_id propia solo muestran/aceptan filas de esa obra.
--
-- proveedores/cuentas_proveedor/categorias_costo/compradores quedan
-- SIN scoping por obra a propósito — son datos de referencia
-- compartidos entre proyectos (no tienen columna obra_id).
-- Idempotente — seguro de ejecutar múltiples veces.
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================


-- ============================================================
-- PASO 1: Columna + función helper
-- ============================================================

ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS obra_id UUID REFERENCES obras(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_perfiles_obra ON perfiles(obra_id);

-- NULL para admins siempre (aunque por error tuvieran algo cargado) y
-- para operadores "de toda la empresa". Un valor = acotado a esa obra.
CREATE OR REPLACE FUNCTION mi_obra_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN rol = 'admin' THEN NULL ELSE obra_id END FROM perfiles WHERE id = auth.uid()
$$;


-- ============================================================
-- PASO 2: obras — un operador acotado solo ve/toca su propia obra
-- ============================================================

DROP POLICY IF EXISTS "obras_tenant" ON obras;
CREATE POLICY "obras_tenant" ON obras
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND (mi_obra_id() IS NULL OR id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND (mi_obra_id() IS NULL OR id = mi_obra_id()));


-- ============================================================
-- PASO 3: tablas con columna obra_id propia — mismo patrón
-- ============================================================

DROP POLICY IF EXISTS "tipologias_tenant" ON tipologias;
CREATE POLICY "tipologias_tenant" ON tipologias
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('tipologias') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('tipologias') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "unidades_tenant" ON unidades;
CREATE POLICY "unidades_tenant" ON unidades
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('unidades') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('unidades') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "amenities_tenant" ON amenities;
CREATE POLICY "amenities_tenant" ON amenities
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('amenities') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('amenities') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "contratos_tenant" ON contratos_venta;
CREATE POLICY "contratos_tenant" ON contratos_venta
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('contratos') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('contratos') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "reservas_tenant" ON reservas;
CREATE POLICY "reservas_tenant" ON reservas
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('reservas') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('reservas') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "gastos_tenant" ON gastos;
CREATE POLICY "gastos_tenant" ON gastos
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('gastos') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('gastos') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "cuentas_propias_tenant" ON cuentas_propias;
CREATE POLICY "cuentas_propias_tenant" ON cuentas_propias
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('cuentas') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('cuentas') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "contratos_obra_tenant" ON contratos_obra;
CREATE POLICY "contratos_obra_tenant" ON contratos_obra
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('certificados') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('certificados') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "certificados_avance_tenant" ON certificados_avance;
CREATE POLICY "certificados_avance_tenant" ON certificados_avance
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('certificados') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('certificados') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));

DROP POLICY IF EXISTS "cobros_proyecto_tenant" ON cobros_proyecto;
CREATE POLICY "cobros_proyecto_tenant" ON cobros_proyecto
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('cobros') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('cobros') AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id()));


-- ============================================================
-- PASO 4: tablas sin columna obra_id propia — scoping vía subquery
-- ============================================================

-- cuotas cuelga de contratos_venta, que sí tiene obra_id.
DROP POLICY IF EXISTS "cuotas_tenant" ON cuotas;
CREATE POLICY "cuotas_tenant" ON cuotas
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('contratos')
    AND (mi_obra_id() IS NULL OR contrato_id IN (SELECT id FROM contratos_venta WHERE obra_id = mi_obra_id()))
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('contratos')
    AND (mi_obra_id() IS NULL OR contrato_id IN (SELECT id FROM contratos_venta WHERE obra_id = mi_obra_id()))
  );

-- amenity_imagenes cuelga de amenities, que sí tiene obra_id.
DROP POLICY IF EXISTS "amenity_imagenes_tenant" ON amenity_imagenes;
CREATE POLICY "amenity_imagenes_tenant" ON amenity_imagenes
  FOR ALL TO authenticated
  USING (
    tiene_permiso('amenities') AND
    amenity_id IN (
      SELECT id FROM amenities
      WHERE constructora_id IN (SELECT mis_constructoras())
        AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id())
    )
  )
  WITH CHECK (
    tiene_permiso('amenities') AND
    amenity_id IN (
      SELECT id FROM amenities
      WHERE constructora_id IN (SELECT mis_constructoras())
        AND (mi_obra_id() IS NULL OR obra_id = mi_obra_id())
    )
  );


-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- UPDATE perfiles SET obra_id = '<uuid-obra-A>' WHERE id = '<uuid-operador-test>';
-- Como ese operador: SELECT * FROM gastos; -- solo filas de obra_id = A, ninguna con obra_id NULL u otra obra
-- INSERT INTO gastos (..., obra_id) VALUES (..., '<uuid-obra-B>'); -- debe fallar (RLS)
-- SELECT * FROM obras; -- una sola fila
-- UPDATE perfiles SET obra_id = NULL WHERE id = '<uuid-operador-test>'; -- vuelve a ver todo, como antes
