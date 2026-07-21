'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Perfil } from '@/types/database'
import { MODULOS, MODULOS_EMPRESA, MAX_OPERADORES, modulosDisponibles, type TipoProyecto, type ProyectoAsignado } from '@/lib/permisos'
import ConfirmModal from './ConfirmModal'

type PerfilConEmail = Perfil & { email: string; proyectos: ProyectoAsignado[] }
type ObraOption = { id: string; nombre: string; tipo: TipoProyecto }

type ConfirmState = { title: string; message: string; confirmLabel?: string; onConfirm: () => Promise<void> }

interface Props {
  perfiles: PerfilConEmail[]
  obras: ObraOption[]
  currentUserId: string
  constructoraId: string
}

const MODULOS_EMPRESA_INFO = MODULOS.filter(m => MODULOS_EMPRESA.includes(m.key))

function PermisosCheckboxes({
  value,
  onChange,
  modulos,
}: {
  value: string[]
  onChange: (v: string[]) => void
  modulos: readonly (typeof MODULOS)[number][]
}) {
  const secciones = [...new Set(modulos.map(m => m.seccion))]

  function toggle(key: string) {
    onChange(value.includes(key) ? value.filter(k => k !== key) : [...value, key])
  }
  function toggleSeccion(seccion: string) {
    const keys = modulos.filter(m => m.seccion === seccion).map(m => m.key)
    const allChecked = keys.every(k => value.includes(k))
    if (allChecked) {
      onChange(value.filter(k => !keys.includes(k as never)))
    } else {
      onChange([...new Set([...value, ...keys])])
    }
  }

  return (
    <div className="space-y-3">
      {secciones.map(sec => {
        const mods = modulos.filter(m => m.seccion === sec)
        const allChecked = mods.every(m => value.includes(m.key))
        const someChecked = mods.some(m => value.includes(m.key))
        return (
          <div key={sec}>
            <button
              type="button"
              onClick={() => toggleSeccion(sec)}
              className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 hover:text-slate-700"
            >
              <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors
                ${allChecked ? 'bg-indigo-600 border-indigo-600' : someChecked ? 'bg-indigo-200 border-indigo-400' : 'border-slate-300'}`}>
                {(allChecked || someChecked) && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d={allChecked ? 'M5 13l4 4L19 7' : 'M5 12h14'} />
                  </svg>
                )}
              </span>
              {sec}
            </button>
            <div className="ml-2 space-y-1">
              {mods.map(m => (
                <label key={m.key} className="flex items-center gap-2 cursor-pointer group">
                  <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors
                    ${value.includes(m.key) ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 group-hover:border-indigo-400'}`}
                    onClick={() => toggle(m.key)}>
                    {value.includes(m.key) && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  <span className="text-sm text-slate-700 select-none" onClick={() => toggle(m.key)}>
                    {m.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Árbol proyecto → módulos: tildar un proyecto revela su propio checklist,
// scopeado al tipo de ESE proyecto (mismo PermisosCheckboxes de arriba,
// uno por proyecto tildado en vez de uno global).
function ArbolProyectos({
  obras,
  value,
  onChange,
}: {
  obras: ObraOption[]
  value: ProyectoAsignado[]
  onChange: (v: ProyectoAsignado[]) => void
}) {
  function toggleProyecto(obraId: string) {
    if (value.some(p => p.obraId === obraId)) {
      onChange(value.filter(p => p.obraId !== obraId))
    } else {
      onChange([...value, { obraId, permisos: [] }])
    }
  }
  function setPermisosProyecto(obraId: string, permisos: string[]) {
    onChange(value.map(p => (p.obraId === obraId ? { ...p, permisos } : p)))
  }

  if (obras.length === 0) {
    return <p className="text-xs text-slate-400 italic">No hay proyectos creados todavía.</p>
  }

  return (
    <div className="space-y-2">
      {obras.map(o => {
        const asignado = value.find(p => p.obraId === o.id)
        return (
          <div key={o.id} className={`border rounded-lg transition-colors ${asignado ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200'}`}>
            <label className="flex items-center gap-2 p-2.5 cursor-pointer">
              <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors
                ${asignado ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}
                onClick={() => toggleProyecto(o.id)}>
                {asignado && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              <span className="text-sm font-medium text-slate-800 select-none" onClick={() => toggleProyecto(o.id)}>
                {o.nombre}
              </span>
              <span className="text-xs text-slate-400">({o.tipo === 'obra' ? 'Obra' : 'Desarrollo'})</span>
            </label>
            {asignado && (
              <div className="px-3 pb-3 pt-1 border-t border-slate-100">
                <PermisosCheckboxes
                  value={asignado.permisos}
                  onChange={p => setPermisosProyecto(o.id, p)}
                  modulos={modulosDisponibles(o.tipo)}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function UsuariosManager({ perfiles, obras, currentUserId, constructoraId: _constructoraId }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [confirmModal, setConfirmModal] = useState<ConfirmState | null>(null)

  // Creación
  const [showForm, setShowForm] = useState(false)
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [proyectos, setProyectos] = useState<ProyectoAsignado[]>([])
  const [permisosEmpresa, setPermisosEmpresa] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Edición de permisos
  const [editPermisosPerfil, setEditPermisosPerfil] = useState<PerfilConEmail | null>(null)
  const [editProyectos, setEditProyectos] = useState<ProyectoAsignado[]>([])
  const [editPermisosEmpresa, setEditPermisosEmpresa] = useState<string[]>([])
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const operadores = perfiles.filter(p => p.rol !== 'admin')
  const cupoLleno = operadores.length >= MAX_OPERADORES

  const nombreDeObra = (id: string) => obras.find(o => o.id === id)?.nombre ?? 'Proyecto eliminado'
  const moduloLabel = (key: string) => MODULOS.find(m => m.key === key)?.label ?? key

  function refresh() { startTransition(() => router.refresh()) }

  function openCreate() {
    setNombre(''); setEmail(''); setPassword('')
    setProyectos([]); setPermisosEmpresa([]); setError(null); setSuccess(false)
    setShowForm(true)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const res = await fetch('/api/admin/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, email, password, rol: 'operador', proyectos, permisosEmpresa }),
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok) { setError(data.error); return }

    setSuccess(true)
    setTimeout(() => { setSuccess(false); setShowForm(false) }, 1800)
    refresh()
  }

  function openEditPermisos(p: PerfilConEmail) {
    setEditPermisosPerfil(p)
    setEditProyectos(p.proyectos)
    setEditPermisosEmpresa(p.permisos ?? [])
    setEditError(null)
  }

  async function handleSavePermisos() {
    if (!editPermisosPerfil) return
    setEditLoading(true)
    setEditError(null)

    const res = await fetch('/api/admin/usuarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: editPermisosPerfil.id, proyectos: editProyectos, permisosEmpresa: editPermisosEmpresa }),
    })

    const data = await res.json()
    setEditLoading(false)

    if (!res.ok) { setEditError(data.error); return }

    setEditPermisosPerfil(null)
    refresh()
  }

  function handleDelete(userId: string, nombre: string) {
    setConfirmModal({
      title: 'Eliminar usuario',
      message: `¿Eliminar a "${nombre}"? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar usuario',
      onConfirm: async () => {
        await fetch('/api/admin/usuarios', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        })
        setConfirmModal(null)
        refresh()
      },
    })
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <p className="text-slate-500 text-sm">
            Operadores: <span className={`font-semibold ${cupoLleno ? 'text-red-600' : 'text-slate-700'}`}>
              {operadores.length} / {MAX_OPERADORES}
            </span>
          </p>
        </div>
        <button
          onClick={openCreate}
          disabled={cupoLleno}
          title={cupoLleno ? `Límite de ${MAX_OPERADORES} operadores alcanzado` : undefined}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500
                     disabled:opacity-40 disabled:cursor-not-allowed
                     text-white rounded-lg text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuevo operador
        </button>
      </div>

      {cupoLleno && (
        <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
          Cupo máximo de {MAX_OPERADORES} operadores alcanzado. Eliminá uno para crear otro.
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Nombre</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Rol</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Acceso a proyectos y módulos</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {perfiles.map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900 align-top">
                    {p.nombre}
                    {p.id === currentUserId && (
                      <span className="ml-2 text-xs text-indigo-600 font-normal">(vos)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 align-top">{p.email}</td>
                  <td className="px-4 py-3 align-top">
                    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border
                      ${p.rol === 'admin'
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                      {p.rol === 'admin' ? 'Administrador' : 'Operador'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {p.rol === 'admin' ? (
                      <span className="text-xs text-slate-400 italic">Acceso total</span>
                    ) : p.proyectos.length === 0 && (p.permisos ?? []).length === 0 ? (
                      <span className="text-xs text-red-500">Sin acceso</span>
                    ) : (
                      <div className="space-y-1.5">
                        {p.proyectos.map(proy => (
                          <div key={proy.obraId} className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-slate-800 text-white rounded-md">
                              {nombreDeObra(proy.obraId)}
                            </span>
                            {proy.permisos.length === 0 ? (
                              <span className="text-[10px] text-slate-400 italic">sin módulos</span>
                            ) : proy.permisos.map(key => (
                              <span key={key} className="text-[10px] font-medium px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded-md border border-indigo-100">
                                {moduloLabel(key)}
                              </span>
                            ))}
                          </div>
                        ))}
                        {(p.permisos ?? []).length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-slate-500 text-white rounded-md">
                              Empresa
                            </span>
                            {(p.permisos ?? []).map(key => (
                              <span key={key} className="text-[10px] font-medium px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-md border border-emerald-100">
                                {moduloLabel(key)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    <div className="flex items-center justify-end gap-3">
                      {p.rol !== 'admin' && (
                        <button
                          onClick={() => openEditPermisos(p)}
                          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
                        >
                          Editar permisos
                        </button>
                      )}
                      {p.id !== currentUserId && (
                        <button
                          onClick={() => handleDelete(p.id, p.nombre)}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal crear operador */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="font-bold text-slate-900">Nuevo operador</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <form id="create-form" onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nombre *</label>
                    <input required value={nombre} onChange={e => setNombre(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                                 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
                    <input required type="email" value={email} onChange={e => setEmail(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                                 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Contraseña *</label>
                    <input required type="password" minLength={8} value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Mínimo 8 caracteres"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                                 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold text-slate-700 mb-1">Proyectos y módulos</p>
                  <p className="text-xs text-slate-400 mb-3">
                    Tildá los proyectos a los que va a acceder — cada uno con sus propios módulos.
                  </p>
                  <ArbolProyectos obras={obras} value={proyectos} onChange={setProyectos} />
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold text-slate-700 mb-3">Empresa (fuera de proyectos)</p>
                  <PermisosCheckboxes value={permisosEmpresa} onChange={setPermisosEmpresa} modulos={MODULOS_EMPRESA_INFO} />
                </div>

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
                )}
                {success && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
                    Operador creado exitosamente.
                  </div>
                )}
              </form>
            </div>
            <div className="p-6 border-t border-slate-100 flex gap-3">
              <button type="button" onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button type="submit" form="create-form" disabled={loading}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
                           text-white rounded-xl text-sm font-semibold">
                {loading ? 'Creando...' : 'Crear operador'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal editar permisos */}
      {editPermisosPerfil && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="font-bold text-slate-900">Permisos de acceso</h2>
                <p className="text-xs text-slate-500 mt-0.5">{editPermisosPerfil.nombre}</p>
              </div>
              <button onClick={() => setEditPermisosPerfil(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-1">Proyectos y módulos</p>
                <p className="text-xs text-slate-400 mb-3">
                  Tildá los proyectos a los que puede acceder — cada uno con sus propios módulos.
                </p>
                <ArbolProyectos obras={obras} value={editProyectos} onChange={setEditProyectos} />
              </div>
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-700 mb-3">Empresa (fuera de proyectos)</p>
                <PermisosCheckboxes value={editPermisosEmpresa} onChange={setEditPermisosEmpresa} modulos={MODULOS_EMPRESA_INFO} />
              </div>
              {editError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{editError}</div>
              )}
            </div>
            <div className="p-6 border-t border-slate-100 flex gap-3">
              <button onClick={() => setEditPermisosPerfil(null)}
                className="flex-1 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleSavePermisos} disabled={editLoading}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
                           text-white rounded-xl text-sm font-semibold">
                {editLoading ? 'Guardando...' : 'Guardar permisos'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  )
}
