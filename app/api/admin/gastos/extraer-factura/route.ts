import { NextResponse } from 'next/server'
import { getConstructoraContext } from '@/lib/tenant'
import { puedeAcceder } from '@/lib/permisos'
import { extraerDatosFactura } from '@/lib/factura-extraccion'

export async function POST(request: Request) {
  const ctx = await getConstructoraContext()
  if (!ctx) return NextResponse.json({ error: 'Sin permisos' }, { status: 401 })
  if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'gastos', null)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { imageUrl } = await request.json()
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  if (
    !imageUrl || typeof imageUrl !== 'string' ||
    !cloudName || !imageUrl.startsWith(`https://res.cloudinary.com/${cloudName}/`)
  ) {
    return NextResponse.json({ error: 'imageUrl inválida' }, { status: 400 })
  }

  try {
    const data = await extraerDatosFactura(imageUrl)
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error al leer la factura' }, { status: 500 })
  }
}
