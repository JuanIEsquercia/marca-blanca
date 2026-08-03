-- ------------------------------------------------------------
-- Auditoría de consistencia (4/4): cobros_proyecto.estado usaba
-- minúscula ('pendiente'/'cobrado') mientras gastos.estado y
-- cuotas.estado_pago usan mayúscula ('Pendiente'/'Pagado'). Se unifica
-- a 'Pendiente'/'Cobrado' (se mantiene el verbo propio de cobrar vs
-- pagar — solo se pareja el casing).
--
-- De paso: marcar_cuotas_vencidas() se elimina — es código muerto (nada
-- la llama, ni cron ni endpoint) y el tercer estado que persistía,
-- 'Vencido', contradice el criterio general del sistema (vencido
-- siempre se calcula al vuelo con estaVencido(), nunca se guarda). El
-- enum estado_pago NO se toca (dejar el valor 'Vencido' sin uso) —
-- borrar un valor de un ENUM en Postgres exige recrear el tipo entero
-- (no existe DROP VALUE), demasiado riesgo operativo para un valor que
-- ya nadie escribe.
-- ------------------------------------------------------------
-- El UPDATE de abajo dispara trg_cobros_proyecto_inmutable en cualquier
-- fila que ya esté 'cobrado' (protección para no-admins) — bypaseado acá
-- igual que en las purgas (purgar_obra_completa, etc.), porque este
-- SQL Editor no corre con una sesión de usuario/admin real.
SELECT set_config('app.bypass_inmutable', 'true', true);

ALTER TABLE cobros_proyecto DROP CONSTRAINT IF EXISTS cobros_proyecto_estado_check;
UPDATE cobros_proyecto SET estado = INITCAP(estado);
ALTER TABLE cobros_proyecto ALTER COLUMN estado SET DEFAULT 'Pendiente';
ALTER TABLE cobros_proyecto ADD CONSTRAINT cobros_proyecto_estado_check CHECK (estado IN ('Pendiente', 'Cobrado'));

DROP TRIGGER IF EXISTS trg_cobros_proyecto_inmutable ON cobros_proyecto;
CREATE TRIGGER trg_cobros_proyecto_inmutable
  BEFORE UPDATE OR DELETE ON cobros_proyecto
  FOR EACH ROW WHEN (OLD.estado = 'Cobrado')
  EXECUTE FUNCTION proteger_registro_financiero_terminal();

DROP FUNCTION IF EXISTS marcar_cuotas_vencidas();
