-- ------------------------------------------------------------
-- migration_078.sql — Series de índices y cotizaciones (BCRA).
--
-- Base para dos cosas que hoy faltan y que la competencia usa como
-- diferencial: ajustar contratos/cuotas por índice, y poder expresar en
-- una sola moneda montos que hoy conviven en ARS y USD sin poder sumarse.
--
-- Esta tabla es GLOBAL entre tenants a propósito, igual que chat_faq_cache:
-- el dólar mayorista de una fecha es el mismo para todas las constructoras.
-- La diferencia con aquella es que acá el dato es PÚBLICO (lo publica el
-- BCRA), así que se puede leer desde el navegador; escribirlo, en cambio,
-- solo el servidor.
--
-- Cada serie tiene HUECOS: el BCRA no publica fines de semana ni feriados
-- (verificado contra la API: 7 valores en 10 días corridos). Por eso nunca
-- se busca por fecha exacta — valor_indice() devuelve el último valor
-- publicado hasta esa fecha, que es además el criterio correcto de negocio
-- ("el dólar del día que se cobró la cuota").
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS indices_valores (
  -- Nomenclatura propia, no el idVariable del BCRA: si mañana se agrega
  -- una serie de otra fuente (CAC, que publica la Cámara de la
  -- Construcción y no tiene API pública) entra en la misma tabla.
  tipo       TEXT NOT NULL,
  fecha      DATE NOT NULL,
  valor      NUMERIC(18,6) NOT NULL CHECK (valor > 0),
  fuente     TEXT NOT NULL DEFAULT 'bcra',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tipo, fecha)
);

-- La consulta real siempre es "último valor de este tipo hasta esta fecha".
CREATE INDEX IF NOT EXISTS idx_indices_valores_tipo_fecha ON indices_valores(tipo, fecha DESC);

ALTER TABLE indices_valores ENABLE ROW LEVEL SECURITY;

-- Lectura para cualquier usuario autenticado: es información pública y no
-- dice nada de ninguna constructora. No hay policy de escritura: solo el
-- service role (que saltea RLS) puede cargar valores, desde el cron.
DROP POLICY IF EXISTS "indices_valores_lectura" ON indices_valores;
CREATE POLICY "indices_valores_lectura" ON indices_valores
  FOR SELECT TO authenticated
  USING (true);

-- Último valor publicado hasta la fecha pedida. Devuelve NULL si todavía no
-- hay ningún valor cargado para esa serie — el caller decide si eso es un
-- error o simplemente "todavía no ajusta".
CREATE OR REPLACE FUNCTION valor_indice(p_tipo TEXT, p_fecha DATE)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT iv.valor
  FROM indices_valores iv
  WHERE iv.tipo = p_tipo AND iv.fecha <= p_fecha
  ORDER BY iv.fecha DESC
  LIMIT 1;
$$;

-- Coeficiente de ajuste entre dos fechas: cuánto multiplicar un monto
-- pactado en `p_desde` para expresarlo en moneda de `p_hasta`.
-- Devuelve NULL si falta alguna de las dos puntas, nunca 1 por defecto:
-- un ajuste silencioso de "no ajustó nada" sería indistinguible de un dato
-- faltante, y en plata eso no se puede confundir.
CREATE OR REPLACE FUNCTION coeficiente_ajuste(p_tipo TEXT, p_desde DATE, p_hasta DATE)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN base IS NULL OR actual IS NULL OR base = 0 THEN NULL
    ELSE ROUND(actual / base, 6)
  END
  FROM (
    SELECT valor_indice(p_tipo, p_desde) AS base,
           valor_indice(p_tipo, p_hasta) AS actual
  ) t;
$$;
