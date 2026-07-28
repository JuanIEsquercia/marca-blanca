import { createAdminClient, traducirErrorAuth } from '@/lib/supabase/admin'
import { getConstructoraContext } from '@/lib/tenant'
import { NextResponse } from 'next/server'
import { MAX_OPERADORES, MODULOS_EMPRESA, modulosDisponibles, type TipoProyecto } from '@/lib/permisos'

interface ProyectoInput {
  obraId: string
  permisos: string[]
}

// Valida que cada proyecto recibido pertenezca a la constructora (una sola
// query con .in() para todos, en vez de una por proyecto) y filtra sus
// permisos server-side según el tipo real del proyecto — no confía en que
// el checklist del cliente ya lo hizo. Devuelve un NextResponse de error si
// algún obraId no es válido.
async function validarYFiltrarProyectos(
  adminClient: ReturnType<typeof createAdminClient>,
  constructoraId: string,
  proyectos: ProyectoInput[]
): Promise<{ proyectos: ProyectoInput[] } | { error: NextResponse }> {
  const obraIds = [...new Set(proyectos.map(p => p.obraId))]
  if (obraIds.length === 0) return { proyectos: [] }

  const { data: obras } = await adminClient
    .from('obras')
    .select('id, tipo')
    .eq('constructora_id', constructoraId)
    .in('id', obraIds)

  const tipoPorObra = new Map((obras ?? []).map(o => [o.id, o.tipo as TipoProyecto]))

  if (obraIds.some(id => !tipoPorObra.has(id))) {
    return { error: NextResponse.json({ error: 'El proyecto no pertenece a tu constructora' }, { status: 400 }) }
  }

  return {
    proyectos: proyectos.map(p => ({
      obraId: p.obraId,
      permisos: Array.isArray(p.permisos)
        ? p.permisos.filter(m => modulosDisponibles(tipoPorObra.get(p.obraId)!).some(mod => mod.key === m))
        : [],
    })),
  }
}

// Cachea (React cache(), vía getConstructoraContext) en vez de hacer su
// propio getUser()+query a 'perfiles' — antes esto duplicaba la resolución
// de auth/tenant que ya hace el resto del panel en la misma request.
async function verificarAdmin() {
  const ctx = await getConstructoraContext()
  if (!ctx || ctx.perfilRol !== 'admin') return null
  return ctx
}

export async function POST(request: Request) {
  const ctx = await verificarAdmin()
  if (!ctx) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { nombre, email, password, proyectos, permisosEmpresa } = await request.json()

  if (!nombre || !email || !password) {
    return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const proyectosValidados = await validarYFiltrarProyectos(
    adminClient, ctx.constructoraId, Array.isArray(proyectos) ? proyectos : []
  )
  if ('error' in proyectosValidados) return proyectosValidados.error

  const permisosEmpresaFiltrados = Array.isArray(permisosEmpresa)
    ? permisosEmpresa.filter((p: string) => MODULOS_EMPRESA.includes(p as never))
    : []

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
    return NextResponse.json({ error: authError ? traducirErrorAuth(authError.message) : 'Error al crear usuario' }, { status: 500 })
  }

  // Upsert del perfil con nombre, permisos (bucket Empresa) y constructora_id
  // correctos (el trigger puede haberse ejecutado antes con valores de metadata)
  const { error: perfilError } = await adminClient
    .from('perfiles')
    .upsert({
      id: newUser.user.id,
      nombre,
      rol: 'operador',
      permisos: permisosEmpresaFiltrados,
      constructora_id: ctx.constructoraId,
    }, { onConflict: 'id' })

  if (perfilError) {
    await adminClient.auth.admin.deleteUser(newUser.user.id)
    return NextResponse.json({ error: 'Error al crear perfil' }, { status: 500 })
  }

  if (proyectosValidados.proyectos.length > 0) {
    const { error: proyectosError } = await adminClient.from('perfil_proyectos').insert(
      proyectosValidados.proyectos.map(p => ({
        perfil_id: newUser.user.id,
        obra_id: p.obraId,
        constructora_id: ctx.constructoraId,
        permisos: p.permisos,
      }))
    )
    if (proyectosError) {
      await adminClient.auth.admin.deleteUser(newUser.user.id)
      return NextResponse.json({ error: 'Error al asignar proyectos' }, { status: 500 })
    }
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
  const ctx = await verificarAdmin()
  if (!ctx) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { userId, proyectos, permisosEmpresa } = await request.json()

  if (!userId || !Array.isArray(proyectos)) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const { data: targetPerfil } = await adminClient
    .from('perfiles')
    .select('constructora_id')
    .eq('id', userId)
    .single()

  if (!targetPerfil || targetPerfil.constructora_id !== ctx.constructoraId) {
    return NextResponse.json({ error: 'Usuario no pertenece a tu constructora' }, { status: 403 })
  }

  const proyectosValidados = await validarYFiltrarProyectos(adminClient, ctx.constructoraId, proyectos)
  if ('error' in proyectosValidados) return proyectosValidados.error

  const permisosEmpresaFiltrados = Array.isArray(permisosEmpresa)
    ? permisosEmpresa.filter((p: string) => MODULOS_EMPRESA.includes(p as never))
    : []

  const { error: perfilError } = await adminClient
    .from('perfiles')
    .update({ permisos: permisosEmpresaFiltrados })
    .eq('id', userId)
    .eq('rol', 'operador')
    .eq('constructora_id', ctx.constructoraId)

  if (perfilError) {
    return NextResponse.json({ error: perfilError.message }, { status: 500 })
  }

  // RPC transaccional (DELETE + INSERT en una sola sentencia) — evita dejar
  // al operador sin proyectos si dos llamadas JS separadas fallaran a mitad.
  const { error: syncError } = await adminClient.rpc('sync_perfil_proyectos', {
    p_perfil_id: userId,
    p_constructora_id: ctx.constructoraId,
    p_rows: proyectosValidados.proyectos.map(p => ({ obraId: p.obraId, permisos: p.permisos })),
  })

  if (syncError) {
    return NextResponse.json({ error: syncError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const ctx = await verificarAdmin()
  if (!ctx) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { userId } = await request.json()

  if (userId === ctx.userId) {
    return NextResponse.json({ error: 'No podés eliminarte a vos mismo' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const { data: targetPerfil } = await adminClient
    .from('perfiles')
    .select('constructora_id')
    .eq('id', userId)
    .single()

  if (!targetPerfil || targetPerfil.constructora_id !== ctx.constructoraId) {
    return NextResponse.json({ error: 'Usuario no pertenece a tu constructora' }, { status: 403 })
  }

  const { error } = await adminClient.auth.admin.deleteUser(userId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
