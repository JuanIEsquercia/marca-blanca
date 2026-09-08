import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getConstructoraContext } from '@/lib/tenant'
import { puedeAcceder } from '@/lib/permisos'
import { extraerDatosFactura } from '@/lib/factura-extraccion'
import { BUCKET_COMPROBANTES, pathDesdeReferencia } from '@/lib/comprobantes'

// Recibe la referencia "storage://comprobantes/<constructora_id>/<uuid>.<ext>"
// del archivo recién subido (ver lib/comprobantes.ts), verifica que esté
// dentro de la carpeta de ESTA constructora, y le pasa a Claude una URL
// firmada de corta vida para leerlo. Nunca acepta una URL arbitraria —
// antes se aceptaba cualquier URL de Cloudinary del cloud propio.
export async function POST(request: Request) {
  const ctx = await getConstructoraContext()
  if (!ctx) return NextResponse.json({ error: 'Sin permisos' }, { status: 401 })
  if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'gastos', null)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  let body: { comprobante?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const path = typeof body.comprobante === 'string' ? pathDesdeReferencia(body.comprobante) : null
  if (!path || !path.startsWith(`${ctx.constructoraId}/`)) {
    return NextResponse.json({ error: 'Comprobante inválido' }, { status: 400 })
  }

  const { data: firmada, error: errFirma } = await createAdminClient().storage
    .from(BUCKET_COMPROBANTES)
    .createSignedUrl(path, 5 * 60)
  if (errFirma || !firmada?.signedUrl) {
    return NextResponse.json({ error: 'No se pudo acceder al comprobante' }, { status: 400 })
  }

  try {
    const data = await extraerDatosFactura(firmada.signedUrl)
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error al leer la factura' }, { status: 500 })
  }
}
