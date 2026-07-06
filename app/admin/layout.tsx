import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import AdminSidebar from '@/components/admin/AdminSidebar'
import { MODULOS } from '@/lib/permisos'
import type { ModuloKey } from '@/lib/permisos'

const MODULO_KEYS = MODULOS.map(m => m.key)

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Autenticación y contexto en paralelo
  const supabase = await createClient()
  const [{ data: { user } }, headersList] = await Promise.all([
    supabase.auth.getUser(),
    headers(),
  ])

  if (!user) redirect('/auth/login')

  if (process.env.SUPERADMIN_EMAIL && user.email === process.env.SUPERADMIN_EMAIL) {
    redirect('/superadmin')
  }

  // getConstructoraContext está cacheado con React cache() — una sola query a perfiles
  // incluye nombre, rol, permisos y constructora_id (no hay segunda query al layout)
  const constructoraCtx = await getConstructoraContext()

  const rol = constructoraCtx?.perfilRol ?? 'operador'
  const permisos: string[] | null = constructoraCtx?.perfilPermisos ?? null

  // Guard de rutas para operadores con permisos explícitos
  if (rol !== 'admin' && permisos !== null) {
    const pathname = headersList.get('x-pathname') ?? ''
    const segmentos = pathname.split('/')
    const segmento = segmentos[2] === 'proyectos'
      ? (segmentos[4] as ModuloKey | undefined)
      : (segmentos[2] as ModuloKey | undefined)

    if (segmento && MODULO_KEYS.includes(segmento as ModuloKey) && !permisos.includes(segmento)) {
      redirect('/admin')
    }
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden admin-typography-system">
      <AdminSidebar
        userName={constructoraCtx?.perfilNombre ?? user.email ?? 'Usuario'}
        userRole={rol}
        userPermisos={permisos}
        constructoraNombre={constructoraCtx?.constructoraNombre ?? 'Panel ERP'}
      />
      <main className="flex-1 overflow-auto admin-scroll">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
