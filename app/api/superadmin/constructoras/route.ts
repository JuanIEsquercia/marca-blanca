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

export async function GET() {
  const caller = await verifySuperAdmin()
  if (!caller) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const adminClient = createAdminClient()

  const [
    { data: constructoras },
    { data: perfiles },
    { data: authData },
  ] = await Promise.all([
    adminClient.from('constructoras').select('id, nombre, owner_id, created_at').order('created_at', { ascending: false }),
    adminClient.from('perfiles').select('id, nombre, rol, constructora_id').not('constructora_id', 'is', null),
    adminClient.auth.admin.listUsers(),
  ])

  const result = (constructoras ?? []).map(c => {
    const perfilesDeEsta = (perfiles ?? []).filter(p => p.constructora_id === c.id)
    const usuarios = perfilesDeEsta.map(p => {
      const authUser = authData?.users.find(u => u.id === p.id)
      return { id: p.id, nombre: p.nombre, email: authUser?.email ?? null, rol: p.rol }
    })
    return {
      id: c.id,
      nombre: c.nombre,
      createdAt: c.created_at,
      usuarios,
    }
  })

  return NextResponse.json(result)
}

export async function POST(request: Request) {
  const caller = await verifySuperAdmin()
  if (!caller) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const { nombre, adminEmail, adminPassword, adminNombre } = await request.json()
  if (!nombre?.trim() || !adminEmail?.trim() || !adminPassword?.trim()) {
    return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const { data: newUser, error: authError } = await adminClient.auth.admin.createUser({
    email: adminEmail.trim().toLowerCase(),
    password: adminPassword,
    email_confirm: true,
  })

  if (authError || !newUser.user) {
    return NextResponse.json({ error: authError?.message ?? 'Error al crear el usuario' }, { status: 500 })
  }

  const userId = newUser.user.id

  const { data: constructora, error: cError } = await adminClient
    .from('constructoras')
    .insert({ nombre: nombre.trim(), owner_id: userId })
    .select('id').single()

  if (cError || !constructora) {
    await adminClient.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: 'Error al crear la constructora' }, { status: 500 })
  }

  const nombreAdmin = adminNombre?.trim() || adminEmail.split('@')[0]

  const { error: perfilError } = await adminClient
    .from('perfiles')
    .upsert({ id: userId, nombre: nombreAdmin, rol: 'admin', constructora_id: constructora.id }, { onConflict: 'id' })

  if (perfilError) {
    await adminClient
      .from('perfiles')
      .upsert({ id: userId, nombre: nombreAdmin, rol: 'admin' }, { onConflict: 'id' })
  }

  await adminClient.from('miembros').upsert(
    { constructora_id: constructora.id, user_id: userId, rol: 'admin' },
    { onConflict: 'constructora_id,user_id' }
  )

  await adminClient.from('categorias_costo').insert([
    { constructora_id: constructora.id, nombre: 'Materiales',               color: '#f59e0b' },
    { constructora_id: constructora.id, nombre: 'Mano de obra',              color: '#ef4444' },
    { constructora_id: constructora.id, nombre: 'Honorarios profesionales',  color: '#8b5cf6' },
    { constructora_id: constructora.id, nombre: 'Marketing y ventas',        color: '#06b6d4' },
    { constructora_id: constructora.id, nombre: 'Gastos administrativos',    color: '#64748b' },
    { constructora_id: constructora.id, nombre: 'Terreno',                   color: '#10b981' },
    { constructora_id: constructora.id, nombre: 'Impuestos y tasas',         color: '#f97316' },
  ])

  return NextResponse.json({ ok: true, constructoraId: constructora.id, userId })
}

export async function PATCH(request: Request) {
  const caller = await verifySuperAdmin()
  if (!caller) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const { constructoraId, nombre } = await request.json()
  if (!constructoraId || !nombre?.trim()) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('constructoras')
    .update({ nombre: nombre.trim() })
    .eq('id', constructoraId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const caller = await verifySuperAdmin()
  if (!caller) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const { constructoraId } = await request.json()
  if (!constructoraId) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  const adminClient = createAdminClient()

  // Obtener todos los usuarios de esta constructora
  const { data: perfilesDeEsta } = await adminClient
    .from('perfiles')
    .select('id')
    .eq('constructora_id', constructoraId)

  // Limpiar perfiles y miembros antes de eliminar auth users
  await adminClient.from('miembros').delete().eq('constructora_id', constructoraId)
  await adminClient.from('perfiles').delete().eq('constructora_id', constructoraId)

  // Eliminar usuarios de auth
  for (const p of perfilesDeEsta ?? []) {
    await adminClient.auth.admin.deleteUser(p.id)
  }

  // Eliminar la constructora — fallará si tiene obras u otros datos relacionados
  const { error } = await adminClient
    .from('constructoras')
    .delete()
    .eq('id', constructoraId)

  if (error) {
    return NextResponse.json(
      { error: 'No se puede eliminar: la constructora tiene proyectos u otros datos asociados. Eliminá primero todos los proyectos.' },
      { status: 409 }
    )
  }
  return NextResponse.json({ ok: true })
}
