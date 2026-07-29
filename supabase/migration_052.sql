-- ============================================================
-- MIGRATION 052: módulo de Compras — órdenes de compra cumplidas de
-- a partes (posiblemente por más de un proveedor), y stock repartido
-- entre obras como ledger simple (mismo espíritu que lib/tesoreria.ts:
-- nunca se decrementa un contador, "cuánto hay" se calcula sumando
-- movimientos en el momento).
--
-- Módulo de Empresa (como Proveedores/Inventario/Personal): decidir qué
-- comprar y repartir necesita ver el panorama completo de la
-- constructora, no un solo proyecto. Se gatea con tiene_permiso('compras'),
-- no tiene_permiso_proyecto().
--
-- Piezas:
--   productos                    catálogo de insumos (clon de rubros)
--   ordenes_compra                cabecera — obra_id NULLABLE (NULL = "pool
--                                 de empresa", para repartir después)
--   orden_compra_items             qué se pidió (producto + cantidad)
--   orden_compra_recepciones       cada cumplimiento parcial (proveedor,
--                                 fecha, monto) — genera un gasto al confirmar
--   orden_compra_recepcion_items   detalle de cantidad/precio por ítem recibido
--   stock_movimientos              ledger: entrada (llega mercadería) /
--                                 salida (se reparte a una obra u otra)
--
-- "Cuánto se recibió" de un orden_compra_item y "cuánto stock hay" de un
-- producto en una obra son SIEMPRE derivados (SUM de filas), nunca una
-- columna que se sincroniza a mano — mismo criterio que estaVencido()
-- en lib/utils.ts para no tener un estado que se desincronice de la realidad.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- Catálogo de productos/insumos (clon exacto del patrón de `rubros`,
-- ver schema.sql ~2283 y lib/rubros.ts) — necesario para poder sumar
-- stock de un mismo insumo entre compras distintas sin depender de que
-- todos tipeen el nombre igual.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS productos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id     UUID NOT NULL REFERENCES constructoras(id),
  nombre              TEXT NOT NULL,
  nombre_normalizado  TEXT NOT NULL,
  unidad_medida       TEXT NOT NULL DEFAULT 'unidad',
  categoria_id        UUID REFERENCES categorias_costo(id),
  activo              BOOLEAN NOT NULL DEFAULT true,
  notas               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (constructora_id, nombre_normalizado)
);

CREATE INDEX IF NOT EXISTS idx_productos_constructora ON productos(constructora_id);
CREATE INDEX IF NOT EXISTS idx_productos_categoria     ON productos(categoria_id);

