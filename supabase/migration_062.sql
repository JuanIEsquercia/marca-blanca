-- ------------------------------------------------------------
-- Acopios: crédito prepago con un proveedor, denominado en la cantidad
-- de un "producto de referencia" (kg de acero, unidades de ladrillo,
-- lo que sea) — no en pesos, para no perder poder de compra cuando ese
-- producto sube de precio. Vive dentro de Compras, en paralelo a
-- ordenes_compra (esa tabla asume que sabés de antemano qué pedís; un
-- acopio es plata ya pagada que se define en qué se convierte después).
--
-- La conversión de un retiro es una sola fórmula para los dos casos:
--   - si el producto retirado ES el de referencia del acopio, se
--     descuenta 1 a 1 (los precios ni se piden).
--   - si es OTRO producto, se exige el precio de hoy de ambos y se
--     convierte: cantidad_descontada = (cantidad × precio_retiro) ÷ precio_referencia.
-- Esto es justo lo que hace un proveedor cuando indexa un acopio de
-- acero a otro material: convierte a precio de hoy de los dos lados.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS acopios (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id        UUID NOT NULL REFERENCES constructoras(id),
  obra_id                UUID REFERENCES obras(id),
  proveedor_id           UUID NOT NULL REFERENCES proveedores(id),
  producto_referencia_id UUID NOT NULL REFERENCES productos(id),
  numero                 INTEGER NOT NULL,
  saldo_inicial          NUMERIC(15,2) NOT NULL CHECK (saldo_inicial > 0),
  monto_pagado           NUMERIC(15,2) NOT NULL,
  moneda                 TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
  fecha                  DATE NOT NULL DEFAULT CURRENT_DATE,
  gasto_id               UUID REFERENCES gastos(id) ON DELETE SET NULL,
  estado                 TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'cerrado')),
  notas                  TEXT,
  created_by             UUID REFERENCES auth.users(id),
  updated_by             UUID REFERENCES auth.users(id),
  updated_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (constructora_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_acopios_constructora ON acopios(constructora_id);
CREATE INDEX IF NOT EXISTS idx_acopios_obra         ON acopios(obra_id);
CREATE INDEX IF NOT EXISTS idx_acopios_proveedor     ON acopios(proveedor_id);

-- "Cuánto queda" nunca se guarda — se calcula sumando acopio_retiros
-- (mismo criterio que stock_movimientos/resumen_stock).
CREATE TABLE IF NOT EXISTS acopio_retiros (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acopio_id                      UUID NOT NULL REFERENCES acopios(id) ON DELETE CASCADE,
  constructora_id                UUID NOT NULL REFERENCES constructoras(id),
  producto_id                    UUID NOT NULL REFERENCES productos(id),
  cantidad                       NUMERIC(15,2) NOT NULL CHECK (cantidad > 0),
  precio_unitario_retiro         NUMERIC(15,2),  -- NULL cuando producto_id = producto de referencia del acopio (no hace falta)
  precio_unitario_referencia     NUMERIC(15,2),
  cantidad_referencia_descontada NUMERIC(15,2) NOT NULL,  -- fijo al momento del retiro, no se recalcula después
  obra_id                        UUID REFERENCES obras(id),
  fecha                          DATE NOT NULL DEFAULT CURRENT_DATE,
  notas                          TEXT,
  created_by                     UUID REFERENCES auth.users(id),
  created_at                     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acopio_retiros_acopio       ON acopio_retiros(acopio_id);
CREATE INDEX IF NOT EXISTS idx_acopio_retiros_constructora ON acopio_retiros(constructora_id);
CREATE INDEX IF NOT EXISTS idx_acopio_retiros_producto     ON acopio_retiros(producto_id);
CREATE INDEX IF NOT EXISTS idx_acopio_retiros_obra         ON acopio_retiros(obra_id);

-- Cada retiro genera stock real, igual que una recepción de compra —
-- mismo patrón que origen_recepcion_id.
ALTER TABLE stock_movimientos
  ADD COLUMN IF NOT EXISTS origen_acopio_retiro_id UUID REFERENCES acopio_retiros(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- Tenant + numeración (mismos patrones que orden_compra_items /
-- asignar_numero_orden_compra)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_acopio_retiro_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.constructora_id IS NULL THEN
    SELECT constructora_id INTO NEW.constructora_id FROM acopios WHERE id = NEW.acopio_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_acopio_retiro_tenant ON acopio_retiros;
CREATE TRIGGER trg_acopio_retiro_tenant
  BEFORE INSERT ON acopio_retiros
  FOR EACH ROW EXECUTE FUNCTION set_acopio_retiro_tenant();

CREATE OR REPLACE FUNCTION asignar_numero_acopio()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('acopios:' || NEW.constructora_id::text));
  SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
  FROM acopios WHERE constructora_id = NEW.constructora_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asignar_numero_acopio ON acopios;
CREATE TRIGGER trg_asignar_numero_acopio
  BEFORE INSERT ON acopios
  FOR EACH ROW EXECUTE FUNCTION asignar_numero_acopio();

-- ------------------------------------------------------------
-- registrar_retiro_acopio(): la única lógica de negocio real. SECURITY
-- INVOKER a propósito (mismo criterio que confirmar_recepcion_compra/
-- repartir_stock) — corre bajo el RLS real de quien llama.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION registrar_retiro_acopio(
  p_acopio_id UUID,
  p_producto_id UUID,
  p_cantidad NUMERIC,
  p_precio_retiro NUMERIC DEFAULT NULL,
  p_precio_referencia NUMERIC DEFAULT NULL,
  p_obra_id UUID DEFAULT NULL,
  p_notas TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_acopio              acopios%ROWTYPE;
  v_cantidad_descontada NUMERIC(15,2);
  v_retiro_id           UUID;
BEGIN
  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad retirada debe ser mayor a cero';
  END IF;

  SELECT * INTO v_acopio FROM acopios WHERE id = p_acopio_id;
  IF v_acopio.id IS NULL THEN
    RAISE EXCEPTION 'Acopio no encontrado';
  END IF;

  IF p_producto_id = v_acopio.producto_referencia_id THEN
    v_cantidad_descontada := p_cantidad;
  ELSE
    IF p_precio_retiro IS NULL OR p_precio_retiro <= 0 OR p_precio_referencia IS NULL OR p_precio_referencia <= 0 THEN
      RAISE EXCEPTION 'Para retirar un producto distinto al de referencia hace falta el precio de hoy de los dos';
    END IF;
    v_cantidad_descontada := (p_cantidad * p_precio_retiro) / p_precio_referencia;
  END IF;

  INSERT INTO acopio_retiros (
    acopio_id, constructora_id, producto_id, cantidad, precio_unitario_retiro,
    precio_unitario_referencia, cantidad_referencia_descontada, obra_id, notas, created_by
  )
  VALUES (
    p_acopio_id, v_acopio.constructora_id, p_producto_id, p_cantidad, p_precio_retiro,
    p_precio_referencia, v_cantidad_descontada, p_obra_id, p_notas, auth.uid()
  )
  RETURNING id INTO v_retiro_id;

  INSERT INTO stock_movimientos (constructora_id, producto_id, obra_id, tipo, cantidad, origen_acopio_retiro_id, created_by)
  VALUES (v_acopio.constructora_id, p_producto_id, p_obra_id, 'entrada', p_cantidad, v_retiro_id, auth.uid());

  RETURN v_retiro_id;
END;
$$;

-- Agregado en Postgres (no traer todos los retiros al cliente solo para
-- sumarlos) — mismo criterio que resumen_stock.
CREATE OR REPLACE FUNCTION resumen_acopios(p_constructora_id UUID)
RETURNS TABLE(acopio_id UUID, saldo_actual NUMERIC)
LANGUAGE sql
STABLE
AS $$
  SELECT
    a.id,
    a.saldo_inicial - COALESCE(SUM(r.cantidad_referencia_descontada), 0)
  FROM acopios a
  LEFT JOIN acopio_retiros r ON r.acopio_id = a.id
  WHERE a.constructora_id = p_constructora_id
  GROUP BY a.id, a.saldo_inicial;
$$;

ALTER FUNCTION set_acopio_retiro_tenant() SET search_path = public;
ALTER FUNCTION asignar_numero_acopio() SET search_path = public;
ALTER FUNCTION registrar_retiro_acopio(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT) SET search_path = public;
ALTER FUNCTION resumen_acopios(UUID) SET search_path = public;

-- ------------------------------------------------------------
-- RLS — mismo patrón que el resto de Compras (tiene_permiso('compras')).
-- ------------------------------------------------------------
ALTER TABLE acopios        ENABLE ROW LEVEL SECURITY;
ALTER TABLE acopio_retiros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acopios_tenant" ON acopios;
CREATE POLICY "acopios_tenant" ON acopios
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'));

DROP POLICY IF EXISTS "acopio_retiros_tenant" ON acopio_retiros;
CREATE POLICY "acopio_retiros_tenant" ON acopio_retiros
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'));

-- ------------------------------------------------------------
-- Purgas: sumar acopios/acopio_retiros (antes de borrar productos/
-- proveedores/gastos, que los referencian).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION purgar_constructora_completa(p_constructora_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM acopio_retiros    WHERE constructora_id = p_constructora_id;
  DELETE FROM acopios           WHERE constructora_id = p_constructora_id;
  DELETE FROM stock_movimientos WHERE constructora_id = p_constructora_id;
  DELETE FROM ordenes_compra    WHERE constructora_id = p_constructora_id;
  DELETE FROM productos         WHERE constructora_id = p_constructora_id;

  DELETE FROM cobros_proyecto   WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_obra    WHERE constructora_id = p_constructora_id;
  DELETE FROM presupuestos      WHERE constructora_id = p_constructora_id;
  DELETE FROM equipos           WHERE constructora_id = p_constructora_id;
  DELETE FROM personal          WHERE constructora_id = p_constructora_id;
  DELETE FROM cuadrillas        WHERE constructora_id = p_constructora_id;
  DELETE FROM rubros            WHERE constructora_id = p_constructora_id;
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

REVOKE EXECUTE ON FUNCTION purgar_constructora_completa(UUID) FROM PUBLIC, authenticated, anon;

CREATE OR REPLACE FUNCTION purgar_obra_completa(p_obra_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM acopio_retiros    WHERE obra_id = p_obra_id;
  DELETE FROM acopios           WHERE obra_id = p_obra_id;
  DELETE FROM stock_movimientos WHERE obra_id = p_obra_id;
  DELETE FROM ordenes_compra    WHERE obra_id = p_obra_id;

  DELETE FROM contratos_venta   WHERE obra_id = p_obra_id;
  DELETE FROM reservas          WHERE obra_id = p_obra_id;
  DELETE FROM unidades          WHERE obra_id = p_obra_id;
  DELETE FROM tipologias        WHERE obra_id = p_obra_id;
  DELETE FROM amenities         WHERE obra_id = p_obra_id;

  DELETE FROM cobros_proyecto     WHERE obra_id = p_obra_id;
  DELETE FROM certificados_avance WHERE obra_id = p_obra_id;
  DELETE FROM contratos_obra      WHERE obra_id = p_obra_id;

  DELETE FROM equipo_asignaciones   WHERE obra_id = p_obra_id;
  DELETE FROM personal_asignaciones WHERE obra_id = p_obra_id;
  DELETE FROM gastos                WHERE obra_id = p_obra_id;

  -- cuentas_propias NO se borra: su FK (obra_id ON DELETE SET NULL) la
  -- desvincula sola al llegar al DELETE FROM obras — sobrevive como
  -- cuenta de empresa en vez de perderse (representa un saldo_inicial
  -- real, no un dato de ejecución del proyecto).

  DELETE FROM obras WHERE id = p_obra_id;
END;
$$;
