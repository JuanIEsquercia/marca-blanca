-- ------------------------------------------------------------
-- migration_072.sql — hardening tras la auditoría de seguridad 2026-08-24.
-- Cuatro puntos independientes, todos idempotentes:
--
-- 1. purgar_obra_completa(): exige es_admin() adentro de la función.
--    Era SECURITY INVOKER sin ningún chequeo de rol y sin REVOKE — la
--    ruta /api/admin/proyecto/[obraId] ya lo exigía desde 2026-08-03,
--    pero el RPC seguía siendo invocable directo por PostgREST con la
--    anon key + JWT de cualquier operador. Como setea app.bypass_inmutable
--    (apaga los triggers de "Pagado inmutable" y "proyecto cerrado") y las
--    policies de gastos/cobros/certificados son por módulo (no admin), un
--    operador con un solo módulo podía borrar todos los registros
--    financieros de su proyecto a los que tuviera permiso. El DELETE final
--    de obras fallaba en silencio (0 filas), así que quedaba la obra vacía.
--
-- 2. constructoras: trigger que bloquea cambios a chat_limite_mensual_usd
--    y owner_id fuera del service role. La policy constructoras_owner_edita
--    (FOR UPDATE, owner_id = auth.uid()) restringe LA FILA pero no las
--    columnas — el propio owner podía subir el tope de gasto de IA que fija
--    el superadmin (y que paga la plataforma). Mismo patrón que
--    proteger_columnas_sensibles_perfil (migration_028).
--
-- 3. chat_uso: se saca la policy de INSERT para authenticated. El registro
--    de consumo lo escribe ahora el servidor con service role
--    (lib/chat/agente.ts, registrarUso) — antes iba con la sesión del
--    usuario, lo que dejaba a cualquier operador insertar filas de consumo
--    falsas y bloquear el chat de todo su tenant por el tope mensual.
--
-- 4. Bucket privado `comprobantes` en Storage, con RLS por tenant sobre
--    storage.objects (carpeta raíz = constructora_id). Las fotos de
--    facturas/recibos se subían a Cloudinary con un preset unsigned público
--    y quedaban como URL pública sin auth — para un dato financiero eso no
--    alcanza. Los comprobante_url viejos (https://res.cloudinary.com/...)
--    siguen funcionando tal cual; los nuevos se guardan como
--    "storage://comprobantes/<constructora_id>/<uuid>.<ext>" y se sirven
--    con URL firmada de 1 hora (ver lib/comprobantes.ts).
-- ------------------------------------------------------------

-- ---------- 1. purgar_obra_completa: solo admin ----------

CREATE OR REPLACE FUNCTION purgar_obra_completa(p_obra_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Chequeo explícito de rol ANTES del bypass: la RLS de las tablas hijas
  -- autoriza por módulo (tiene_permiso_proyecto), no por admin, y el
  -- bypass de abajo apaga los triggers de inmutabilidad — sin esto un
  -- operador podía vaciar el proyecto por PostgREST directo.
  IF NOT es_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede eliminar un proyecto.';
  END IF;

  -- Que el proyecto sea de la constructora del caller (mis_constructoras()
  -- ya lo filtra vía RLS de obras, pero explícito es más claro y no
  -- depende de que el SELECT devuelva 0 filas en silencio).
  IF NOT EXISTS (
    SELECT 1 FROM obras WHERE id = p_obra_id AND constructora_id IN (SELECT mis_constructoras())
  ) THEN
    RAISE EXCEPTION 'Proyecto no encontrado.';
  END IF;

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

ALTER FUNCTION purgar_obra_completa(UUID) SET search_path = public;

-- ---------- 2. constructoras: columnas sensibles ----------

CREATE OR REPLACE FUNCTION proteger_columnas_sensibles_constructora()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.chat_limite_mensual_usd IS DISTINCT FROM OLD.chat_limite_mensual_usd
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'El límite del asistente y el dueño de la constructora solo los puede cambiar la plataforma.';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION proteger_columnas_sensibles_constructora() SET search_path = public;

DROP TRIGGER IF EXISTS trg_proteger_columnas_sensibles_constructora ON constructoras;
CREATE TRIGGER trg_proteger_columnas_sensibles_constructora
  BEFORE UPDATE ON constructoras
  FOR EACH ROW EXECUTE FUNCTION proteger_columnas_sensibles_constructora();

-- ---------- 3. chat_uso: insert solo desde el servidor ----------

DROP POLICY IF EXISTS "chat_uso_insert_propio" ON chat_uso;

-- ---------- 4. Storage: bucket privado de comprobantes ----------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'comprobantes', 'comprobantes', false,
  10485760,  -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- La carpeta raíz del objeto es el constructora_id — un usuario solo
-- puede leer/subir dentro de la carpeta de su propia constructora.
-- Se compara como texto (no cast a uuid) para que un nombre de carpeta
-- inválido dé "false" en vez de un error de cast.
DROP POLICY IF EXISTS "comprobantes_tenant_lee" ON storage.objects;
CREATE POLICY "comprobantes_tenant_lee" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'comprobantes'
    AND (storage.foldername(name))[1] IN (SELECT c::text FROM mis_constructoras() c)
  );

DROP POLICY IF EXISTS "comprobantes_tenant_sube" ON storage.objects;
CREATE POLICY "comprobantes_tenant_sube" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'comprobantes'
    AND (storage.foldername(name))[1] IN (SELECT c::text FROM mis_constructoras() c)
  );
