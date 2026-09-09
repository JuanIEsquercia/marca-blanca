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

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>
}) {
  const { motivo } = await searchParams
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

  // Unidades por proyecto (solo desarrollos) — agregado en Postgres
  // (resumen_unidades_por_obra, migration_030) en vez de traer cada fila de
  // `unidades` y contar en JS, para no quedar sujeto al límite default de
  // PostgREST (~1000 filas) si la constructora acumula muchas unidades.
  const desarrolloIds = (proyectos ?? [])
    .filter(p => p.tipo === 'desarrollo')
    .map(p => p.id)

  interface ResumenUnidadesObra { obra_id: string; total: number; vendidas: number; reservadas: number; disponibles: number }

  const { data: resumenUnidadesRaw } = desarrolloIds.length > 0
    ? await supabase.rpc('resumen_unidades_por_obra', { p_obra_ids: desarrolloIds })
    : { data: [] as ResumenUnidadesObra[] }
  const resumenUnidades = (resumenUnidadesRaw ?? []) as ResumenUnidadesObra[]

  const unidadesPorObra = resumenUnidades.reduce<Record<string, { total: number; vendidas: number; reservadas: number; disponibles: number }>>((acc, r) => {
    acc[r.obra_id] = { total: r.total, vendidas: r.vendidas, reservadas: r.reservadas, disponibles: r.disponibles }
    return acc
  }, {})

  const lista = proyectos ?? []

  return (
    <div>
      {motivo === 'sin-acceso' && (
        <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-amber-800">
            No tenés acceso a esa sección. Si creés que deberías tenerlo, pedile a un administrador que revise tus permisos en <strong>Usuarios</strong>.
          </p>
        </div>
      )}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Proyectos</h1>
          <p className="text-slate-500 text-sm mt-1">{ctx.constructoraNombre}</p>
        </div>
        {ctx.perfilRol === 'admin' && (
          <NuevoProyectoModal
            constructoraId={ctx.constructoraId}
            cuentasExistentes={cuentasEmpresa ?? []}
          />
        )}
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
                className="group relative bg-white border border-slate-200/80 rounded-2xl p-5 hover:border-indigo-300/60 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-indigo-500/5 transition-all duration-200 ease-out flex flex-col justify-between"
              >
                <div>
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1 min-w-0">
                      <h2 className="font-bold text-slate-900 text-base truncate group-hover:text-indigo-600 transition-colors">
                        {p.nombre}
                      </h2>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={cn(
                          'text-[10px] font-semibold tracking-wider px-2 py-0.5 rounded-full uppercase border',
                          tipo === 'desarrollo'
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200/60'
                            : 'bg-amber-50 text-amber-700 border-amber-200/60'
                        )}>
                          {tipo === 'desarrollo' ? 'DESARROLLO' : 'OBRA'}
                        </span>
                        <span className={cn(
                          'inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full border',
                          ESTADO_COLOR[estado]
                        )}>
                          {estado === 'activa' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                          {ESTADO_LABEL[estado]}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-3">
                      <ProyectoAcciones obraId={p.id} nombre={p.nombre} tipo={tipo} estadoActual={estado} esAdmin={ctx.perfilRol === 'admin'} />
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/80 border border-slate-200/60 flex items-center justify-center group-hover:from-indigo-50 group-hover:to-indigo-100/50 group-hover:border-indigo-200/60 group-hover:scale-105 transition-all duration-200">
                        {tipo === 'desarrollo' ? (
                          <svg className="w-5 h-5 text-slate-400 group-hover:text-indigo-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-slate-400 group-hover:text-amber-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Métricas por tipo */}
                  {tipo === 'desarrollo' && stats ? (
                    <div className="bg-slate-50/60 border border-slate-100 rounded-xl p-3">
                      <div className="flex justify-between text-xs text-slate-600 mb-2">
                        <span className="font-semibold">{stats.total} unidades total</span>
                        <span className="font-semibold text-slate-700">
                          {stats.total > 0 ? Math.round(((stats.vendidas + stats.reservadas) / stats.total) * 100) : 0}% comprometido
                        </span>
                      </div>
                      <div className="h-2 bg-slate-200/80 rounded-full overflow-hidden flex p-0.5 gap-0.5 ring-1 ring-slate-200/40">
                        {stats.total > 0 && (
                          <>
                            <div className="bg-slate-600 rounded-full transition-all duration-300" style={{ width: `${(stats.vendidas / stats.total) * 100}%` }} title="Vendidas" />
                            <div className="bg-amber-400 rounded-full transition-all duration-300" style={{ width: `${(stats.reservadas / stats.total) * 100}%` }} title="Reservadas" />
                            <div className="bg-emerald-400 rounded-full transition-all duration-300" style={{ width: `${(stats.disponibles / stats.total) * 100}%` }} title="Disponibles" />
                          </>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-2 pt-1 border-t border-slate-200/40">
                        {[
                          { color: 'bg-slate-600', label: `${stats.vendidas} vend.` },
                          { color: 'bg-amber-400', label: `${stats.reservadas} res.` },
                          { color: 'bg-emerald-400', label: `${stats.disponibles} disp.` },
                        ].map(l => (
                          <div key={l.label} className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                            <span className={cn('w-2 h-2 rounded-full shrink-0', l.color)} />
                            {l.label}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : tipo === 'desarrollo' ? (
                    <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-3 text-xs text-slate-400 italic">
                      Sin unidades cargadas
                    </div>
                  ) : (
                    <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-3 flex items-center gap-2 text-xs text-slate-500">
                      <span className="w-2 h-2 rounded-full bg-amber-400" />
                      Obra de construcción en desarrollo
                    </div>
                  )}
                </div>

                <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">
                    Creado {new Date(p.created_at).toLocaleDateString('es-AR', { month: 'short', year: 'numeric' })}
                  </span>
                  <span className="text-xs font-semibold text-indigo-600 group-hover:text-indigo-700 flex items-center gap-1">
                    Entrar <span className="group-hover:translate-x-1 transition-transform inline-block">→</span>
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
