import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProyectoContext } from '@/lib/tenant'
import { cn, formatDate } from '@/lib/utils'
import type { EstadoEquipo, EstadoPersonal, TipoContratacion } from '@/types/database'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Personal y equipos' }
export const dynamic = 'force-dynamic'

// Página de solo lectura — a propósito no exige el módulo 'inventario'/
// 'personal' (que en este ERP son de toda la empresa, ver lib/permisos.ts).
// Cualquiera asignado a este proyecto necesita poder ver qué tiene el
// proyecto sin que el admin tenga que darle un módulo de escritura de toda
// la constructora solo para eso. Por eso usa el admin client (bypassea el
// RLS que sí exige ese permiso) — el gate real es getProyectoContext() de
// abajo, el mismo que usan el resto de las páginas de proyecto.
const ESTADO_EQUIPO_LABEL: Record<EstadoEquipo, { label: string; color: string }> = {
  disponible:    { label: 'Disponible',    color: 'bg-emerald-100 text-emerald-700' },
  asignado:      { label: 'Asignado',      color: 'bg-indigo-100 text-indigo-700' },
  mantenimiento: { label: 'Mantenimiento', color: 'bg-amber-100 text-amber-700' },
  baja:          { label: 'Baja',          color: 'bg-slate-100 text-slate-500' },
}

const ESTADO_PERSONAL_LABEL: Record<EstadoPersonal, { label: string; color: string }> = {
  disponible: { label: 'Disponible', color: 'bg-emerald-100 text-emerald-700' },
  asignado:   { label: 'Asignado',   color: 'bg-indigo-100 text-indigo-700' },
  licencia:   { label: 'Licencia',   color: 'bg-amber-100 text-amber-700' },
  baja:       { label: 'Baja',       color: 'bg-slate-100 text-slate-500' },
}

const TIPO_CONTRATACION_LABEL: Record<TipoContratacion, string> = {
  relacion_dependencia: 'Relación de dependencia',
  contratado: 'Contratado',
  subcontratista: 'Subcontratista',
}

// El tipado de postgrest-js infiere la relación embebida como array (no hay
// Database schema tipado en este cliente), pero al ser un FK many-to-one
// (cada asignación referencia UN equipo/persona) PostgREST la devuelve como
// objeto plano en runtime — indexar con [0] sobre eso da undefined y
// filtraba todo. Esto soporta ambas formas por las dudas.
function unwrap<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

export default async function AsignadoPage({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params
  const ctx = await getProyectoContext(obraId)
  if (!ctx) redirect('/admin')

  const admin = createAdminClient()

  const [{ data: equiposAsignados }, { data: personalAsignado }] = await Promise.all([
    admin
      .from('equipo_asignaciones')
      .select('fecha_desde, equipos(nombre, tipo, marca, modelo, estado)')
      .eq('obra_id', obraId)
      .is('fecha_hasta', null)
      .order('fecha_desde', { ascending: false }),
    admin
      .from('personal_asignaciones')
      .select('fecha_desde, personal(nombre, tipo_contratacion, categoria, estado)')
      .eq('obra_id', obraId)
      .is('fecha_hasta', null)
      .order('fecha_desde', { ascending: false }),
  ])

  const equipos = (equiposAsignados ?? [])
    .map(e => ({ fecha_desde: e.fecha_desde, equipo: unwrap(e.equipos) }))
    .filter((e): e is { fecha_desde: string; equipo: NonNullable<typeof e.equipo> } => e.equipo !== null)
  const personal = (personalAsignado ?? [])
    .map(p => ({ fecha_desde: p.fecha_desde, persona: unwrap(p.personal) }))
    .filter((p): p is { fecha_desde: string; persona: NonNullable<typeof p.persona> } => p.persona !== null)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Personal y equipos</h1>
        <p className="text-slate-500 text-sm mt-1">
          Quién y qué está asignado a {ctx.obraNombre} en este momento — solo lectura, la asignación la maneja un administrador desde Personal/Inventario.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Personal */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm">Personal</h2>
            <p className="text-xs text-slate-400 mt-0.5">{personal.length} persona{personal.length !== 1 ? 's' : ''} asignada{personal.length !== 1 ? 's' : ''}</p>
          </div>
          {personal.length === 0 ? (
            <div className="px-5 py-10 text-center text-slate-400 text-sm">Sin personal asignado a este proyecto.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {personal.map((p, i) => {
                const per = p.persona
                const estadoInfo = ESTADO_PERSONAL_LABEL[per.estado as EstadoPersonal]
                return (
                  <div key={i} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{per.nombre}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {[TIPO_CONTRATACION_LABEL[per.tipo_contratacion as TipoContratacion], per.categoria].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={cn('inline-block text-[10px] font-medium px-2 py-0.5 rounded-full', estadoInfo.color)}>
                        {estadoInfo.label}
                      </span>
                      <p className="text-xs text-slate-400 mt-1">Desde {formatDate(p.fecha_desde)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Equipos */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm">Equipos y maquinaria</h2>
            <p className="text-xs text-slate-400 mt-0.5">{equipos.length} equipo{equipos.length !== 1 ? 's' : ''} asignado{equipos.length !== 1 ? 's' : ''}</p>
          </div>
          {equipos.length === 0 ? (
            <div className="px-5 py-10 text-center text-slate-400 text-sm">Sin equipos asignados a este proyecto.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {equipos.map((e, i) => {
                const eq = e.equipo
                const estadoInfo = ESTADO_EQUIPO_LABEL[eq.estado as EstadoEquipo]
                return (
                  <div key={i} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{eq.nombre}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {[eq.tipo, eq.marca, eq.modelo].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={cn('inline-block text-[10px] font-medium px-2 py-0.5 rounded-full', estadoInfo.color)}>
                        {estadoInfo.label}
                      </span>
                      <p className="text-xs text-slate-400 mt-1">Desde {formatDate(e.fecha_desde)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
