-- ============================================================
-- MIGRATION 022: Árbol de permisos por proyecto
--
-- Reemplaza el modelo de un solo perfiles.obra_id (migration_020)
-- por una tabla perfil_proyectos: un operador puede tener VARIOS
-- proyectos asignados, cada uno con su propio set de módulos.
--
-- perfiles.permisos deja de mezclar módulos de proyecto y de
-- empresa — a partir de acá solo contiene el bucket "Empresa"
-- (proveedores, tesoreria). Los módulos por-proyecto (tipologias,
-- amenities, unidades, reservas, contratos, certificados, cobros,
-- gastos, cuentas) viven en perfil_proyectos.permisos.
--
-- Se elimina el acceso implícito: permisos IS NULL ya NO significa
-- "sin restricción". El backfill de abajo migra a cada operador
-- existente a una lista explícita equivalente a lo que tenía, para
-- no cortarle el acceso.
--
-- gastos/cuentas_propias con obra_id IS NULL (gasto/cuenta
-- administrativa de la constructora, sin proyecto) pasan a ser
-- exclusivos del admin — decisión de producto explícita.
--
-- mi_obra_id() y perfiles.obra_id (de migration_020) NO se
-- eliminan en esta migración — quedan sin uso pero se dropean en
-- una migración de limpieza posterior, una vez confirmado en vivo
-- que esta funciona bien.
--
-- Idempotente — seguro de ejecutar múltiples veces (salvo el
-- backfill del PASO 5, que usa ON CONFLICT DO NOTHING y solo corre
-- una vez de forma efectiva).
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================


-- ============================================================
-- PASO 1: Tabla perfil_proyectos
-- ============================================================

CREATE TABLE IF NOT EXISTS perfil_proyectos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil_id       UUID NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  obra_id         UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  constructora_id UUID NOT NULL REFERENCES constructoras(id) ON DELETE CASCADE,
  permisos        TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (perfil_id, obra_id)
);

CREATE INDEX IF NOT EXISTS idx_perfil_proyectos_perfil       ON perfil_proyectos(perfil_id);
CREATE INDEX IF NOT EXISTS idx_perfil_proyectos_obra         ON perfil_proyectos(obra_id);
CREATE INDEX IF NOT EXISTS idx_perfil_proyectos_constructora ON perfil_proyectos(constructora_id);

ALTER TABLE perfil_proyectos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "perfil_proyectos_propio_lee" ON perfil_proyectos;
CREATE POLICY "perfil_proyectos_propio_lee" ON perfil_proyectos
  FOR SELECT TO authenticated USING (perfil_id = auth.uid());


-- ============================================================
-- PASO 2: Funciones de permisos
-- ============================================================

