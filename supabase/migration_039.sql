-- ============================================================
-- MIGRATION 039: índices faltantes en tablas que toca
-- purgar_obra_completa() — "Eliminar proyecto" tardaba tanto que
-- la conexión se cortaba del lado del cliente antes de recibir la
-- respuesta (aunque el borrado terminaba completándose igual del
-- lado del servidor, confirmado en vivo: el proyecto desaparecía
-- pero el modal seguía mostrando el error).
--
-- Causa: reservas, gastos, cuotas, amenity_imagenes, cuentas_propias
-- y presupuestos son tablas COMPARTIDAS por todos los tenants, y
-- purgar_obra_completa() borra (o deja en SET NULL) filas de estas
-- tablas filtrando por obra_id / por la FK hacia una fila que se
-- está borrando — sin índice, cada uno de esos pasos es un seq scan
-- de la tabla entera del sistema, no solo de las filas del proyecto.
-- Mismo motivo por el que migration_015 PASO 11 ya había indexado
-- contratos_obra/certificados_avance/cobros_proyecto en su momento;
-- estas quedaron afuera de esa pasada.
--
-- Idempotente (IF NOT EXISTS).
-- ============================================================

-- Recorridas directamente por DELETE ... WHERE obra_id = p_obra_id
CREATE INDEX IF NOT EXISTS idx_reservas_obra         ON reservas(obra_id);
CREATE INDEX IF NOT EXISTS idx_gastos_obra           ON gastos(obra_id);

-- Recorridas por el DELETE ... ON DELETE CASCADE al borrar el padre
-- (contratos_venta -> cuotas, amenities -> amenity_imagenes)
CREATE INDEX IF NOT EXISTS idx_cuotas_contrato           ON cuotas(contrato_id);
CREATE INDEX IF NOT EXISTS idx_amenity_imagenes_amenity  ON amenity_imagenes(amenity_id);

-- Recorridas por el UPDATE ... SET NULL implícito al borrar la obra /
-- el contrato_obra (FKs con ON DELETE SET NULL, a propósito no se
-- borran estas filas — ver comentario en purgar_obra_completa,
-- migration_033.sql)
CREATE INDEX IF NOT EXISTS idx_cuentas_propias_obra      ON cuentas_propias(obra_id);
CREATE INDEX IF NOT EXISTS idx_presupuestos_obra         ON presupuestos(obra_id);
CREATE INDEX IF NOT EXISTS idx_presupuestos_contrato_obra ON presupuestos(contrato_obra_id);
