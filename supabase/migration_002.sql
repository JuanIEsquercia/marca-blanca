-- ============================================================
-- MIGRATION 002: Imagen de portada en tipologias (Cloudinary URL)
-- ============================================================
ALTER TABLE tipologias
  ADD COLUMN IF NOT EXISTS imagen_portada TEXT;
