import { createAdminClient, listarTodosLosUsuarios } from '@/lib/supabase/admin'
import ConstructorasManager from './ConstructorasManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Panel de Administración' }
export const dynamic = 'force-dynamic'

export default async function SuperAdminPage() {
  const adminClient = createAdminClient()

  const [
    { data: constructoras },
    { data: perfiles },
    authUsers,
    { data: numeros },
  ] = await Promise.all([
    adminClient.from('constructoras')
      .select('id, nombre, owner_id, created_at, razon_social, cuit, condicion_iva, email_facturacion, telefono_contacto, direccion')
      .order('created_at', { ascending: false }),
    adminClient.from('perfiles').select('id, nombre, rol, constructora_id').not('constructora_id', 'is', null),
    listarTodosLosUsuarios(adminClient),
    adminClient.from('whatsapp_numeros').select('constructora_id, kapso_phone_id, numero').eq('activo', true),
  ])

  const data = (constructoras ?? []).map(c => {
    const perfilesDeEsta = (perfiles ?? []).filter(p => p.constructora_id === c.id)
    const usuarios = perfilesDeEsta.map(p => {
      const authUser = authUsers.find(u => u.id === p.id)
      return { id: p.id, nombre: p.nombre, email: authUser?.email ?? null, rol: p.rol }
    })
    const numero = (numeros ?? []).find(n => n.constructora_id === c.id)
    return {
      id: c.id, nombre: c.nombre, createdAt: c.created_at, usuarios,
      kapsoPhoneId: numero?.kapso_phone_id ?? null,
      numeroWhatsapp: numero?.numero ?? null,
      razonSocial: c.razon_social,
      cuit: c.cuit,
      condicionIva: c.condicion_iva,
      emailFacturacion: c.email_facturacion,
      telefonoContacto: c.telefono_contacto,
      direccion: c.direccion,
    }
  })

  return <ConstructorasManager initialData={data} />
}
