-- ============================================================
-- MIGRATION 045: datos fiscales/de facturación en constructoras.
--
-- Hasta ahora constructoras solo tenía nombre — nada para poder
-- facturarle la suscripción a la plataforma (CUIT, razón social) ni
-- para contactar al tenant fuera del panel (email/teléfono de
-- facturación, dirección). Primer paso hacia autogestión a futuro:
-- por ahora estos campos los carga/edita el superadmin a mano al
-- crear o editar una constructora — no hay flujo de signup público
-- todavía, eso es una decisión de producto más grande (plan, cobro
-- recurrente) que se resuelve aparte.
--
-- Todo NULLABLE a propósito: las constructoras existentes no tienen
-- estos datos cargados y no hay forma de inferirlos retroactivamente.
-- No se agrega ninguna policy RLS nueva — constructoras_owner_edita
-- (migration previa) ya permite que el propio admin de la constructora
-- edite su fila completa, así que estos campos quedan editables por
-- ese camino el día que se arme una pantalla de "datos de facturación"
-- en /admin sin tocar RLS.
-- ============================================================

ALTER TABLE constructoras ADD COLUMN IF NOT EXISTS razon_social TEXT;
ALTER TABLE constructoras ADD COLUMN IF NOT EXISTS cuit TEXT;
ALTER TABLE constructoras ADD COLUMN IF NOT EXISTS condicion_iva TEXT
  CHECK (condicion_iva IS NULL OR condicion_iva IN ('responsable_inscripto', 'monotributo', 'exento', 'consumidor_final'));
ALTER TABLE constructoras ADD COLUMN IF NOT EXISTS email_facturacion TEXT;
ALTER TABLE constructoras ADD COLUMN IF NOT EXISTS telefono_contacto TEXT;
ALTER TABLE constructoras ADD COLUMN IF NOT EXISTS direccion TEXT;
