import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { MAX_OPERADORES } from '@/lib/permisos'

async function verificarAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: perfil } = await supabase
    .from('perfiles')
    .select('rol')
    .eq('id', user.id)
    .single()

  return perfil?.rol === 'admin' ? user : null
}

export async function POST(request: Request) {
  const adminUser = await verificarAdmin()
  if (!adminUser) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { nombre, email, password, permisos } = await request.json()

  if (!nombre || !email || !password) {
    return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
  }

  const supabase = await createClient()

  // Verificar límite de operadores
  const { count } = await supabase
    .from('perfiles')
    .select('id', { count: 'exact', head: true })
    .eq('rol', 'operador')

  if ((count ?? 0) >= MAX_OPERADORES) {
    return NextResponse.json(
      { error: `Límite de ${MAX_OPERADORES} operadores alcanzado` },
      { status: 400 }
    )
  }

  const adminClient = createAdminClient()

  const { data: newUser, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError || !newUser.user) {
    return NextResponse.json({ error: authError?.message ?? 'Error al crear usuario' }, { status: 500 })
  }

  const { error: perfilError } = await adminClient
    .from('perfiles')
    .insert({
      id: newUser.user.id,
      nombre,
      rol: 'operador',
      permisos: Array.isArray(permisos) ? permisos : null,
    })

  if (perfilError) {
    await adminClient.auth.admin.deleteUser(newUser.user.id)
    return NextResponse.json({ error: 'Error al crear perfil' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, userId: newUser.user.id })
}

export async function PATCH(request: Request) {
  const adminUser = await verificarAdmin()
  if (!adminUser) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { userId, permisos } = await request.json()

  if (!userId || !Array.isArray(permisos)) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('perfiles')
    .update({ permisos })
    .eq('id', userId)
    .eq('rol', 'operador') // solo se pueden editar operadores

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

  if (userId === adminUser.id) {
    return NextResponse.json({ error: 'No podés eliminarte a vos mismo' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const { error } = await adminClient.auth.admin.deleteUser(userId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