-- Bucket Empresa únicamente (proveedores/tesoreria) — ya no lee
-- "permisos IS NULL = sin restricción" (acceso implícito eliminado).
CREATE OR REPLACE FUNCTION tiene_permiso(p_modulo TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT es_admin() OR COALESCE(
    (SELECT p_modulo = ANY(permisos) FROM perfiles WHERE id = auth.uid()),
    false
  )
$$;

-- Módulo dentro de UN proyecto específico.
CREATE OR REPLACE FUNCTION tiene_permiso_proyecto(p_obra_id UUID, p_modulo TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT es_admin() OR EXISTS (
    SELECT 1 FROM perfil_proyectos
    WHERE perfil_id = auth.uid()
      AND obra_id = p_obra_id
      AND p_modulo = ANY(permisos)
  )
$$;

-- Módulo en CUALQUIERA de los proyectos asignados — para tablas sin
-- obra_id propio que dependen de un módulo por-proyecto (categorias_costo,
-- compradores) y para la lectura del pool de cuentas compartidas.
CREATE OR REPLACE FUNCTION tiene_permiso_en_algun_proyecto(p_modulo TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT es_admin() OR EXISTS (
    SELECT 1 FROM perfil_proyectos
    WHERE perfil_id = auth.uid() AND p_modulo = ANY(permisos)
  )
$$;


-- ============================================================
-- PASO 3: Backfill — migrar el estado actual (obra_id + permisos
-- planos de migration_020) a perfil_proyectos, antes de reescribir
-- las policies que dependen del modelo viejo.
--
-- migration_020.sql agregaba perfiles.obra_id, pero en la práctica nunca
-- se corrió contra la base real (confirmado: la columna no existía). Se
-- agrega acá mismo, idéntico a como la definía 020, para que el backfill
-- de abajo sea válido sin importar el estado real de esa migración.
-- ============================================================

ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS obra_id UUID REFERENCES obras(id) ON DELETE SET NULL;

-- 3a. Operadores acotados a un proyecto (obra_id IS NOT NULL).
INSERT INTO perfil_proyectos (perfil_id, obra_id, constructora_id, permisos)
SELECT
  p.id, p.obra_id, p.constructora_id,
  COALESCE(
    (SELECT array_agg(m) FROM unnest(p.permisos) AS m WHERE m NOT IN ('proveedores', 'tesoreria')),
    '{}'::text[]
  )
FROM perfiles p
WHERE p.rol = 'operador' AND p.obra_id IS NOT NULL AND p.permisos IS NOT NULL
ON CONFLICT (perfil_id, obra_id) DO NOTHING;

-- 3b. Operadores "toda la empresa" con permisos explícitos (obra_id NULL,
-- permisos NOT NULL) — replican el módulo en TODOS los proyectos de su
-- constructora, igual que su comportamiento actual.
INSERT INTO perfil_proyectos (perfil_id, obra_id, constructora_id, permisos)
SELECT
  p.id, o.id, p.constructora_id,
  COALESCE(
    (SELECT array_agg(m) FROM unnest(p.permisos) AS m WHERE m NOT IN ('proveedores', 'tesoreria')),
    '{}'::text[]
  )
FROM perfiles p
JOIN obras o ON o.constructora_id = p.constructora_id
WHERE p.rol = 'operador' AND p.obra_id IS NULL AND p.permisos IS NOT NULL
ON CONFLICT (perfil_id, obra_id) DO NOTHING;

-- 3c. Operadores legado sin restricción (permisos IS NULL) — se les da
-- acceso explícito equivalente: todos los módulos por-proyecto en todos
-- los proyectos de su constructora (inerte para el tipo que no aplica,
-- ej. 'certificados' en un desarrollo no calza ninguna fila) + el bucket
-- Empresa completo.
INSERT INTO perfil_proyectos (perfil_id, obra_id, constructora_id, permisos)
SELECT
  p.id, o.id, p.constructora_id,
  ARRAY['tipologias','amenities','unidades','reservas','contratos','certificados','cobros','gastos','cuentas']
FROM perfiles p
JOIN obras o ON o.constructora_id = p.constructora_id
WHERE p.rol = 'operador' AND p.permisos IS NULL
ON CONFLICT (perfil_id, obra_id) DO NOTHING;

UPDATE perfiles SET permisos = ARRAY['proveedores', 'tesoreria']
WHERE rol = 'operador' AND permisos IS NULL;

-- 3d. perfiles.permisos de TODOS los operadores queda acotado al bucket
-- Empresa (los módulos de proyecto que tenían mezclados ya se migraron
-- arriba a perfil_proyectos).
UPDATE perfiles p
SET permisos = COALESCE(
  (SELECT array_agg(m) FROM unnest(p.permisos) AS m WHERE m IN ('proveedores', 'tesoreria')),
  '{}'::text[]
)
WHERE rol = 'operador' AND permisos IS NOT NULL;


-- ============================================================
-- PASO 4: Reescritura de RLS — de mi_obra_id()/tiene_permiso('X') plano
-- a tiene_permiso_proyecto(obra_id, 'X').
-- ============================================================

DROP POLICY IF EXISTS "obras_tenant" ON obras;
CREATE POLICY "obras_tenant" ON obras
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND (es_admin() OR EXISTS (SELECT 1 FROM perfil_proyectos WHERE perfil_id = auth.uid() AND obra_id = obras.id)))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND (es_admin() OR EXISTS (SELECT 1 FROM perfil_proyectos WHERE perfil_id = auth.uid() AND obra_id = obras.id)));

DROP POLICY IF EXISTS "tipologias_tenant" ON tipologias;
CREATE POLICY "tipologias_tenant" ON tipologias
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'tipologias'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'tipologias'));

DROP POLICY IF EXISTS "unidades_tenant" ON unidades;
CREATE POLICY "unidades_tenant" ON unidades
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'unidades'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'unidades'));

DROP POLICY IF EXISTS "amenities_tenant" ON amenities;
CREATE POLICY "amenities_tenant" ON amenities
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'amenities'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'amenities'));

DROP POLICY IF EXISTS "amenity_imagenes_tenant" ON amenity_imagenes;
CREATE POLICY "amenity_imagenes_tenant" ON amenity_imagenes
  FOR ALL TO authenticated
  USING (
    amenity_id IN (
      SELECT id FROM amenities a
      WHERE a.constructora_id IN (SELECT mis_constructoras())
        AND tiene_permiso_proyecto(a.obra_id, 'amenities')
    )
  )
  WITH CHECK (
    amenity_id IN (
      SELECT id FROM amenities a
      WHERE a.constructora_id IN (SELECT mis_constructoras())
        AND tiene_permiso_proyecto(a.obra_id, 'amenities')
    )
  );

-- compradores: entidad compartida sin obra_id propio — basta con tener
-- alguno de los 3 módulos en CUALQUIER proyecto asignado.
DROP POLICY IF EXISTS "compradores_tenant" ON compradores;
CREATE POLICY "compradores_tenant" ON compradores
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras())
    AND (tiene_permiso_en_algun_proyecto('reservas') OR tiene_permiso_en_algun_proyecto('contratos') OR tiene_permiso_en_algun_proyecto('certificados'))
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras())
    AND (tiene_permiso_en_algun_proyecto('reservas') OR tiene_permiso_en_algun_proyecto('contratos') OR tiene_permiso_en_algun_proyecto('certificados'))
  );

