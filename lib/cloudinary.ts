export interface CloudinaryUploadResult {
  secure_url: string
  public_id: string
  width: number
  height: number
  format: string
}

/**
 * Sube un archivo directamente desde el browser a Cloudinary
 * usando un upload preset unsigned — sin pasar por el servidor.
 *
 * @param file    Archivo a subir
 * @param folder  Subcarpeta dentro de la carpeta del desarrollo
 *                ej: "amenities" → sube a torre-zentrum/amenities/
 */
export async function uploadToCloudinary(
  file: File,
  folder: 'amenities' | 'tipologias' | 'renders' | 'portada'
): Promise<CloudinaryUploadResult> {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET
  const baseFolder = process.env.NEXT_PUBLIC_CLOUDINARY_FOLDER ?? 'desarrollo'

  if (!cloudName || !uploadPreset) {
    throw new Error('Cloudinary no configurado. Revisá NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME y NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET en .env.local')
  }

  const formData = new FormData()
  formData.append('file', file)
  formData.append('upload_preset', uploadPreset)
  formData.append('folder', `${baseFolder}/${folder}`)

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: 'POST', body: formData }
  )

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error?.message ?? 'Error al subir imagen a Cloudinary')
  }

  return res.json()
}

/**
 * Genera una URL optimizada de Cloudinary con transformaciones.
 * Sirve WebP/AVIF automáticamente según el browser.
 *
 * @param url     URL original de Cloudinary (secure_url)
 * @param width   Ancho deseado en px
 * @param quality Calidad (1-100 o 'auto')
 */
export function cloudinaryUrl(
  url: string,
  width?: number,
  quality: number | 'auto' = 'auto'
): string {
  if (!url || !url.includes('cloudinary.com')) return url

  // Insertar transformaciones en la URL de Cloudinary
  const transforms = [
    width ? `w_${width}` : '',
    `q_${quality}`,
    'f_auto',        // formato automático (WebP/AVIF según browser)
    'c_fill',        // recorte inteligente
  ].filter(Boolean).join(',')

  return url.replace('/upload/', `/upload/${transforms}/`)
}
