-- ============================================================
-- MIGRATION 050: hardening de search_path en funciones (linter de
-- Supabase, categoría function_search_path_mutable). Sin esto, una
-- función corre con el search_path de quien la llama — en teoría, si
-- alguna vez se le da CREATE en el schema public a un rol no confiable,
-- esa persona podría "sombrear" una tabla/función que la función usa
-- sin calificar de schema y hacer que corra código propio. Fijar
-- search_path=public en cada una cierra esa puerta sin tocar un solo
-- byte de lógica (ALTER FUNCTION no reescribe el body).
--
-- De yapa: aceptar_presupuesto quedó con DOS versiones viviendo en la
-- base. migration_031 la creó con 4 parámetros; migration_034 le agregó
-- p_modo_cuentas/p_replicar_cuentas — como cambió la firma,
-- CREATE OR REPLACE no reemplazó la anterior, creó un OVERLOAD nuevo.
-- La de 4 parámetros quedó viva y desactualizada (no tiene ninguna de
-- las reglas de migration_047/048). Hoy no se usa — el único call site
-- (components/admin/PresupuestosManager.tsx) siempre manda los 6
-- parámetros — pero es código muerto con lógica vieja que convenía
-- sacar de encima ahora que estamos giando por acá.
-- ============================================================

DROP FUNCTION IF EXISTS aceptar_presupuesto(UUID, UUID, TEXT, TEXT);

ALTER FUNCTION update_updated_at() SET search_path = public;
ALTER FUNCTION generar_cuotas_contrato() SET search_path = public;
ALTER FUNCTION marcar_cuotas_vencidas() SET search_path = public;
ALTER FUNCTION set_contrato_tenant() SET search_path = public;
ALTER FUNCTION set_reserva_tenant() SET search_path = public;
ALTER FUNCTION set_cuenta_proveedor_tenant() SET search_path = public;
ALTER FUNCTION set_auditoria_campos() SET search_path = public;
ALTER FUNCTION proteger_registro_financiero_terminal() SET search_path = public;
ALTER FUNCTION proteger_saldo_inicial() SET search_path = public;
ALTER FUNCTION proteger_cuota_pagada() SET search_path = public;
ALTER FUNCTION proteger_contrato_con_cobros() SET search_path = public;
ALTER FUNCTION proteger_columnas_sensibles_perfil() SET search_path = public;
ALTER FUNCTION bloquear_escritura_proyecto_cerrado() SET search_path = public;
ALTER FUNCTION bloquear_escritura_proyecto_cerrado_amenity() SET search_path = public;
ALTER FUNCTION bloquear_escritura_proyecto_cerrado_cuota() SET search_path = public;
ALTER FUNCTION asignar_numero_certificado() SET search_path = public;
ALTER FUNCTION asignar_numero_cobro_proyecto() SET search_path = public;
ALTER FUNCTION validar_monto_certificado() SET search_path = public;
ALTER FUNCTION validar_monto_certificado_item() SET search_path = public;
ALTER FUNCTION recalcular_monto_certificado() SET search_path = public;
ALTER FUNCTION proteger_contrato_obra_item() SET search_path = public;
ALTER FUNCTION proteger_certificado_item() SET search_path = public;
ALTER FUNCTION bloquear_escritura_proyecto_cerrado_contrato_item() SET search_path = public;
ALTER FUNCTION bloquear_escritura_proyecto_cerrado_certificado_item() SET search_path = public;
ALTER FUNCTION recalcular_monto_total_contrato() SET search_path = public;

ALTER FUNCTION seed_constructora_defaults(UUID) SET search_path = public;
ALTER FUNCTION sync_perfil_proyectos(UUID, UUID, JSONB) SET search_path = public;
ALTER FUNCTION resumen_unidades_por_obra(UUID[]) SET search_path = public;
ALTER FUNCTION aceptar_presupuesto(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) SET search_path = public;
ALTER FUNCTION asignar_equipo(UUID, UUID) SET search_path = public;
ALTER FUNCTION liberar_equipo(UUID, TEXT) SET search_path = public;
ALTER FUNCTION asignar_personal(UUID, UUID) SET search_path = public;
ALTER FUNCTION liberar_personal(UUID, TEXT) SET search_path = public;
ALTER FUNCTION asignar_cuadrilla(UUID, UUID) SET search_path = public;
ALTER FUNCTION obtener_o_crear_rubro(UUID, TEXT) SET search_path = public;
ALTER FUNCTION purgar_obra_completa(UUID) SET search_path = public;
