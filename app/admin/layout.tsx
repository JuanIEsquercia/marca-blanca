import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import AdminSidebar from '@/components/admin/AdminSidebar'
import { MODULOS, puedeAcceder } from '@/lib/permisos'
import type { ModuloKey } from '@/lib/permisos'

const MODULO_KEYS = MODULOS.map(m => m.key)

// El segmento de URL no siempre coincide con la key del módulo (la Caja de
// un proyecto vive en /caja pero su permiso es 'tesoreria') — sin este mapeo
// el guard de abajo nunca matchea ese segmento y la ruta queda sin proteger.
const SEGMENTO_A_MODULO: Record<string, ModuloKey> = { caja: 'tesoreria' }

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
  const permisosEmpresa = constructoraCtx?.perfilPermisos ?? []
  const proyectosAsignados = constructoraCtx?.perfilProyectos ?? []

  const pathname = headersList.get('x-pathname') ?? ''
  const segmentos = pathname.split('/')
  const esRutaDeProyecto = segmentos[2] === 'proyectos'

  // Operador: bloquear cualquier proyecto que no esté en su árbol (además del
  // enforcement en getProyectoContext() — esto corta antes de renderizar).
  if (rol !== 'admin' && esRutaDeProyecto && segmentos[3] && !proyectosAsignados.some(p => p.obraId === segmentos[3])) {
    redirect('/admin')
  }

  // Guard de rutas por módulo — mismo chequeo que usa AdminSidebar para
  // decidir qué mostrar en la nav (puedeAcceder), así no pueden desincronizarse.
  if (rol !== 'admin') {
    const segmentoCrudo = esRutaDeProyecto ? segmentos[4] : segmentos[2]
    const segmento = segmentoCrudo
      ? (SEGMENTO_A_MODULO[segmentoCrudo] ?? (segmentoCrudo as ModuloKey))
      : undefined
    const obraIdActual = esRutaDeProyecto ? (segmentos[3] ?? null) : null

    if (segmento && MODULO_KEYS.includes(segmento as ModuloKey) && !puedeAcceder(rol, permisosEmpresa, proyectosAsignados, segmento, obraIdActual)) {
      redirect('/admin')
    }
  }

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-slate-50 overflow-hidden admin-typography-system">
      <AdminSidebar
        userName={constructoraCtx?.perfilNombre ?? user.email ?? 'Usuario'}
        userRole={rol}
        permisosEmpresa={permisosEmpresa}
        proyectos={proyectosAsignados}
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
