-- ============================================================
-- MIGRATION 018: Purga real de constructora
-- El modal de "Eliminar constructora" en /superadmin ya prometía
-- "elimina la constructora, todos sus usuarios y todos sus datos" —
-- pero el backend solo intentaba DELETE FROM constructoras directo.
-- Casi ninguna tabla hija tiene ON DELETE CASCADE hacia obras/
-- constructoras (a propósito: evita que borrar una obra por error
-- destruya datos financieros en cascada) así que ese DELETE directo
-- siempre fallaba con datos reales, dejando el botón inservible.
--
-- Esta función hace el purgado explícito, en el orden correcto según
-- las FK reales del schema, dentro de una sola transacción (atómico:
-- si algo falla, no queda a mitad de camino). SECURITY DEFINER +
-- revocado de authenticated/anon (mismo patrón que
-- seed_constructora_defaults) — solo se llama server-side con el
-- admin client desde app/api/superadmin/constructoras/route.ts,
-- después de que verifySuperAdmin() ya confirmó al caller.
-- Idempotente — seguro de ejecutar múltiples veces.
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================

CREATE OR REPLACE FUNCTION purgar_constructora_completa(p_constructora_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Orden: hijos antes que padres, según las FK reales (varias son
  -- RESTRICT a propósito para el uso normal de la app — acá se borra
  -- todo explícitamente en el orden que esas mismas FK exigen).
  DELETE FROM cobros_proyecto   WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_obra    WHERE constructora_id = p_constructora_id;  -- cascada: certificados_avance
  DELETE FROM contratos_venta   WHERE constructora_id = p_constructora_id;  -- cascada: cuotas
  DELETE FROM reservas          WHERE constructora_id = p_constructora_id;
  DELETE FROM gastos            WHERE constructora_id = p_constructora_id;
  DELETE FROM compradores       WHERE constructora_id = p_constructora_id;
  DELETE FROM unidades          WHERE constructora_id = p_constructora_id;
  DELETE FROM proveedores       WHERE constructora_id = p_constructora_id;  -- cascada: cuentas_proveedor
  DELETE FROM categorias_costo  WHERE constructora_id = p_constructora_id;
  DELETE FROM cuentas_propias   WHERE constructora_id = p_constructora_id;
  DELETE FROM tipologias        WHERE constructora_id = p_constructora_id;
  DELETE FROM amenities         WHERE constructora_id = p_constructora_id;  -- cascada: amenity_imagenes
  DELETE FROM auditoria         WHERE constructora_id = p_constructora_id;
  DELETE FROM constructoras     WHERE id = p_constructora_id;               -- cascada: obras, miembros
  -- perfiles queda con constructora_id NULL (ON DELETE SET NULL) — el
  -- caller (route handler) borra esas filas de perfiles + los usuarios
  -- de auth por separado, usando la lista de ids que capturó ANTES de
  -- llamar a esta función.
END;
$$;

REVOKE EXECUTE ON FUNCTION purgar_constructora_completa(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION purgar_constructora_completa(UUID) FROM anon;


-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- Como cualquier autenticado: SELECT purgar_constructora_completa('<uuid>') debe fallar con "permission denied".
-- Desde el admin client (service role) contra una constructora de prueba con datos reales:
--   SELECT purgar_constructora_completa('<uuid-constructora-test>');
--   Después: SELECT count(*) FROM obras WHERE constructora_id = '<uuid-constructora-test>'; -- 0
--   SELECT count(*) FROM constructoras WHERE id = '<uuid-constructora-test>'; -- 0
