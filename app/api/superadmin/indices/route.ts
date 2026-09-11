import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { TIPO_CAC } from '@/lib/indices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Carga manual de índices que no tienen API pública (migration_078).
//
// Por qué vive en superadmin y no en el panel de cada constructora: el CAC
// es un índice nacional, uno solo para todo el mundo. Si cada empresa
// cargara el suyo, dos contratos idénticos ajustarían distinto según quién
// tipeó el número. `indices_valores` es global y no tiene policy de
// escritura justamente por eso: solo entra por acá, con service role.
async function verifySuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const SA = process.env.SUPERADMIN_EMAIL
  if (!SA || !user || user.email !== SA) return null
  return user
}

// Se acepta CAC y cualquier otra serie manual que se sume después, pero
// NUNCA una que capture el cron: sobrescribir a mano un valor del BCRA es
// exactamente el tipo de dato que después nadie puede explicar.
const TIPOS_MANUALES = new Set([TIPO_CAC])

export async function GET() {
  if (!await verifySuperAdmin()) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const { data, error } = await createAdminClient()
    .from('indices_valores')
    .select('tipo, fecha, valor, fuente')
    .order('fecha', { ascending: false })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ valores: data ?? [] })
}

export async function POST(request: Request) {
  if (!await verifySuperAdmin()) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const { tipo, fecha, valor } = await request.json()

  if (!TIPOS_MANUALES.has(tipo)) {
    return NextResponse.json(
      { error: `Solo se cargan a mano los índices sin API pública (${[...TIPOS_MANUALES].join(', ')}). El resto los trae el cron del BCRA.` },
      { status: 400 }
    )
  }
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: 'La fecha tiene que venir como YYYY-MM-DD.' }, { status: 400 })
  }
  const numero = Number(valor)
  if (!Number.isFinite(numero) || numero <= 0) {
    return NextResponse.json({ error: 'El valor del índice tiene que ser un número mayor a 0.' }, { status: 400 })
  }

  // Upsert sobre (tipo, fecha): recargar un mes ya cargado lo corrige en
  // vez de duplicarlo. Las cuotas ya EMITIDAS no se ven afectadas — su
  // monto quedó congelado con el valor del día de la emisión, que se
  // guardó aparte (migration_079).
  const { error } = await createAdminClient()
    .from('indices_valores')
    .upsert({ tipo, fecha, valor: numero, fuente: 'manual' }, { onConflict: 'tipo,fecha' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
