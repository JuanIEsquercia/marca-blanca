import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import NuevoProyectoModal from '@/components/admin/NuevoProyectoModal'
import ProyectoAcciones from '@/components/admin/ProyectoAcciones'
import type { Metadata } from 'next'
import type { TipoProyecto, EstadoObra } from '@/types/database'

export const metadata: Metadata = { title: 'Proyectos' }
export const dynamic = 'force-dynamic'

const ESTADO_LABEL: Record<EstadoObra, string> = {
  activa: 'Activo',
  pausada: 'Pausado',
  finalizada: 'Finalizado',
}

const ESTADO_COLOR: Record<EstadoObra, string> = {
  activa: 'bg-emerald-100 text-emerald-700',
  pausada: 'bg-amber-100 text-amber-700',
  finalizada: 'bg-slate-100 text-slate-500',
}

export default async function AdminHomePage() {
  const ctx = await getConstructoraContext()
  if (!ctx) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 max-w-md">
          <h2 className="text-lg font-semibold text-amber-900 mb-2">Sin acceso a constructora</h2>
          <p className="text-sm text-amber-700">
            Este usuario no está asociado a ninguna constructora. Contactá al administrador del sistema.
          </p>
        </div>
      </div>
    )
  }

  const supabase = await createClient()

  const [{ data: proyectos }, { data: cuentasEmpresa }] = await Promise.all([
    supabase
      .from('obras')
      .select('id, nombre, tipo, estado, created_at')
      .eq('constructora_id', ctx.constructoraId)
      .order('created_at', { ascending: false }),
    supabase
      .from('cuentas_propias')
      .select('id, nombre, tipo, moneda')
      .eq('constructora_id', ctx.constructoraId)
      .is('obra_id', null)
      .eq('activa', true)
      .order('nombre'),
  ])

  // Unidades por proyecto (solo desarrollos)
  const desarrolloIds = (proyectos ?? [])
    .filter(p => p.tipo === 'desarrollo')
    .map(p => p.id)

  const { data: unidadesData } = desarrolloIds.length > 0
    ? await supabase
        .from('unidades')
        .select('obra_id, estado_comercial')
        .in('obra_id', desarrolloIds)
    : { data: [] }

  // Agrupar por obra_id
  const unidadesPorObra = (unidadesData ?? []).reduce<Record<string, { total: number; vendidas: number; reservadas: number; disponibles: number }>>((acc, u) => {
    if (!acc[u.obra_id]) acc[u.obra_id] = { total: 0, vendidas: 0, reservadas: 0, disponibles: 0 }
    acc[u.obra_id].total++
    if (u.estado_comercial === 'Vendido') acc[u.obra_id].vendidas++
    else if (u.estado_comercial === 'Reservado') acc[u.obra_id].reservadas++
    else acc[u.obra_id].disponibles++
    return acc
  }, {})

  const lista = proyectos ?? []

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Proyectos</h1>
          <p className="text-slate-500 text-sm mt-1">{ctx.constructoraNombre}</p>
        </div>
        <NuevoProyectoModal
          constructoraId={ctx.constructoraId}
          cuentasExistentes={cuentasEmpresa ?? []}
        />
      </div>

      {lista.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <svg className="w-12 h-12 mx-auto mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16" />
          </svg>
          <p className="text-sm">No hay proyectos todavía.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {lista.map(p => {
            const tipo = p.tipo as TipoProyecto
            const estado = p.estado as EstadoObra
            const stats = tipo === 'desarrollo' ? (unidadesPorObra[p.id] ?? null) : null

            return (
              <Link
                key={p.id}
                href={`/admin/proyectos/${p.id}/dashboard`}
                className="group bg-white border border-slate-200 rounded-2xl p-5 hover:border-indigo-300 hover:shadow-md transition-all"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-slate-900 text-base truncate group-hover:text-indigo-700 transition-colors">
                      {p.nombre}
                    </h2>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={cn(
                        'text-[10px] font-semibold px-2 py-0.5 rounded',
                        tipo === 'desarrollo'
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-amber-100 text-amber-700'
                      )}>
                        {tipo === 'desarrollo' ? 'DESARROLLO' : 'OBRA'}
                      </span>
                      <span className={cn(
                        'text-[10px] font-medium px-2 py-0.5 rounded',
                        ESTADO_COLOR[estado]
                      )}>
                        {ESTADO_LABEL[estado]}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    <ProyectoAcciones obraId={p.id} nombre={p.nombre} estadoActual={estado} />
                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center group-hover:bg-indigo-50 transition-colors">
                      {tipo === 'desarrollo' ? (
                        <svg className="w-5 h-5 text-slate-400 group-hover:text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-slate-400 group-hover:text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      )}
                    </div>
                  </div>
                </div>

                {/* Métricas por tipo */}
                {tipo === 'desarrollo' && stats ? (
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                      <span>{stats.total} unidades</span>
                      <span>
                        {stats.total > 0 ? Math.round(((stats.vendidas + stats.reservadas) / stats.total) * 100) : 0}% comprometido
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden flex">
                      {stats.total > 0 && (
                        <>
                          <div className="bg-slate-400" style={{ width: `${(stats.vendidas / stats.total) * 100}%` }} />
                          <div className="bg-amber-400" style={{ width: `${(stats.reservadas / stats.total) * 100}%` }} />
                          <div className="bg-emerald-400" style={{ width: `${(stats.disponibles / stats.total) * 100}%` }} />
                        </>
                      )}
                    </div>
                    <div className="flex gap-3 mt-2">
                      {[
                        { color: 'bg-slate-400', label: `${stats.vendidas} vendidas` },
                        { color: 'bg-amber-400', label: `${stats.reservadas} reservadas` },
                        { color: 'bg-emerald-400', label: `${stats.disponibles} disponibles` },
                      ].map(l => (
                        <div key={l.label} className="flex items-center gap-1 text-[10px] text-slate-400">
                          <span className={cn('w-2 h-2 rounded-full', l.color)} />
                          {l.label}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : tipo === 'desarrollo' ? (
                  <p className="text-xs text-slate-400">Sin unidades cargadas</p>
                ) : (
                  <p className="text-xs text-slate-400">Obra de construcción</p>
                )}

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs text-slate-400">
                    {new Date(p.created_at).toLocaleDateString('es-AR', { month: 'short', year: 'numeric' })}
                  </span>
                  <span className="text-xs font-medium text-indigo-600 group-hover:text-indigo-700">
                    Entrar →
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
