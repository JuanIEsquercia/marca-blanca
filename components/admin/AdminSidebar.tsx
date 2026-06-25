'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { RolUsuario } from '@/types/database'

const NAV_SECTIONS = [
  {
    label: 'Proyecto',
    items: [
      {
        href: '/admin/dashboard',
        label: 'Dashboard',
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
        roles: ['admin', 'operador'],
      },
      {
        href: '/admin/inventario',
        label: 'Inventario',
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
        roles: ['admin', 'operador'],
      },
      {
        href: '/admin/tipologias',
        label: 'Tipologías',
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" /></svg>,
        roles: ['admin', 'operador'],
      },
      {
        href: '/admin/amenities',
        label: 'Amenities',
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>,
        roles: ['admin', 'operador'],
      },
    ],
  },
  {
    label: 'Comercial',
    items: [
      {
        href: '/admin/contratos',
        label: 'Contratos',
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
        roles: ['admin', 'operador'],
      },
      {
        href: '/admin/reservas',
        label: 'Reservas',
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
        roles: ['admin', 'operador'],
      },
      {
        href: '/admin/compradores',
        label: 'Compradores',
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" /></svg>,
        roles: ['admin', 'operador'],
      },
      {
        href: '/admin/cuenta-corriente',
        label: 'Cuenta Corriente',
        badge: 'vencidas',
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" /></svg>,
        roles: ['admin', 'operador'],
      },
      {
        href: '/admin/leads',
        label: 'Leads / CRM',
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>,
        roles: ['admin', 'operador'],
      },
    ],
  },
  {
    label: 'Operaciones',
    items: [
      {
        href: '/admin/gastos',
        label: 'Gastos',
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
        roles: ['admin', 'operador'],
      },
      {
        href: '/admin/proveedores',
        label: 'Proveedores',
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" /></svg>,
        roles: ['admin', 'operador'],
      },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      {
        href: '/admin/tesoreria',
        label: 'Tesorería',
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>,
        roles: ['admin', 'operador'],
      },
      {
        href: '/admin/cuentas',
        label: 'Cuentas',
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>,
        roles: ['admin', 'operador'],
      },
    ],
  },
  {
    label: 'Configuración',
    items: [
      {
        href: '/admin/usuarios',
        label: 'Usuarios',
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
        roles: ['admin'],
      },
    ],
  },
]

interface Props {
  userName: string
  userRole: RolUsuario
  cuotasVencidasCount: number
}

export default function AdminSidebar({ userName, userRole, cuotasVencidasCount }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <aside className="w-60 bg-slate-900 flex flex-col shrink-0">
      {/* Logo */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h18M3 10h18M3 7l9-4 9 4" />
            </svg>
          </div>
          <div>
            <p className="text-white text-sm font-semibold leading-none">Panel ERP</p>
            <p className="text-slate-500 text-xs mt-0.5">Inmobiliario</p>
          </div>
        </div>
      </div>

      {/* Navegación por secciones */}
      <nav className="flex-1 p-3 space-y-4 overflow-y-auto admin-scroll">
        {NAV_SECTIONS.map(section => {
          const visibleItems = section.items.filter(item => item.roles.includes(userRole))
          if (visibleItems.length === 0) return null
          return (
            <div key={section.label}>
              <p className="px-3 mb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {visibleItems.map(item => {
                  const isActive = pathname.startsWith(item.href)
                  const showBadge = item.badge === 'vencidas' && cuotasVencidasCount > 0
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                        isActive
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                      )}
                    >
                      {item.icon}
                      <span className="flex-1">{item.label}</span>
                      {showBadge && (
                        <span className={cn(
                          'text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center',
                          isActive ? 'bg-white/20 text-white' : 'bg-red-500 text-white'
                        )}>
                          {cuotasVencidasCount > 99 ? '99+' : cuotasVencidasCount}
                        </span>
                      )}
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
  )
}
