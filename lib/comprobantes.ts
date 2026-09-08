import type { SupabaseClient } from '@supabase/supabase-js'

// Fotos/PDFs de facturas y recibos (gastos.comprobante_url,
// cobros_proyecto.comprobante_url, cuotas.comprobante_url).
//
// Desde migration_072 van al bucket PRIVADO `comprobantes` de Supabase
// Storage, en la carpeta de la constructora (la RLS de storage.objects
// solo deja leer/subir dentro de la propia) — antes iban a Cloudinary con
// un preset unsigned y quedaban como URL pública sin auth.
//
// En la columna se guarda una referencia "storage://comprobantes/<path>",
// no una URL: el archivo solo se ve con una URL firmada de corta vida que
// se genera al momento de abrirlo (resolverUrlComprobante). Los valores
// viejos (https://res.cloudinary.com/...) se dejan tal cual y se siguen
// abriendo directo — no se migran archivos.

export const BUCKET_COMPROBANTES = 'comprobantes'
const PREFIJO_STORAGE = `storage://${BUCKET_COMPROBANTES}/`
const URL_FIRMADA_SEGUNDOS = 60 * 60

const EXTENSION_POR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

export function esComprobanteEnStorage(valor: string | null | undefined): boolean {
  return !!valor && valor.startsWith(PREFIJO_STORAGE)
}

// "storage://comprobantes/<constructora_id>/<uuid>.jpg" -> "<constructora_id>/<uuid>.jpg"
export function pathDesdeReferencia(referencia: string): string | null {
  if (!esComprobanteEnStorage(referencia)) return null
  const path = referencia.slice(PREFIJO_STORAGE.length)
  return path.length > 0 ? path : null
}

export async function subirComprobante(supabase: SupabaseClient, constructoraId: string, file: File): Promise<string> {
  const extension = EXTENSION_POR_MIME[file.type]
  if (!extension) throw new Error('Formato no soportado — solo JPG, PNG, WebP o PDF.')

  const path = `${constructoraId}/${crypto.randomUUID()}.${extension}`
  const { error } = await supabase.storage
    .from(BUCKET_COMPROBANTES)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(error.message)

  return `${PREFIJO_STORAGE}${path}`
}

// URL con la que se puede abrir el archivo AHORA (vence en 1 hora). Para un
// valor viejo de Cloudinary devuelve la misma URL, así el caller no tiene
// que distinguir los dos casos.
export async function resolverUrlComprobante(supabase: SupabaseClient, referenciaOUrl: string): Promise<string> {
  const path = pathDesdeReferencia(referenciaOUrl)
  if (!path) return referenciaOUrl

  const { data, error } = await supabase.storage
    .from(BUCKET_COMPROBANTES)
    .createSignedUrl(path, URL_FIRMADA_SEGUNDOS)
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'No se pudo generar el acceso al comprobante')
  return data.signedUrl
}
