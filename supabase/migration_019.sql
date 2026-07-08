-- ============================================================
-- MIGRATION 019: Fix — purgar_constructora_completa bloqueada por
-- los triggers de inmutabilidad financiera
--
-- proteger_registro_financiero_terminal() (migration_015) exige
-- es_admin() para poder DELETE/UPDATE certificados aprobados, cobros
-- cobrados o gastos pagados. es_admin() lee auth.uid() — pero
-- purgar_constructora_completa() se llama vía RPC con el service role,
-- sin un usuario autenticado real, así que auth.uid() es NULL y
-- es_admin() da false. Resultado: la purga fallaba (transacción
-- abortada completa) apenas la constructora tenía un solo registro en
-- alguno de esos tres estados "terminales" — exactamente lo esperable
-- en una constructora usada para probar el flujo de certificados/cobros.
--
-- Fix: un flag de sesión (set_config, transaction-local) que la purga
-- activa antes de borrar, y que el trigger respeta para saltarse el
-- chequeo de es_admin() SOLO en ese contexto administrativo puntual —
-- el resto de la app (operadores/admins normales editando/borrando vía
-- RLS) sigue exactamente igual que antes.
-- Idempotente — seguro de ejecutar múltiples veces.
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ============================================================

CREATE OR REPLACE FUNCTION proteger_registro_financiero_terminal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF es_admin() OR current_setting('app.bypass_inmutable', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'No se puede eliminar: el registro ya está % y solo un admin puede modificarlo.', OLD.estado;
  END IF;

  RAISE EXCEPTION 'No se puede editar: el registro ya está % y solo un admin puede modificarlo.', OLD.estado;
END;
$$;

CREATE OR REPLACE FUNCTION purgar_constructora_completa(p_constructora_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- transaction-local (tercer argumento true) — se descarta solo al
  -- terminar la transacción de este RPC, no afecta nada más.
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM cobros_proyecto   WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_obra    WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_venta   WHERE constructora_id = p_constructora_id;
  DELETE FROM reservas          WHERE constructora_id = p_constructora_id;
  DELETE FROM gastos            WHERE constructora_id = p_constructora_id;
  DELETE FROM compradores       WHERE constructora_id = p_constructora_id;
  DELETE FROM unidades          WHERE constructora_id = p_constructora_id;
  DELETE FROM proveedores       WHERE constructora_id = p_constructora_id;
  DELETE FROM categorias_costo  WHERE constructora_id = p_constructora_id;
  DELETE FROM cuentas_propias   WHERE constructora_id = p_constructora_id;
  DELETE FROM tipologias        WHERE constructora_id = p_constructora_id;
  DELETE FROM amenities         WHERE constructora_id = p_constructora_id;
  DELETE FROM auditoria         WHERE constructora_id = p_constructora_id;
  DELETE FROM constructoras     WHERE id = p_constructora_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION purgar_constructora_completa(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION purgar_constructora_completa(UUID) FROM anon;


-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- Contra una constructora de prueba que tenga al menos un certificado
-- 'aprobado', un cobro 'cobrado' o un gasto 'Pagado':
--   SELECT purgar_constructora_completa('<uuid-constructora-test>');
-- Debe completar sin error esta vez.
