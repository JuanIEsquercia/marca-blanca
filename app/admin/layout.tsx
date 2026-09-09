import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getAuthUser, getConstructoraContext } from '@/lib/tenant'
import AdminSidebar from '@/components/admin/AdminSidebar'
import BuscadorGlobal from '@/components/admin/BuscadorGlobal'
import Notificaciones from '@/components/admin/Notificaciones'
import ChatAsistente from '@/components/admin/ChatAsistente'
import { MODULOS, puedeAcceder } from '@/lib/permisos'
import type { ModuloKey } from '@/lib/permisos'

const MODULO_KEYS = MODULOS.map(m => m.key)

// El segmento de URL no siempre coincide con la key del módulo (la Caja de
// un proyecto vive en /caja pero su permiso es 'tesoreria') — sin este mapeo
// el guard de abajo nunca matchea ese segmento y la ruta queda sin proteger.
const SEGMENTO_A_MODULO: Record<string, ModuloKey> = { caja: 'tesoreria' }

import AdminBreadcrumbs from '@/components/admin/AdminBreadcrumbs'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Autenticación y headers en paralelo — getAuthUser() está cacheado por
  // request, así que getConstructoraContext() más abajo reusa el mismo user
  // sin disparar un segundo round-trip a Supabase Auth.
  const [user, headersList] = await Promise.all([
    getAuthUser(),
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
  // El motivo viaja en la URL para que /admin muestre un aviso — antes esto
  // devolvía en silencio y era indistinguible de un bug para el operador.
  if (rol !== 'admin' && esRutaDeProyecto && segmentos[3] && !proyectosAsignados.some(p => p.obraId === segmentos[3])) {
    redirect('/admin?motivo=sin-acceso')
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
      redirect('/admin?motivo=sin-acceso')
    }
  }

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden admin-typography-system transition-colors duration-200">
      <AdminSidebar
        userName={constructoraCtx?.perfilNombre ?? user.email ?? 'Usuario'}
        userRole={rol}
        permisosEmpresa={permisosEmpresa}
        proyectos={proyectosAsignados}
        constructoraNombre={constructoraCtx?.constructoraNombre ?? 'Panel ERP'}
      />
      <main className="flex-1 overflow-auto admin-scroll">
        {/* Barra superior: acompaña el scroll del contenido (sticky) para
            que buscar no obligue a volver arriba. El buscador vivía en el
            sidebar, pero ahí el panel de resultados quedaba tan angosto
            que no se leía el contexto de cada resultado. */}
        <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-6 lg:px-8 py-3 flex items-center gap-3">
            <BuscadorGlobal
              rol={rol}
              permisosEmpresa={permisosEmpresa}
              proyectos={proyectosAsignados}
            />
            <div className="ml-auto">
              {constructoraCtx && <Notificaciones constructoraId={constructoraCtx.constructoraId} />}
            </div>
          </div>
        </header>
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          <AdminBreadcrumbs />
          {children}
        </div>
      </main>
      {constructoraCtx && (
        <ChatAsistente
          userName={constructoraCtx.perfilNombre || user.email || 'Usuario'}
          userRole={rol}
          permisosEmpresa={permisosEmpresa}
          proyectos={proyectosAsignados}
          constructoraNombre={constructoraCtx.constructoraNombre}
        />
      )}
    </div>
  )
}
