import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { capturarIndices, type TipoIndice } from '@/lib/indices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// El backfill inicial trae años de historia de seis series; la ventana
// diaria termina en segundos, pero el primero necesita margen.
export const maxDuration = 60

// Captura diaria de índices y cotizaciones del BCRA (migration_078).
//
// Dos formas de dispararlo, y ninguna es pública:
//   - Vercel Cron, que manda `Authorization: Bearer $CRON_SECRET`.
//   - A mano, logueado como superadmin (para backfill o para reintentar
//     un día que falló, sin esperar al cron).
//
// Idempotente: hace upsert sobre (tipo, fecha), así que se puede correr
// las veces que haga falta sin duplicar ni pisar mal.
async function autorizado(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') === `Bearer ${secret}`) return true

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const superadmin = process.env.SUPERADMIN_EMAIL
  return !!superadmin && !!user && user.email === superadmin
}

export async function GET(request: Request) {
  if (!await autorizado(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)

  // ?desde=YYYY-MM-DD para el backfill inicial. Sin él, ventana corta.
  const desdeParam = searchParams.get('desde')
  const desde = desdeParam && /^\d{4}-\d{2}-\d{2}$/.test(desdeParam) ? desdeParam : undefined

  // ?tipos=UVI,USD_MAYORISTA para reintentar una serie puntual.
  const tiposParam = searchParams.get('tipos')
  const tipos = tiposParam ? (tiposParam.split(',').map(t => t.trim()) as TipoIndice[]) : undefined

  const resultados = await capturarIndices(createAdminClient(), { desde, tipos })
  const conError = resultados.filter(r => r.error)

  return NextResponse.json(
    {
      ok: conError.length === 0,
      desde: desde ?? '(ventana corta por defecto)',
      resultados,
    },
    // 207 cuando algunas series entraron y otras no: el cron de Vercel lo
    // marca como fallo y queda visible, en vez de un 200 que esconde que
    // media captura no ocurrió.
    { status: conError.length === 0 ? 200 : 207 }
  )
}
