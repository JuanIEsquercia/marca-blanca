-- ============================================================
-- MIGRATION 033: purgar_obra_completa() — "Eliminar proyecto" nunca
-- borraba nada más que la fila de `obras`, dependiendo 100% de que
-- Postgres rechazara el DELETE por foreign key si había algo colgando.
-- Como casi ninguna tabla de proyecto tiene ON DELETE CASCADE desde
-- obras (a propósito, mismo criterio que purgar_constructora_completa:
-- evitar que un DELETE accidental destruya datos financieros en
-- cascada), en la práctica CUALQUIER proyecto con datos reales era
-- imposible de eliminar — y el mensaje de error mostrado al usuario
-- era un texto fijo ("unidades, ventas, cobros, etc") que no reflejaba
-- la tabla real que bloqueaba, confuso además para un proyecto tipo
-- Obra (que nunca tiene unidades/tipologías).
--
-- Esta función es el equivalente de purgar_obra_completa a
-- purgar_constructora_completa: borra explícitamente cada tabla en el
-- orden que exigen las FK reales, y recién al final borra la obra.
-- SECURITY INVOKER a propósito (no DEFINER) — el único caller real es
-- ProyectoAcciones.tsx, que ya solo muestra "Eliminar" a esAdmin, así
-- que las policies existentes (obras_admin_elimina, tiene_permiso_proyecto
-- con es_admin() como bypass) alcanzan solas para autorizar cada DELETE
-- sin duplicar ningún chequeo acá.
--
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION purgar_obra_completa(p_obra_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Desarrollo — orden exigido por las FK reales:
  -- contratos_venta/reservas referencian unidades (RESTRICT),
  -- unidades referencia tipologias (RESTRICT).
  DELETE FROM contratos_venta   WHERE obra_id = p_obra_id;  -- cuotas cae en cascada
  DELETE FROM reservas          WHERE obra_id = p_obra_id;
  DELETE FROM unidades          WHERE obra_id = p_obra_id;
  DELETE FROM tipologias        WHERE obra_id = p_obra_id;
  DELETE FROM amenities         WHERE obra_id = p_obra_id;  -- amenity_imagenes cae en cascada

  -- Obra (construcción) — certificados_avance/cobros_proyecto tienen
  -- su propio obra_id RESTRICT, no alcanza con que contratos_obra
  -- cascadee.
  DELETE FROM cobros_proyecto     WHERE obra_id = p_obra_id;
  DELETE FROM certificados_avance WHERE obra_id = p_obra_id;  -- certificado_items cae en cascada
  DELETE FROM contratos_obra      WHERE obra_id = p_obra_id;  -- contrato_obra_items cae en cascada

  -- Transversal a ambos tipos
  DELETE FROM equipo_asignaciones WHERE obra_id = p_obra_id;
  DELETE FROM gastos              WHERE obra_id = p_obra_id;

  -- cuentas_propias NO se borra a propósito: representa una cuenta
  -- bancaria/caja real con saldo_inicial, no un dato de ejecución del
  -- proyecto. Su FK (obra_id ON DELETE SET NULL) ya está pensada para
  -- que sobreviva desvinculada (pasa a ser cuenta de empresa) — acá
  -- simplemente no se la borra a mano, y ese SET NULL corre solo al
  -- llegar al DELETE FROM obras de más abajo. Mismo criterio para
  -- presupuestos.obra_id/.contrato_obra_id (también SET NULL): un
  -- presupuesto que originó este proyecto queda como registro
  -- histórico desvinculado, no se borra.

  DELETE FROM obras WHERE id = p_obra_id;
END;
$$;
