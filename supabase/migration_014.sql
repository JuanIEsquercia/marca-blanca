-- Agregar moneda propia a cobros_proyecto
ALTER TABLE cobros_proyecto
  ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'ARS'
    CHECK (moneda IN ('ARS', 'USD'));

-- Copiar moneda del contrato de cada cobro (donde sea posible)
UPDATE cobros_proyecto cp
SET moneda = co.moneda
FROM certificados_avance ca
JOIN contratos_obra co ON co.id = ca.contrato_obra_id
WHERE cp.certificado_id = ca.id
  AND cp.moneda = 'ARS';  -- solo actualiza los que quedaron en default