DROP POLICY IF EXISTS "contratos_tenant" ON contratos_venta;
CREATE POLICY "contratos_tenant" ON contratos_venta
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'contratos'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'contratos'));

-- cuotas no tiene columna obra_id propia — cuelga de contratos_venta.
DROP POLICY IF EXISTS "cuotas_tenant" ON cuotas;
CREATE POLICY "cuotas_tenant" ON cuotas
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras())
    AND contrato_id IN (SELECT id FROM contratos_venta cv WHERE tiene_permiso_proyecto(cv.obra_id, 'contratos'))
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras())
    AND contrato_id IN (SELECT id FROM contratos_venta cv WHERE tiene_permiso_proyecto(cv.obra_id, 'contratos'))
  );

DROP POLICY IF EXISTS "reservas_tenant" ON reservas;
CREATE POLICY "reservas_tenant" ON reservas
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'reservas'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'reservas'));

-- cuentas_propias: obra_id NULL es el pool compartido de la empresa.
-- Lectura permitida a cualquiera con 'cuentas' en ALGÚN proyecto (lo
-- necesitan las páginas de proyecto en modo_cuentas='empresa'); escritura
-- de filas sin proyecto queda solo para admin.
DROP POLICY IF EXISTS "cuentas_propias_tenant" ON cuentas_propias;
CREATE POLICY "cuentas_propias_tenant" ON cuentas_propias
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras()) AND (
      (obra_id IS NULL AND (es_admin() OR tiene_permiso_en_algun_proyecto('cuentas')))
      OR (obra_id IS NOT NULL AND tiene_permiso_proyecto(obra_id, 'cuentas'))
    )
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras()) AND (
      (obra_id IS NULL AND es_admin())
      OR (obra_id IS NOT NULL AND tiene_permiso_proyecto(obra_id, 'cuentas'))
    )
  );

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

-- categorias_costo: sin obra_id propio, gateada por 'gastos' en cualquier proyecto.
DROP POLICY IF EXISTS "categorias_costo_tenant" ON categorias_costo;
CREATE POLICY "categorias_costo_tenant" ON categorias_costo
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_en_algun_proyecto('gastos'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_en_algun_proyecto('gastos'));

-- gastos: obra_id NULL = gasto administrativo de la constructora, solo admin
-- (las páginas de proyecto solo leen filas con obra_id = esa obra, nunca NULL).
DROP POLICY IF EXISTS "gastos_tenant" ON gastos;
CREATE POLICY "gastos_tenant" ON gastos
  FOR ALL TO authenticated
  USING (
    constructora_id IN (SELECT mis_constructoras()) AND (
      (obra_id IS NULL AND es_admin())
      OR (obra_id IS NOT NULL AND tiene_permiso_proyecto(obra_id, 'gastos'))
    )
  )
  WITH CHECK (
    constructora_id IN (SELECT mis_constructoras()) AND (
      (obra_id IS NULL AND es_admin())
      OR (obra_id IS NOT NULL AND tiene_permiso_proyecto(obra_id, 'gastos'))
    )
  );

DROP POLICY IF EXISTS "contratos_obra_tenant" ON contratos_obra;
CREATE POLICY "contratos_obra_tenant" ON contratos_obra
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'certificados'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'certificados'));

DROP POLICY IF EXISTS "certificados_avance_tenant" ON certificados_avance;
CREATE POLICY "certificados_avance_tenant" ON certificados_avance
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'certificados'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'certificados'));

DROP POLICY IF EXISTS "cobros_proyecto_tenant" ON cobros_proyecto;
CREATE POLICY "cobros_proyecto_tenant" ON cobros_proyecto
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'cobros'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso_proyecto(obra_id, 'cobros'));


-- ============================================================
-- PASO 5: RPC transaccional para reemplazar el árbol de un operador
-- desde la API de administración (evita el riesgo de un DELETE+INSERT
-- hecho como dos llamadas separadas desde JS).
-- ============================================================

CREATE OR REPLACE FUNCTION sync_perfil_proyectos(p_perfil_id UUID, p_constructora_id UUID, p_rows JSONB)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM perfil_proyectos WHERE perfil_id = p_perfil_id;

  INSERT INTO perfil_proyectos (perfil_id, obra_id, constructora_id, permisos)
  SELECT
    p_perfil_id,
    (r->>'obraId')::UUID,
    p_constructora_id,
    ARRAY(SELECT jsonb_array_elements_text(r->'permisos'))
  FROM jsonb_array_elements(p_rows) AS r;
END;
$$;

-- Igual que seed_constructora_defaults() — un RPC sin REVOKE es
-- llamable por cualquier usuario autenticado con datos ajenos. Solo
-- se invoca desde la API route vía createAdminClient() (service role),
-- que ya verificó rol='admin' antes.
REVOKE EXECUTE ON FUNCTION sync_perfil_proyectos(UUID, UUID, JSONB) FROM PUBLIC, authenticated;


-- ============================================================
-- PASO 6: Índices adicionales
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_perfiles_permisos_gin ON perfiles USING GIN (permisos);
