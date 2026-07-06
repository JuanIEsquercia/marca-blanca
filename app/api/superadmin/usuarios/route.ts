import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

async function verifySuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const SA = process.env.SUPERADMIN_EMAIL
  if (!SA || user.email !== SA) return null
  return user
}

// Cambiar contraseña de un usuario
export async function PATCH(request: Request) {
  const caller = await verifySuperAdmin()
  if (!caller) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const { userId, password } = await request.json()
  if (!userId || !password || password.length < 8) {
    return NextResponse.json({ error: 'La contraseña debe tener al menos 8 caracteres' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const { error } = await adminClient.auth.admin.updateUserById(userId, { password })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// Eliminar un usuario de una constructora
export async function DELETE(request: Request) {
  const caller = await verifySuperAdmin()
  if (!caller) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const { userId } = await request.json()
  if (!userId) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  const adminClient = createAdminClient()
  const { error } = await adminClient.auth.admin.deleteUser(userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
