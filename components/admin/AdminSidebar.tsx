'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { RolUsuario } from '@/types/database'
import { puedeAcceder, type ModuloKey, type ProyectoAsignado } from '@/lib/permisos'
import { getCurrentProyecto, subscribeProyecto, type ProyectoData } from '@/lib/proyecto-store'

// Cache de módulo: evita el API call cuando se regresa a un proyecto ya visitado
const proyectoApiCache = new Map<string, ProyectoData>()

interface NavItem {
  href: string
  label: string
  permiso: ModuloKey | null
  roles: string[]
  icon: React.ReactNode
}

interface NavSection {
  label: string
  items: NavItem[]
}

function buildConstructoraNav(): NavSection[] {
  return [
    {
      label: 'General',
      items: [
        {
          href: '/admin',
          label: 'Proyectos',
          permiso: null,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>,
        },
      ],
    },
    {
      label: 'Empresa',
      items: [
        {
          href: '/admin/presupuestos',
          label: 'Presupuestos',
          permiso: 'presupuestos' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
        },
        {
          href: '/admin/proveedores',
          label: 'Proveedores',
          permiso: 'proveedores' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" /></svg>,
        },
        {
          href: '/admin/inventario',
          label: 'Inventario',
          permiso: 'inventario' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7L12 3 4 7m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>,
        },
        {
          href: '/admin/personal',
          label: 'Personal',
          permiso: 'personal' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-4-4" /></svg>,
        },
        {
          href: '/admin/cuentas',
          label: 'Cuentas',
          permiso: 'cuentas' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>,
        },
        {
          href: '/admin/ingresos',
          label: 'Ingresos',
          permiso: 'ingresos' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
        },
        {
          href: '/admin/gastos',
          label: 'Gastos',
          permiso: 'gastos' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
        },
        {
          href: '/admin/tesoreria',
          label: 'Caja',
          permiso: 'tesoreria' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>,
        },
      ],
    },
    {
      label: 'Configuración',
      items: [
        {
          href: '/admin/usuarios',
          label: 'Usuarios',
          permiso: null,
          roles: ['admin'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
        },
        // WhatsApp oculto del sidebar a propósito: se retoma más adelante,
        // una vez que el resto de los módulos esté pulido. La ruta
        // /admin/whatsapp sigue funcionando, solo no se linkea acá.
      ],
    },
  ]
}

function buildDesarrolloNav(obraId: string, modoCuentas: 'empresa' | 'especificas'): NavSection[] {
  const base = `/admin/proyectos/${obraId}`
  return [
    {
      label: 'Proyecto',
      items: [
        {
          href: `${base}/dashboard`,
          label: 'Dashboard',
          permiso: null,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
        },
        {
          href: `${base}/tipologias`,
          label: 'Tipologías',
          permiso: 'tipologias' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" /></svg>,
        },
        {
          href: `${base}/amenities`,
          label: 'Amenities',
          permiso: 'amenities' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>,
        },
        {
          href: `${base}/unidades`,
          label: 'Unidades',
          permiso: 'unidades' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
        },
      ],
    },
    {
      label: 'Comercial',
      items: [
        {
          href: `${base}/reservas`,
          label: 'Reservas',
          permiso: 'reservas' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
        },
        {
          href: `${base}/contratos`,
          label: 'Ventas',
          permiso: 'contratos' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
        },
      ],
    },
    {
      label: 'Finanzas',
      items: [
        ...(modoCuentas === 'especificas' ? [{
          href: `${base}/cuentas`,
          label: 'Cuentas',
          permiso: 'cuentas' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>,
        }] : []),
        {
          href: `${base}/gastos`,
          label: 'Gastos',
          permiso: 'gastos' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
        },
        {
          href: `${base}/caja`,
          label: 'Caja',
          permiso: 'tesoreria' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>,
        },
      ],
    },
  ]
}

function buildObraNav(obraId: string, modoCuentas: 'empresa' | 'especificas'): NavSection[] {
  const base = `/admin/proyectos/${obraId}`
  return [
    {
      label: 'Proyecto',
      items: [
        {
          href: `${base}/dashboard`,
          label: 'Dashboard',
          permiso: null,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
        },
        {
          href: `${base}/certificados`,
          label: 'Contratos',
          permiso: 'certificados' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>,
        },
        {
          href: `${base}/cobros`,
          label: 'Cobros',
          permiso: 'cobros' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
        },
      ],
    },
    {
      label: 'Finanzas',
      items: [
        ...(modoCuentas === 'especificas' ? [{
          href: `${base}/cuentas`,
          label: 'Cuentas',
          permiso: 'cuentas' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>,
        }] : []),
        {
          href: `${base}/gastos`,
          label: 'Gastos',
          permiso: 'gastos' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
        },
        {
          href: `${base}/caja`,
          label: 'Caja',
          permiso: 'tesoreria' as ModuloKey,
          roles: ['admin', 'operador'],
          icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>,
        },
      ],
    },
  ]
}

interface Props {
  userName: string
  userRole: RolUsuario
  permisosEmpresa: string[]
  proyectos: ProyectoAsignado[]
  constructoraNombre: string
}

export default function AdminSidebar({ userName, userRole, permisosEmpresa, proyectos, constructoraNombre }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  // Extraer obraId del URL en el cliente
  const obraMatch = pathname.match(/^\/admin\/proyectos\/([^/]+)/)
  const obraId = obraMatch?.[1] ?? null

  // Leer del store (sincronizado desde el layout de servidor vía ProyectoStoreSync)
  const storeProyecto = useSyncExternalStore(subscribeProyecto, getCurrentProyecto, () => null)

  const [proyecto, setProyecto] = useState<ProyectoData | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!obraId) {
      setProyecto(null)
      return
    }

    // 1. Prioridad: store (llenado por ProyectoStoreSync desde el layout RSC)
    if (storeProyecto && storeProyecto.id === obraId) {
      setProyecto(storeProyecto)
      proyectoApiCache.set(obraId, storeProyecto)
      return
    }

    // 2. Cache de módulo: regreso a proyecto ya visitado
    const cached = proyectoApiCache.get(obraId)
    if (cached) {
      setProyecto(cached)
      return
    }

    // 3. Fallback: API call (solo en primera visita sin store disponible aún)
    let cancelled = false
    fetch(`/api/admin/proyecto/${obraId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return
        if (data) proyectoApiCache.set(obraId, data)
        setProyecto(data ?? null)
      })
      .catch(() => { if (!cancelled) setProyecto(null) })
    return () => { cancelled = true }
  }, [obraId, storeProyecto])

  // Usar el store sincrónicamente en el render — si ya tiene el proyecto correcto,
  // la nav se muestra en el mismo ciclo sin esperar el efecto
  const effectiveProyecto = (storeProyecto?.id === obraId && storeProyecto) || proyecto

  const sections = effectiveProyecto
    ? (effectiveProyecto.tipo === 'desarrollo'
        ? buildDesarrolloNav(effectiveProyecto.id, effectiveProyecto.modo_cuentas ?? 'empresa')
        : buildObraNav(effectiveProyecto.id, effectiveProyecto.modo_cuentas ?? 'empresa'))
    : buildConstructoraNav()

  function puedeVer(item: NavItem): boolean {
    if (!item.roles.includes(userRole)) return false
    if (userRole === 'admin') return true
    if (item.permiso === null) return true
    return puedeAcceder(userRole, permisosEmpresa, proyectos, item.permiso, obraId)
  }

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <>
      {/* Header móvil */}
      <header className="lg:hidden flex items-center justify-between p-4 bg-slate-900 border-b border-slate-800 text-white shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h18M3 10h18M3 7l9-4 9 4" />
            </svg>
          </div>
          <span className="text-sm font-semibold truncate max-w-[200px]">
            {effectiveProyecto ? effectiveProyecto.nombre : constructoraNombre}
          </span>
        </div>
        <button
          onClick={() => setIsOpen(true)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 focus:outline-none"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>

      {/* Backdrop móvil */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity"
        />
      )}

      {/* Menú lateral (Aside) */}
      <aside
        className={cn(
          "bg-slate-900 flex flex-col transition-transform duration-300 ease-in-out",
          "fixed inset-y-0 left-0 z-50 w-64 shadow-2xl lg:shadow-none",
          "lg:translate-x-0 lg:static lg:w-60 lg:flex lg:shrink-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          {effectiveProyecto ? (
            <div className="flex-1 min-w-0">
              <Link
                href="/admin"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-xs mb-2 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Todos los proyectos
              </Link>
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h18M3 10h18M3 7l9-4 9 4" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-semibold leading-tight truncate">{effectiveProyecto.nombre}</p>
                  <span className={cn(
                    'inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mt-1',
                    effectiveProyecto.tipo === 'desarrollo'
                      ? 'bg-indigo-900 text-indigo-300'
                      : 'bg-amber-900 text-amber-300'
                  )}>
                    {effectiveProyecto.tipo === 'desarrollo' ? 'DESARROLLO' : 'OBRA'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h18M3 10h18M3 7l9-4 9 4" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-white text-sm font-semibold leading-none truncate">{constructoraNombre}</p>
                <p className="text-slate-400 text-xs mt-0.5">Panel ERP</p>
              </div>
            </div>
          )}

          {/* Botón cerrar móvil */}
          <button
            onClick={() => setIsOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-850 ml-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navegación */}
        <nav className="flex-1 p-3 space-y-4 overflow-y-auto admin-scroll">
          {sections.map(section => {
            const visibleItems = section.items.filter(puedeVer)
            if (visibleItems.length === 0) return null
            return (
              <div key={section.label}>
                <p className="px-3 mb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  {section.label}
                </p>
                <div className="space-y-0.5">
                  {visibleItems.map(item => {
                    const isActive = item.href === '/admin'
                      ? pathname === '/admin'
                      : pathname.startsWith(item.href)
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setIsOpen(false)}
                        className={cn(
                          'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                          isActive
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                        )}
                      >
                        {item.icon}
                        <span className="flex-1">{item.label}</span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>

        {/* Usuario + Logout */}
        <div className="p-3 border-t border-slate-800">
          <div className="px-3 py-2 mb-1">
            <p className="text-white text-sm font-medium truncate">{userName}</p>
            <p className="text-slate-500 text-xs capitalize">{userRole}</p>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 text-slate-400 hover:text-white
                       hover:bg-slate-800 rounded-lg text-sm transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Cerrar sesión
          </button>
        </div>
      </aside>
    </>
  )

}
