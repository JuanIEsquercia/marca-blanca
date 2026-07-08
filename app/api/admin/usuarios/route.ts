import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import { NextResponse } from 'next/server'
import { MAX_OPERADORES, modulosDisponibles, type TipoProyecto } from '@/lib/permisos'

async function verificarAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: perfil } = await supabase
    .from('perfiles')
    .select('rol, constructora_id')
    .eq('id', user.id)
    .single()

  if (perfil?.rol !== 'admin' || !perfil.constructora_id) return null
  return { user, constructoraId: perfil.constructora_id as string }
}

// Si se pasa obraId, valida que pertenezca a la constructora del admin y
// devuelve su tipo. Devuelve undefined (sin error) para obraId=null
// ("operador de toda la empresa"). Devuelve un NextResponse de error si
// el obraId no es válido — el caller debe chequear el resultado.
async function validarObra(
  adminClient: ReturnType<typeof createAdminClient>,
  constructoraId: string,
  obraId: string | null
): Promise<{ tipo: TipoProyecto | null } | { error: NextResponse }> {
  if (!obraId) return { tipo: null }

  const { data: obra } = await adminClient
    .from('obras')
    .select('tipo')
    .eq('id', obraId)
    .eq('constructora_id', constructoraId)
    .maybeSingle()

  if (!obra) {
    return { error: NextResponse.json({ error: 'El proyecto no pertenece a tu constructora' }, { status: 400 }) }
  }

  return { tipo: obra.tipo as TipoProyecto }
}

export async function POST(request: Request) {
  const adminUser = await verificarAdmin()
  if (!adminUser) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const ctx = await getConstructoraContext()
  if (!ctx) {
    return NextResponse.json({ error: 'Sin constructora' }, { status: 403 })
  }

  const { nombre, email, password, permisos, obraId } = await request.json()

  if (!nombre || !email || !password) {
    return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const obraValidada = await validarObra(adminClient, ctx.constructoraId, obraId ?? null)
  if ('error' in obraValidada) return obraValidada.error

  // Defensa server-side: no confiar en que el checklist del cliente ya
  // filtró los módulos según el tipo del proyecto asignado.
  const permisosFiltrados = Array.isArray(permisos)
    ? permisos.filter((p: string) => modulosDisponibles(obraValidada.tipo).some(m => m.key === p))
    : null

  // Verificar límite de operadores para esta constructora
  const { count } = await adminClient
    .from('perfiles')
    .select('id', { count: 'exact', head: true })
    .eq('constructora_id', ctx.constructoraId)
    .eq('rol', 'operador')

  if ((count ?? 0) >= MAX_OPERADORES) {
    return NextResponse.json(
      { error: `Límite de ${MAX_OPERADORES} operadores alcanzado` },
      { status: 400 }
    )
  }

  // Crear usuario en auth — el trigger on_auth_user_created crea el perfil
  // con constructora_id NULL (no auto-asigna tenant); lo corregimos abajo.
  const { data: newUser, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError || !newUser.user) {
    return NextResponse.json({ error: authError?.message ?? 'Error al crear usuario' }, { status: 500 })
  }

  // Upsert del perfil con nombre, permisos y constructora_id correctos
  // (el trigger puede haberse ejecutado antes con valores de metadata)
  const { error: perfilError } = await adminClient
    .from('perfiles')
    .upsert({
      id: newUser.user.id,
      nombre,
      rol: 'operador',
      permisos: permisosFiltrados,
      constructora_id: ctx.constructoraId,
      obra_id: obraId ?? null,
    }, { onConflict: 'id' })

  if (perfilError) {
    await adminClient.auth.admin.deleteUser(newUser.user.id)
    return NextResponse.json({ error: 'Error al crear perfil' }, { status: 500 })
  }

  // Mantener miembros sincronizado con perfiles (mismo patrón que
  // app/api/superadmin/constructoras/route.ts al crear el admin owner).
  await adminClient.from('miembros').upsert(
    { constructora_id: ctx.constructoraId, user_id: newUser.user.id, rol: 'miembro' },
    { onConflict: 'constructora_id,user_id' }
  )

  return NextResponse.json({ ok: true, userId: newUser.user.id })
}

export async function PATCH(request: Request) {
  const adminUser = await verificarAdmin()
  if (!adminUser) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { userId, permisos, obraId } = await request.json()

  if (!userId || !Array.isArray(permisos)) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const { data: targetPerfil } = await adminClient
    .from('perfiles')
    .select('constructora_id')
    .eq('id', userId)
    .single()

  if (!targetPerfil || targetPerfil.constructora_id !== adminUser.constructoraId) {
    return NextResponse.json({ error: 'Usuario no pertenece a tu constructora' }, { status: 403 })
  }

  const obraIdRecibida: string | null = obraId ?? null
  const obraValidada = await validarObra(adminClient, adminUser.constructoraId, obraIdRecibida)
  if ('error' in obraValidada) return obraValidada.error

  const permisosFiltrados = permisos.filter((p: string) =>
    modulosDisponibles(obraValidada.tipo).some(m => m.key === p)
  )

  const { error } = await adminClient
    .from('perfiles')
    .update({ permisos: permisosFiltrados, obra_id: obraIdRecibida })
    .eq('id', userId)
    .eq('rol', 'operador')
    .eq('constructora_id', adminUser.constructoraId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const adminUser = await verificarAdmin()
  if (!adminUser) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { userId } = await request.json()

  if (userId === adminUser.user.id) {
    return NextResponse.json({ error: 'No podés eliminarte a vos mismo' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const { data: targetPerfil } = await adminClient
    .from('perfiles')
    .select('constructora_id')
    .eq('id', userId)
    .single()

  if (!targetPerfil || targetPerfil.constructora_id !== adminUser.constructoraId) {
    return NextResponse.json({ error: 'Usuario no pertenece a tu constructora' }, { status: 403 })
  }

  const { error } = await adminClient.auth.admin.deleteUser(userId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
