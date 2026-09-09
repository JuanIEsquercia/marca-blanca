-- ------------------------------------------------------------
-- migration_077.sql — Bandeja de pendientes ("Notificaciones") del panel.
--
-- DECISIÓN DE DISEÑO, la más importante de este archivo: esto NO es una
-- tabla de notificaciones con eventos y estado leído/no leído. Es una
-- consulta que DERIVA los pendientes de los datos que ya existen.
--
-- Por qué. Una tabla de eventos hace falta cuando el aviso es un hecho del
-- pasado que alguien tiene que ver una vez ("Juan aprobó el certificado
-- N°3"). Acá los avisos son ESTADOS del presente: una factura está
-- vencida hasta que se paga, un certificado está trabado hasta que se
-- presenta. Un estado no se "marca como leído" — se resuelve. Guardarlo
-- como evento obligaría a escribir triggers en media docena de tablas y a
-- mantenerlos sincronizados, con el riesgo clásico de que el aviso diga
-- "vencido" cuando el gasto ya se pagó. Derivarlo no puede desincronizarse
-- nunca: si el dato cambia, el pendiente desaparece solo.
--
-- Si en algún momento hace falta el otro tipo (avisos entre usuarios, con
-- leído/no leído), eso es una tabla aparte y no reemplaza a esto.
--
-- SECURITY INVOKER (default): corre con la RLS de quien llama, así que
-- cada persona ve los pendientes de los proyectos y módulos que ya podía
-- ver. Un operador con Gastos en una sola obra ve los vencimientos de esa
-- obra y de ninguna otra, sin una línea de lógica de permisos acá.
--
-- Los planes de pago (migration_064) obligan a mirar dos niveles: un gasto
-- con cheques queda 'Pendiente' a nivel fila aunque sus cuotas tengan
-- fechas futuras. Por eso los gastos/cobros CON plan se excluyen del
-- chequeo por fecha del padre, y lo que se evalúa es la fecha real de cada
-- cuota. Es el mismo criterio que ya usa el dashboard de obra.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION pendientes_usuario(p_constructora_id UUID)
RETURNS TABLE(
  tipo      TEXT,
  severidad TEXT,
  id        UUID,
  titulo    TEXT,
  subtitulo TEXT,
  fecha     DATE,
  obra_id   UUID
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- Gastos vencidos SIN plan de pago (los que tienen plan se miran por cuota)
  (
    SELECT 'gasto_vencido'::TEXT, 'alta'::TEXT, g.id,
           g.descripcion,
           (COALESCE(p.razon_social, 'Sin proveedor') || ' · ' || g.moneda || ' ' || g.monto)::TEXT,
           g.fecha_vencimiento,
           g.obra_id
    FROM gastos g
    LEFT JOIN proveedores p ON p.id = g.proveedor_id
    WHERE g.constructora_id = p_constructora_id
      AND g.estado = 'Pendiente'
      AND g.fecha_vencimiento < CURRENT_DATE
      AND NOT EXISTS (SELECT 1 FROM gasto_pagos gp WHERE gp.gasto_id = g.id)
    ORDER BY g.fecha_vencimiento
    LIMIT 10
  )
  UNION ALL
  -- Cuotas/cheques de un plan de pago de gasto, vencidas
  (
    SELECT 'cheque_gasto_vencido'::TEXT, 'alta'::TEXT, gp.id,
           ('Cuota de: ' || g.descripcion)::TEXT,
           (gp.medio || COALESCE(' #' || gp.numero_cheque, '') || ' · ' || g.moneda || ' ' || gp.monto)::TEXT,
           gp.fecha_pago,
           g.obra_id
    FROM gasto_pagos gp
    JOIN gastos g ON g.id = gp.gasto_id
    WHERE gp.constructora_id = p_constructora_id
      AND gp.estado = 'Pendiente'
      AND gp.fecha_pago < CURRENT_DATE
    ORDER BY gp.fecha_pago
    LIMIT 10
  )
  UNION ALL
  -- Cobros de obra vencidos SIN plan
  (
    SELECT 'cobro_vencido'::TEXT, 'alta'::TEXT, c.id,
           ('Cobro N°' || COALESCE(c.numero::TEXT, 's/n'))::TEXT,
           (o.nombre || ' · ' || c.moneda || ' ' || c.monto)::TEXT,
           c.fecha_vencimiento,
           c.obra_id
    FROM cobros_proyecto c
    JOIN obras o ON o.id = c.obra_id
    WHERE c.constructora_id = p_constructora_id
      AND c.estado = 'Pendiente'
      AND c.fecha_vencimiento < CURRENT_DATE
      AND NOT EXISTS (SELECT 1 FROM cobro_pagos cp WHERE cp.cobro_id = c.id)
    ORDER BY c.fecha_vencimiento
    LIMIT 10
  )
  UNION ALL
  -- Cuotas/cheques de un plan de pago de cobro, vencidas
  (
    SELECT 'cheque_cobro_vencido'::TEXT, 'alta'::TEXT, cp.id,
           ('Cuota de cobro N°' || COALESCE(c.numero::TEXT, 's/n'))::TEXT,
           (cp.medio || COALESCE(' #' || cp.numero_cheque, '') || ' · ' || c.moneda || ' ' || cp.monto)::TEXT,
           cp.fecha_pago,
           c.obra_id
    FROM cobro_pagos cp
    JOIN cobros_proyecto c ON c.id = cp.cobro_id
    WHERE cp.constructora_id = p_constructora_id
      AND cp.estado = 'Pendiente'
      AND cp.fecha_pago < CURRENT_DATE
    ORDER BY cp.fecha_pago
    LIMIT 10
  )
  UNION ALL
  -- Cuotas de venta de unidades, vencidas
  (
    SELECT 'cuota_venta_vencida'::TEXT, 'alta'::TEXT, q.id,
           ('Cuota ' || q.numero_cuota || ' — ' || comp.nombre_completo)::TEXT,
           (o.nombre || ' · Piso ' || u.piso || COALESCE(' - ' || u.numero, ''))::TEXT,
           q.fecha_vencimiento,
           cv.obra_id
    FROM cuotas q
    JOIN contratos_venta cv ON cv.id = q.contrato_id
    JOIN unidades u   ON u.id = cv.unidad_id
    JOIN obras o      ON o.id = cv.obra_id
    JOIN compradores comp ON comp.id = cv.comprador_id
    WHERE q.constructora_id = p_constructora_id
      AND q.estado_pago = 'Pendiente'
      AND q.fecha_vencimiento < CURRENT_DATE
      AND cv.estado = 'vigente'
    ORDER BY q.fecha_vencimiento
    LIMIT 10
  )
  UNION ALL
  -- Reservas que vencen dentro de 7 días (o ya vencidas y siguen Vigentes)
  (
    SELECT 'reserva_por_vencer'::TEXT,
           CASE WHEN r.fecha_vencimiento < CURRENT_DATE THEN 'alta' ELSE 'media' END::TEXT,
           r.id,
           ('Reserva — ' || comp.nombre_completo)::TEXT,
           (o.nombre || ' · Piso ' || u.piso || COALESCE(' - ' || u.numero, ''))::TEXT,
           r.fecha_vencimiento,
           r.obra_id
    FROM reservas r
    JOIN unidades u ON u.id = r.unidad_id
    JOIN obras o    ON o.id = r.obra_id
    JOIN compradores comp ON comp.id = r.comprador_id
    WHERE r.constructora_id = p_constructora_id
      AND r.estado = 'Vigente'
      AND r.fecha_vencimiento <= CURRENT_DATE + 7
    ORDER BY r.fecha_vencimiento
    LIMIT 10
  )
  UNION ALL
  -- Certificados que quedaron en borrador y no avanzan
  (
    SELECT 'certificado_estancado'::TEXT, 'media'::TEXT, ca.id,
           ('Certificado N°' || ca.numero || ' en borrador')::TEXT,
           (o.nombre || ' · ' || ca.periodo)::TEXT,
           ca.created_at::DATE,
           ca.obra_id
    FROM certificados_avance ca
    JOIN obras o ON o.id = ca.obra_id
    WHERE ca.constructora_id = p_constructora_id
      AND ca.estado = 'borrador'
      AND ca.created_at < NOW() - INTERVAL '14 days'
    ORDER BY ca.created_at
    LIMIT 10
  );
$$;

REVOKE EXECUTE ON FUNCTION pendientes_usuario(UUID) FROM anon;
