  -- ============================================================
  -- MIGRATION 047: contratos_obra admite más de uno por proyecto, y
  -- cada uno se tipa como 'cliente' (entra plata — el comportamiento de
  -- siempre: certifica hacia cobros_proyecto) o 'subcontratista' (sale
  -- plata — certifica hacia gastos). Pensado para constructoras que
  -- actúan como comitente/gerenciadoras: no ejecutan la obra ellas
  -- mismas, subcontratan cada rubro a terceros distintos, en monedas
  -- distintas.
  --
  -- Decisiones (charladas con el usuario antes de escribir esto):
  -- - Un subcontratista se maneja como un `proveedor` ya existente —
  --   reutiliza la cuenta corriente por proveedor (migration_046 en
  --   espíritu, la pantalla ya construida en /admin/proveedores), no es
  --   una entidad nueva.
  -- - cliente_id y proveedor_id son dos columnas separadas (no una sola
  --   "parte" polimórfica) porque apuntan a tablas distintas
  --   (compradores vs proveedores) — un CHECK constraint obliga a que
  --   solo una esté cargada, según `tipo`.
  -- - No hay generación automática de gasto/cobro al certificar — sigue
  --   siendo un paso manual aparte (igual que hoy con cobros_proyecto),
  --   solo que para 'subcontratista' ese paso crea un `gasto` en vez de
  --   un `cobro_proyecto`. gastos.certificado_id (nuevo, nullable) deja
  --   trazabilidad de qué certificado originó ese gasto, mismo patrón
  --   que ya tiene cobros_proyecto.certificado_id.
  -- - No hace falta una policy RLS nueva: contratos_obra_tenant ya
  --   gatea por tiene_permiso_proyecto(obra_id, 'certificados'),
  --   independiente del tipo — no se agrega un permiso separado para
  --   subcontratistas, sería sobre-ingeniería para lo que pidió el
  --   usuario.
  -- ============================================================

  ALTER TABLE contratos_obra ALTER COLUMN cliente_id DROP NOT NULL;

  ALTER TABLE contratos_obra ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'cliente'
    CHECK (tipo IN ('cliente', 'subcontratista'));
  ALTER TABLE contratos_obra ADD COLUMN IF NOT EXISTS proveedor_id UUID REFERENCES proveedores(id);

  ALTER TABLE contratos_obra DROP CONSTRAINT IF EXISTS contratos_obra_parte_check;
  ALTER TABLE contratos_obra ADD CONSTRAINT contratos_obra_parte_check CHECK (
    (tipo = 'cliente' AND cliente_id IS NOT NULL AND proveedor_id IS NULL)
    OR (tipo = 'subcontratista' AND proveedor_id IS NOT NULL AND cliente_id IS NULL)
  );

  CREATE INDEX IF NOT EXISTS idx_contratos_obra_proveedor ON contratos_obra(proveedor_id);
  CREATE INDEX IF NOT EXISTS idx_contratos_obra_tipo ON contratos_obra(obra_id, tipo);

  -- Trazabilidad: qué certificado de un subcontratista generó este gasto.
  -- ON DELETE SET NULL, no CASCADE: borrar el certificado no debería
  -- borrar el gasto que ya se registró — mismo criterio que
  -- cobros_proyecto.certificado_id.
  ALTER TABLE gastos ADD COLUMN IF NOT EXISTS certificado_id UUID REFERENCES certificados_avance(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_gastos_certificado ON gastos(certificado_id);

  -- aceptar_presupuesto() solo debe bloquear si la obra YA tiene un
  -- contrato con el CLIENTE — antes bloqueaba con cualquier contrato,
  -- lo que ahora impediría tener contratos de subcontratistas sueltos
  -- antes de aceptar el presupuesto del cliente.
  CREATE OR REPLACE FUNCTION aceptar_presupuesto(
    p_presupuesto_id       UUID,
    p_obra_id              UUID DEFAULT NULL,
    p_nueva_obra_nombre    TEXT DEFAULT NULL,
    p_nueva_obra_direccion TEXT DEFAULT NULL,
    p_modo_cuentas         TEXT DEFAULT 'empresa',
    p_replicar_cuentas     BOOLEAN DEFAULT false
  )
  RETURNS UUID
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_presupuesto  presupuestos%ROWTYPE;
    v_obra_tipo    TEXT;
    v_obra_id      UUID;
    v_cliente_id   UUID;
    v_monto_total  NUMERIC(15,2);
    v_contrato_id  UUID;
  BEGIN
    IF p_modo_cuentas NOT IN ('empresa', 'especificas') THEN
      RAISE EXCEPTION 'modo_cuentas inválido: %', p_modo_cuentas;
    END IF;

    SELECT * INTO v_presupuesto FROM presupuestos WHERE id = p_presupuesto_id;
    IF v_presupuesto.id IS NULL THEN
      RAISE EXCEPTION 'Presupuesto no encontrado';
    END IF;
    IF v_presupuesto.estado = 'aceptado' THEN
      RAISE EXCEPTION 'Este presupuesto ya fue aceptado';
    END IF;

    SELECT COALESCE(SUM(subtotal), 0) INTO v_monto_total
    FROM presupuesto_items WHERE presupuesto_id = p_presupuesto_id;
    IF v_monto_total <= 0 THEN
      RAISE EXCEPTION 'El presupuesto no tiene ítems cargados';
    END IF;

    IF p_obra_id IS NOT NULL THEN
      SELECT tipo INTO v_obra_tipo FROM obras WHERE id = p_obra_id AND constructora_id = v_presupuesto.constructora_id;
      IF v_obra_tipo IS NULL THEN
        RAISE EXCEPTION 'Proyecto no encontrado';
      END IF;
      IF v_obra_tipo != 'obra' THEN
        RAISE EXCEPTION 'Solo se puede vincular a un proyecto tipo Obra';
      END IF;
      IF EXISTS (SELECT 1 FROM contratos_obra WHERE obra_id = p_obra_id AND tipo = 'cliente') THEN
        RAISE EXCEPTION 'Ese proyecto ya tiene un contrato con el cliente cargado';
      END IF;
      v_obra_id := p_obra_id;
    ELSE
      IF p_nueva_obra_nombre IS NULL OR btrim(p_nueva_obra_nombre) = '' THEN
        RAISE EXCEPTION 'Falta el nombre del proyecto nuevo';
      END IF;
      INSERT INTO obras (constructora_id, nombre, direccion, tipo, estado, modo_cuentas)
      VALUES (v_presupuesto.constructora_id, btrim(p_nueva_obra_nombre), NULLIF(btrim(COALESCE(p_nueva_obra_direccion, '')), ''), 'obra', 'activa', p_modo_cuentas)
      RETURNING id INTO v_obra_id;

      IF p_modo_cuentas = 'especificas' AND p_replicar_cuentas THEN
        INSERT INTO cuentas_propias (constructora_id, obra_id, nombre, tipo, moneda, saldo_inicial, activa)
        SELECT constructora_id, v_obra_id, nombre, tipo, moneda, 0, true
        FROM cuentas_propias
        WHERE constructora_id = v_presupuesto.constructora_id AND obra_id IS NULL AND activa = true;
      END IF;
    END IF;

    IF v_presupuesto.cliente_cuit IS NOT NULL THEN
      SELECT id INTO v_cliente_id FROM compradores
      WHERE constructora_id = v_presupuesto.constructora_id AND dni_cuit = v_presupuesto.cliente_cuit;
    END IF;
    IF v_cliente_id IS NULL THEN
      INSERT INTO compradores (constructora_id, nombre_completo, dni_cuit, email, telefono)
      VALUES (v_presupuesto.constructora_id, v_presupuesto.cliente_nombre, v_presupuesto.cliente_cuit, v_presupuesto.cliente_email, v_presupuesto.cliente_telefono)
      RETURNING id INTO v_cliente_id;
    END IF;

    INSERT INTO contratos_obra (obra_id, constructora_id, tipo, cliente_id, monto_total, moneda, descripcion, presupuesto_id, fecha_inicio, fecha_fin_estimada)
    VALUES (v_obra_id, v_presupuesto.constructora_id, 'cliente', v_cliente_id, v_monto_total, v_presupuesto.moneda, v_presupuesto.descripcion, p_presupuesto_id, v_presupuesto.fecha_inicio, v_presupuesto.fecha_fin_estimada)
    RETURNING id INTO v_contrato_id;

    INSERT INTO contrato_obra_items (contrato_obra_id, constructora_id, orden, rubro, unidad, cantidad, precio_unitario, origen)
    SELECT v_contrato_id, constructora_id, orden, rubro, unidad, cantidad, precio_unitario, 'presupuesto'
    FROM presupuesto_items WHERE presupuesto_id = p_presupuesto_id;

    UPDATE presupuestos SET estado = 'aceptado', obra_id = v_obra_id, contrato_obra_id = v_contrato_id
    WHERE id = p_presupuesto_id;

    RETURN v_obra_id;
  END;
  $$;
