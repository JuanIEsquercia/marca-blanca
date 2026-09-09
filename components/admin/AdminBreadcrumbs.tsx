'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSyncExternalStore } from 'react'
import { getCurrentProyecto, subscribeProyecto } from '@/lib/proyecto-store'

const MODULO_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  tipologias: 'Tipologías',
  amenities: 'Amenities',
  unidades: 'Unidades',
  asignado: 'Personal y equipos',
  reservas: 'Reservas',
  contratos: 'Ventas',
  cuentas: 'Cuentas',
  gastos: 'Gastos',
  caja: 'Caja',
  certificados: 'Contratos de Obra',
  cobros: 'Cobros',
  control: 'Control de obra',
  presupuestos: 'Presupuestos',
  proveedores: 'Proveedores',
  clientes: 'Clientes',
  inventario: 'Inventario',
  personal: 'Personal',
  ingresos: 'Ingresos',
  compras: 'Compras',
  tesoreria: 'Caja',
  usuarios: 'Usuarios',
}

export default function AdminBreadcrumbs() {
  const pathname = usePathname()
  const storeProyecto = useSyncExternalStore(subscribeProyecto, getCurrentProyecto, () => null)

  const segmentos = pathname.split('/').filter(Boolean)
  if (segmentos.length === 0) return null

  // segmentos: ['admin'] o ['admin', 'presupuestos'] o ['admin', 'proyectos', 'obraId', 'dashboard']
  const esProyectos = segmentos[1] === 'proyectos'
  const obraId = esProyectos ? segmentos[2] : null
  const moduloKey = esProyectos ? segmentos[3] : segmentos[1]

  const proyectoNombre = (storeProyecto && storeProyecto.id === obraId) ? storeProyecto.nombre : null

  return (
    <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <Link
        href="/admin"
        className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex items-center gap-1 font-medium"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
        <span>Empresa</span>
      </Link>

      {segmentos.length > 1 && (
        <>
          <span className="text-slate-300 dark:text-slate-600">/</span>
          {esProyectos ? (
            <>
              <Link
                href="/admin"
                className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium"
              >
                Proyectos
              </Link>
              {obraId && (
                <>
                  <span className="text-slate-300 dark:text-slate-600">/</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {proyectoNombre || 'Proyecto'}
                  </span>
                </>
              )}
              {moduloKey && MODULO_LABELS[moduloKey] && (
                <>
                  <span className="text-slate-300 dark:text-slate-600">/</span>
                  <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                    {MODULO_LABELS[moduloKey]}
                  </span>
                </>
              )}
            </>
          ) : (
            moduloKey && MODULO_LABELS[moduloKey] && (
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                {MODULO_LABELS[moduloKey]}
              </span>
            )
          )}
        </>
      )}
    </nav>
  )
}
