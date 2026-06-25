import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

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

  const { nombre, email, password, rol } = await request.json()

  if (!nombre || !email || !password) {
    return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Crear usuario en Supabase Auth
  const { data: newUser, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError || !newUser.user) {
    return NextResponse.json({ error: authError?.message ?? 'Error al crear usuario' }, { status: 500 })
  }

  // Crear perfil asociado
  const { error: perfilError } = await adminClient
    .from('perfiles')
    .insert({ id: newUser.user.id, nombre, rol: rol ?? 'operador' })

  if (perfilError) {
    await adminClient.auth.admin.deleteUser(newUser.user.id)
    return NextResponse.json({ error: 'Error al crear perfil' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, userId: newUser.user.id })
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