CREATE OR REPLACE FUNCTION obtener_o_crear_producto(
  p_constructora_id UUID,
  p_nombre TEXT,
  p_unidad_medida TEXT DEFAULT 'unidad',
  p_categoria_id UUID DEFAULT NULL
)
RETURNS TABLE(id UUID, nombre TEXT, unidad_medida TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_nombre_limpio       TEXT;
  v_nombre_normalizado  TEXT;
  v_unidad_limpia       TEXT;
BEGIN
  v_nombre_limpio := btrim(regexp_replace(p_nombre, '\s+', ' ', 'g'));
  IF v_nombre_limpio = '' THEN
    RAISE EXCEPTION 'El nombre del producto no puede estar vacío';
  END IF;
  v_nombre_normalizado := lower(unaccent(v_nombre_limpio));
  v_unidad_limpia := COALESCE(NULLIF(btrim(p_unidad_medida), ''), 'unidad');

  -- Si ya existe (mismo nombre normalizado), NO pisa la categoría existente
  -- con NULL — solo la actualiza si se pasó una explícita.
  RETURN QUERY
  INSERT INTO productos (constructora_id, nombre, nombre_normalizado, unidad_medida, categoria_id)
  VALUES (p_constructora_id, v_nombre_limpio, v_nombre_normalizado, v_unidad_limpia, p_categoria_id)
  ON CONFLICT (constructora_id, nombre_normalizado)
  DO UPDATE SET categoria_id = COALESCE(EXCLUDED.categoria_id, productos.categoria_id)
  RETURNING productos.id, productos.nombre, productos.unidad_medida;
END;
$$;

-- ------------------------------------------------------------
-- Cabecera de la orden de compra. obra_id NULLABLE a propósito: una
-- orden puede nacer "para repartir después" (pool de empresa, igual
-- que gastos/cuentas a nivel empresa) o apuntar a una obra puntual
-- desde el vacío. `estado` es SOLO el ciclo administrativo (si se
-- puede seguir editando o si se canceló) — cuánto se cumplió es
-- derivado de orden_compra_recepcion_items, no vive acá.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ordenes_compra (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id UUID NOT NULL REFERENCES constructoras(id),
  obra_id         UUID REFERENCES obras(id),
  numero          INTEGER NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'confirmada', 'cancelada')),
  fecha_emision   DATE NOT NULL DEFAULT CURRENT_DATE,
  notas           TEXT,
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  updated_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ordenes_compra_constructora ON ordenes_compra(constructora_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_obra         ON ordenes_compra(obra_id);

-- Numeración secuencial por constructora — mismo mecanismo (advisory
-- lock + MAX+1) que asignar_numero_certificado()/asignar_numero_cobro_proyecto().
CREATE OR REPLACE FUNCTION asignar_numero_orden_compra()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ordenes_compra:' || NEW.constructora_id::text));
  SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
  FROM ordenes_compra WHERE constructora_id = NEW.constructora_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asignar_numero_orden_compra ON ordenes_compra;
CREATE TRIGGER trg_asignar_numero_orden_compra
  BEFORE INSERT ON ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION asignar_numero_orden_compra();

DROP TRIGGER IF EXISTS trg_auditoria_campos ON ordenes_compra;
CREATE TRIGGER trg_auditoria_campos
  BEFORE INSERT OR UPDATE ON ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_campos();

DROP TRIGGER IF EXISTS trg_registrar_auditoria ON ordenes_compra;
CREATE TRIGGER trg_registrar_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

-- ------------------------------------------------------------
-- Ítems de la orden (qué se pidió). constructora_id denormalizado
-- (mismo criterio que presupuesto_items/equipo_asignaciones) para RLS
-- simple sin joins — se deriva sola del padre si no se manda, así un
-- INSERT directo desde el cliente no puede colgar el ítem de una orden
-- de otro tenant aunque mande un constructora_id propio válido.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orden_compra_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_compra_id     UUID NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  constructora_id     UUID NOT NULL REFERENCES constructoras(id),
  producto_id         UUID NOT NULL REFERENCES productos(id),
  cantidad_solicitada NUMERIC(15,2) NOT NULL CHECK (cantidad_solicitada > 0),
  unidad_medida       TEXT,
  notas               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orden_compra_items_orden     ON orden_compra_items(orden_compra_id);
CREATE INDEX IF NOT EXISTS idx_orden_compra_items_producto  ON orden_compra_items(producto_id);

CREATE OR REPLACE FUNCTION set_orden_compra_item_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.constructora_id IS NULL THEN
    SELECT constructora_id INTO NEW.constructora_id FROM ordenes_compra WHERE id = NEW.orden_compra_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orden_compra_item_tenant ON orden_compra_items;
CREATE TRIGGER trg_orden_compra_item_tenant
  BEFORE INSERT ON orden_compra_items
  FOR EACH ROW EXECUTE FUNCTION set_orden_compra_item_tenant();

-- ------------------------------------------------------------
-- Cada cumplimiento parcial de la orden: quién (proveedor), cuándo, a
-- cuánto. gasto_id se completa recién al confirmar (RPC más abajo) —
-- ON DELETE SET NULL para que borrar el gasto (o purgar la obra) no
-- rompa la orden de borrado en las funciones de purgado.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orden_compra_recepciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_compra_id UUID NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  constructora_id UUID NOT NULL REFERENCES constructoras(id),
  proveedor_id    UUID NOT NULL REFERENCES proveedores(id),
  gasto_id        UUID REFERENCES gastos(id) ON DELETE SET NULL,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  moneda          TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
  notas           TEXT,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orden_compra_recepciones_orden      ON orden_compra_recepciones(orden_compra_id);
CREATE INDEX IF NOT EXISTS idx_orden_compra_recepciones_proveedor  ON orden_compra_recepciones(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_orden_compra_recepciones_gasto      ON orden_compra_recepciones(gasto_id);

CREATE OR REPLACE FUNCTION set_orden_compra_recepcion_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.constructora_id IS NULL THEN
    SELECT constructora_id INTO NEW.constructora_id FROM ordenes_compra WHERE id = NEW.orden_compra_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orden_compra_recepcion_tenant ON orden_compra_recepciones;
CREATE TRIGGER trg_orden_compra_recepcion_tenant
  BEFORE INSERT ON orden_compra_recepciones
  FOR EACH ROW EXECUTE FUNCTION set_orden_compra_recepcion_tenant();

-- ------------------------------------------------------------
-- Detalle de esa recepción: qué ítem y cuánta cantidad llegó, a qué
-- precio. "Cuánto se recibió" de un orden_compra_item = SUM(cantidad_recibida)
-- de todas sus filas acá — se calcula al leer, no se guarda.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orden_compra_recepcion_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recepcion_id         UUID NOT NULL REFERENCES orden_compra_recepciones(id) ON DELETE CASCADE,
  -- CASCADE (no default NO ACTION): esta fila y orden_compra_items comparten
  -- el mismo ancestro (ordenes_compra) por dos caminos de cascada distintos
  -- (vía recepciones y directo) — con NO ACTION, borrar la orden podría
  -- violar esta FK si Postgres procesa los caminos en el orden "equivocado".
  orden_compra_item_id UUID NOT NULL REFERENCES orden_compra_items(id) ON DELETE CASCADE,
  constructora_id      UUID NOT NULL REFERENCES constructoras(id),
  cantidad_recibida    NUMERIC(15,2) NOT NULL CHECK (cantidad_recibida > 0),
  precio_unitario      NUMERIC(15,2) NOT NULL CHECK (precio_unitario >= 0),
  subtotal             NUMERIC(15,2) GENERATED ALWAYS AS (cantidad_recibida * precio_unitario) STORED,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orden_compra_recepcion_items_recepcion ON orden_compra_recepcion_items(recepcion_id);
CREATE INDEX IF NOT EXISTS idx_orden_compra_recepcion_items_item      ON orden_compra_recepcion_items(orden_compra_item_id);

CREATE OR REPLACE FUNCTION set_recepcion_item_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.constructora_id IS NULL THEN
    SELECT constructora_id INTO NEW.constructora_id FROM orden_compra_recepciones WHERE id = NEW.recepcion_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recepcion_item_tenant ON orden_compra_recepcion_items;
CREATE TRIGGER trg_recepcion_item_tenant
  BEFORE INSERT ON orden_compra_recepcion_items
  FOR EACH ROW EXECUTE FUNCTION set_recepcion_item_tenant();

-- ------------------------------------------------------------
-- Ledger de stock. obra_id NULLABLE = pool de empresa. "Stock actual"
-- de un producto en una obra (o en el pool) = SUM(entrada) - SUM(salida),
-- calculado al leer (mismo criterio que calcularSaldosDeCuentas en
-- lib/tesoreria.ts para saldos de cuentas) — nunca un contador que se
-- decrementa, así no hay riesgo de que se desincronice de la realidad.
-- Repartir NO valida que alcance el stock (ledger simple, decisión de
-- producto) — puede dar negativo, la UI lo muestra como aviso, no bloquea.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_movimientos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id     UUID NOT NULL REFERENCES constructoras(id),
  producto_id         UUID NOT NULL REFERENCES productos(id),
  obra_id             UUID REFERENCES obras(id),
  tipo                TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
  cantidad            NUMERIC(15,2) NOT NULL CHECK (cantidad > 0),
  origen_recepcion_id UUID REFERENCES orden_compra_recepciones(id) ON DELETE SET NULL,
  notas               TEXT,
  created_by          UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movimientos_constructora ON stock_movimientos(constructora_id);
CREATE INDEX IF NOT EXISTS idx_stock_movimientos_producto     ON stock_movimientos(producto_id);
CREATE INDEX IF NOT EXISTS idx_stock_movimientos_obra         ON stock_movimientos(obra_id);
-- Consulta más frecuente: "cuánto hay de este producto en esta obra" —
-- índice compuesto para no escanear todo el ledger de la constructora.
CREATE INDEX IF NOT EXISTS idx_stock_movimientos_producto_obra ON stock_movimientos(producto_id, obra_id);

CREATE OR REPLACE FUNCTION set_stock_movimiento_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.constructora_id IS NULL THEN
    SELECT constructora_id INTO NEW.constructora_id FROM productos WHERE id = NEW.producto_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_movimiento_tenant ON stock_movimientos;
CREATE TRIGGER trg_stock_movimiento_tenant
  BEFORE INSERT ON stock_movimientos
  FOR EACH ROW EXECUTE FUNCTION set_stock_movimiento_tenant();

-- ------------------------------------------------------------
-- Confirmar una recepción: crea el gasto (proveedor/monto/moneda/obra
-- de la orden), lo linkea a la recepción, y da entrada al stock por
-- cada ítem recibido. Todo atómico (una sola llamada de función
-- plpgsql = una transacción) — evita dejar el gasto creado sin el
-- movimiento de stock si algo falla a mitad de camino.
--
-- SECURITY INVOKER a propósito (mismo criterio que aceptar_presupuesto()):
-- el caller necesita tiene_permiso('compras') para las tablas de compras
-- Y tiene_permiso_proyecto(obra_id,'gastos') (o es_admin() si obra_id es
-- NULL) para poder insertar en `gastos` — si no tiene el módulo Gastos
-- habilitado en ese proyecto, esto falla con el error de RLS de esa
-- tabla. Documentado como aviso en lib/permisos.ts (MODULOS.compras).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION confirmar_recepcion_compra(p_recepcion_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_recepcion   orden_compra_recepciones%ROWTYPE;
  v_orden       ordenes_compra%ROWTYPE;
  v_monto_total NUMERIC(15,2);
  v_gasto_id    UUID;
  v_item        RECORD;
BEGIN
  SELECT * INTO v_recepcion FROM orden_compra_recepciones WHERE id = p_recepcion_id;
  IF v_recepcion.id IS NULL THEN
    RAISE EXCEPTION 'Recepción no encontrada';
  END IF;
  IF v_recepcion.gasto_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta recepción ya fue confirmada';
  END IF;

  SELECT * INTO v_orden FROM ordenes_compra WHERE id = v_recepcion.orden_compra_id;
  IF v_orden.estado = 'cancelada' THEN
    RAISE EXCEPTION 'La orden de compra está cancelada';
  END IF;

  SELECT COALESCE(SUM(subtotal), 0) INTO v_monto_total
  FROM orden_compra_recepcion_items WHERE recepcion_id = p_recepcion_id;

  IF v_monto_total <= 0 THEN
    RAISE EXCEPTION 'La recepción no tiene ítems cargados';
  END IF;

  INSERT INTO gastos (constructora_id, obra_id, proveedor_id, descripcion, monto, moneda, fecha_vencimiento, estado, notas)
  VALUES (
    v_recepcion.constructora_id,
    v_orden.obra_id,
    v_recepcion.proveedor_id,
    'Compra OC-' || v_orden.numero,
    v_monto_total,
    v_recepcion.moneda,
    v_recepcion.fecha,
    'Pendiente',
    v_recepcion.notas
  )
  RETURNING id INTO v_gasto_id;

  UPDATE orden_compra_recepciones SET gasto_id = v_gasto_id WHERE id = p_recepcion_id;

  FOR v_item IN
    SELECT oci.cantidad_recibida, oi.producto_id
    FROM orden_compra_recepcion_items oci
    JOIN orden_compra_items oi ON oi.id = oci.orden_compra_item_id
    WHERE oci.recepcion_id = p_recepcion_id
  LOOP
    INSERT INTO stock_movimientos (constructora_id, producto_id, obra_id, tipo, cantidad, origen_recepcion_id, created_by)
    VALUES (v_recepcion.constructora_id, v_item.producto_id, v_orden.obra_id, 'entrada', v_item.cantidad_recibida, p_recepcion_id, auth.uid());
  END LOOP;

  IF v_orden.estado = 'borrador' THEN
    UPDATE ordenes_compra SET estado = 'confirmada' WHERE id = v_orden.id;
  END IF;

  RETURN v_gasto_id;
END;
$$;

-- ------------------------------------------------------------
-- Repartir stock entre obras (o desde/hacia el pool de empresa,
-- obra_id NULL): un par salida+entrada atómico. Sin validar que
-- alcance (ledger simple) — puede dejar el origen en negativo, es
-- responsabilidad de quien reparte fijarse en la UI.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION repartir_stock(
  p_producto_id UUID,
  p_obra_origen UUID,
  p_obra_destino UUID,
  p_cantidad NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_constructora_id UUID;
BEGIN
  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad a repartir debe ser mayor a cero';
  END IF;
  IF p_obra_origen IS NOT DISTINCT FROM p_obra_destino THEN
    RAISE EXCEPTION 'El origen y el destino no pueden ser el mismo';
  END IF;

  SELECT constructora_id INTO v_constructora_id FROM productos WHERE id = p_producto_id;
  IF v_constructora_id IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  INSERT INTO stock_movimientos (constructora_id, producto_id, obra_id, tipo, cantidad, created_by)
  VALUES (v_constructora_id, p_producto_id, p_obra_origen, 'salida', p_cantidad, auth.uid());

  INSERT INTO stock_movimientos (constructora_id, producto_id, obra_id, tipo, cantidad, created_by)
  VALUES (v_constructora_id, p_producto_id, p_obra_destino, 'entrada', p_cantidad, auth.uid());
END;
$$;

-- ------------------------------------------------------------
-- Resumen de stock agregado por producto+obra (obra_id NULL = pool de
-- empresa) — mismo criterio que resumen_unidades_por_obra: agregar en
-- Postgres en vez de traer todo el ledger al cliente para sumarlo ahí.
-- SECURITY INVOKER (default): corre con la RLS del caller, así que
-- tiene_permiso('compras') de stock_movimientos ya lo protege solo.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION resumen_stock(p_constructora_id UUID)
RETURNS TABLE(producto_id UUID, obra_id UUID, cantidad NUMERIC)
LANGUAGE sql
STABLE
AS $$
  SELECT
    producto_id,
    obra_id,
    SUM(CASE WHEN tipo = 'entrada' THEN cantidad ELSE -cantidad END) AS cantidad
  FROM stock_movimientos
  WHERE constructora_id = p_constructora_id
  GROUP BY producto_id, obra_id
  HAVING SUM(CASE WHEN tipo = 'entrada' THEN cantidad ELSE -cantidad END) != 0;
$$;

-- ------------------------------------------------------------
-- RLS — módulo de Empresa, un solo permiso ('compras') para todas las
-- tablas (catálogo, órdenes, recepciones y stock), igual que
-- Proveedores/Inventario/Personal no fragmentan el árbol de permisos.
-- ------------------------------------------------------------
ALTER TABLE productos                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes_compra                ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_compra_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_compra_recepciones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_compra_recepcion_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movimientos             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "productos_tenant" ON productos;
CREATE POLICY "productos_tenant" ON productos
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'));

DROP POLICY IF EXISTS "ordenes_compra_tenant" ON ordenes_compra;
CREATE POLICY "ordenes_compra_tenant" ON ordenes_compra
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'));

DROP POLICY IF EXISTS "orden_compra_items_tenant" ON orden_compra_items;
CREATE POLICY "orden_compra_items_tenant" ON orden_compra_items
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'));

DROP POLICY IF EXISTS "orden_compra_recepciones_tenant" ON orden_compra_recepciones;
CREATE POLICY "orden_compra_recepciones_tenant" ON orden_compra_recepciones
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'));

DROP POLICY IF EXISTS "orden_compra_recepcion_items_tenant" ON orden_compra_recepcion_items;
CREATE POLICY "orden_compra_recepcion_items_tenant" ON orden_compra_recepcion_items
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'));

DROP POLICY IF EXISTS "stock_movimientos_tenant" ON stock_movimientos;
CREATE POLICY "stock_movimientos_tenant" ON stock_movimientos
  FOR ALL TO authenticated
  USING      (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'))
  WITH CHECK (constructora_id IN (SELECT mis_constructoras()) AND tiene_permiso('compras'));

-- ------------------------------------------------------------
-- Purgas: sumar las tablas nuevas a los dos RPCs de borrado en cascada
-- ya existentes (mismo mantenimiento que se hizo con equipos/personal
-- en su momento).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION purgar_constructora_completa(p_constructora_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

  DELETE FROM stock_movimientos           WHERE constructora_id = p_constructora_id;
  DELETE FROM ordenes_compra              WHERE constructora_id = p_constructora_id;
  DELETE FROM productos                   WHERE constructora_id = p_constructora_id;

  DELETE FROM cobros_proyecto   WHERE constructora_id = p_constructora_id;
  DELETE FROM contratos_obra    WHERE constructora_id = p_constructora_id;
  DELETE FROM presupuestos      WHERE constructora_id = p_constructora_id;
  DELETE FROM equipos           WHERE constructora_id = p_constructora_id;
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

CREATE OR REPLACE FUNCTION purgar_obra_completa(p_obra_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.bypass_inmutable', 'true', true);

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

  DELETE FROM equipo_asignaciones WHERE obra_id = p_obra_id;
  DELETE FROM gastos              WHERE obra_id = p_obra_id;

  -- cuentas_propias NO se borra: su FK (obra_id ON DELETE SET NULL) la
  -- desvincula sola al llegar al DELETE FROM obras — sobrevive como
  -- cuenta de empresa en vez de perderse (representa un saldo_inicial
  -- real, no un dato de ejecución del proyecto).

  DELETE FROM obras WHERE id = p_obra_id;
END;
$$;

-- ------------------------------------------------------------
-- search_path fijo (mismo hardening de migration_050 para el linter
-- de Supabase, categoría function_search_path_mutable).
-- ------------------------------------------------------------
ALTER FUNCTION obtener_o_crear_producto(UUID, TEXT, TEXT, UUID) SET search_path = public;
ALTER FUNCTION asignar_numero_orden_compra() SET search_path = public;
ALTER FUNCTION set_orden_compra_item_tenant() SET search_path = public;
ALTER FUNCTION set_orden_compra_recepcion_tenant() SET search_path = public;
ALTER FUNCTION set_recepcion_item_tenant() SET search_path = public;
ALTER FUNCTION set_stock_movimiento_tenant() SET search_path = public;
ALTER FUNCTION confirmar_recepcion_compra(UUID) SET search_path = public;
ALTER FUNCTION repartir_stock(UUID, UUID, UUID, NUMERIC) SET search_path = public;
ALTER FUNCTION resumen_stock(UUID) SET search_path = public;
