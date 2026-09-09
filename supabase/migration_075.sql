-- ------------------------------------------------------------
-- migration_075.sql — Caché semántica de preguntas frecuentes del chat.
--
-- Qué resuelve: hoy preguntar "¿cómo cargo un gasto?" cuesta lo mismo que
-- cualquier otra consulta — el prefijo del prompt (catálogo de ~40 tools +
-- reglas del sistema) ronda los 21.000 tokens medidos, y una pregunta
-- básica suele gastar dos llamadas al modelo (una para decidir consultar el
-- catálogo, otra para redactar). La respuesta, además, es SIEMPRE LA MISMA
-- para cualquier constructora, porque sale de catálogos estáticos de
-- TypeScript (lib/chat/catalogo-entidades.ts, catalogo-modulos.ts), no de
-- la base de datos.
--
-- Por eso esta tabla es GLOBAL a propósito: NO tiene constructora_id. Es la
-- única tabla del sistema compartida entre tenants, y por eso las reglas de
-- qué entra son estrictas y mecánicas (lib/chat/faq-cache.ts):
--
--   1. Solo turnos donde TODAS las tools usadas leen catálogos estáticos
--      (consultar_estructura, consultar_modulo). Cualquier tool que toque
--      la base descalifica el turno. La lista blanca es la garantía real,
--      no el criterio del modelo.
--   2. Solo el PRIMER mensaje de una conversación. Un "¿y eso cómo se
--      hace?" depende del contexto anterior y su respuesta no sirve para
--      otro que escriba lo mismo.
--   3. Nunca se guarda un texto que mencione el nombre de la constructora
--      ni el del usuario (el modelo los tiene en su contexto y podría
--      personalizar la respuesta).
--
-- Acceso: RLS habilitada SIN políticas = nadie con sesión puede leerla ni
-- escribirla. Solo el servidor, con service role (que saltea RLS). Es
-- deliberado: al ser datos compartidos entre tenants, no tiene por qué
-- estar al alcance del navegador de nadie.
--
-- La columna `embedding` se declara SIN dimensión fija a propósito: la
-- dimensión la define el modelo de Voyage y no queremos que un cambio de
-- modelo obligue a migrar la tabla. A esta escala (cientos de filas) un
-- scan secuencial sobre vectores es de microsegundos, así que no hace
-- falta índice HNSW/IVFFlat — que sí exigiría dimensión fija. Si algún día
-- la tabla crece a decenas de miles de filas, ahí sí conviene fijar la
-- dimensión y agregar el índice.
-- ------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS chat_faq_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Texto tal como lo escribió el primer usuario que la preguntó. Se guarda
  -- para poder auditar a mano contra qué está matcheando el umbral.
  pregunta      TEXT NOT NULL,
  respuesta     TEXT NOT NULL,
  embedding     vector NOT NULL,
  -- Modelo que generó el embedding. Se filtra por acá al buscar: vectores
  -- de modelos distintos tienen dimensiones distintas y compararlos es un
  -- error de Postgres, no un resultado malo.
  modelo        TEXT NOT NULL,
  -- Qué tools produjeron la respuesta — para auditar que solo entren las
  -- de la lista blanca aunque el código de la app cambie.
  herramientas  TEXT[] NOT NULL DEFAULT '{}',
  hits          INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  ultimo_uso    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_chat_faq_cache_modelo ON chat_faq_cache(modelo);

ALTER TABLE chat_faq_cache ENABLE ROW LEVEL SECURITY;
-- Sin políticas a propósito: RLS activa y cero policies = denegado para
-- authenticated y anon. Solo el service role del servidor entra.

-- Búsqueda por similitud coseno. El embedding llega como TEXT y se castea
-- acá para no depender de cómo PostgREST serializa un array de floats.
-- `<=>` es distancia coseno en pgvector, así que la similitud es 1 - d.
CREATE OR REPLACE FUNCTION buscar_faq_cache(
  p_embedding TEXT,
  p_modelo    TEXT,
  p_umbral    FLOAT
)
RETURNS TABLE(id UUID, pregunta TEXT, respuesta TEXT, similitud FLOAT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.id, c.pregunta, c.respuesta, (1 - (c.embedding <=> p_embedding::vector))::FLOAT AS similitud
  FROM chat_faq_cache c
  WHERE c.modelo = p_modelo
    AND (1 - (c.embedding <=> p_embedding::vector)) >= p_umbral
  ORDER BY c.embedding <=> p_embedding::vector
  LIMIT 1;
$$;

-- Solo la usa el servidor con service role; nadie con sesión de navegador
-- tiene por qué poder consultarla.
REVOKE EXECUTE ON FUNCTION buscar_faq_cache(TEXT, TEXT, FLOAT) FROM PUBLIC, authenticated, anon;

CREATE OR REPLACE FUNCTION registrar_hit_faq_cache(p_id UUID)
RETURNS VOID
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE chat_faq_cache SET hits = hits + 1, ultimo_uso = NOW() WHERE id = p_id;
$$;

REVOKE EXECUTE ON FUNCTION registrar_hit_faq_cache(UUID) FROM PUBLIC, authenticated, anon;
