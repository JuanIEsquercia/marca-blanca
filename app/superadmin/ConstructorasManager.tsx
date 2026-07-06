'use client'

import { useState, useCallback } from 'react'
import NuevaConstructoraModal from './NuevaConstructoraModal'

interface Usuario {
  id: string
  nombre: string
  email: string | null
  rol: string
}

interface Constructora {
  id: string
  nombre: string
  createdAt: string
  usuarios: Usuario[]
}

interface Props {
  initialData: Constructora[]
}

export default function ConstructorasManager({ initialData }: Props) {
  const [lista, setLista] = useState<Constructora[]>(initialData)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Editar nombre
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editNombre, setEditNombre] = useState('')

  // Confirmar eliminación de constructora
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Cambiar contraseña de usuario
  const [pwModal, setPwModal] = useState<{ userId: string; email: string | null } | null>(null)
  const [newPassword, setNewPassword] = useState('')

  // Confirmar eliminación de usuario
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<{ userId: string; constructoraId: string } | null>(null)

  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/superadmin/constructoras')
    if (res.ok) setLista(await res.json())
  }, [])

  // ── Renombrar constructora ──────────────────────────────────────
  function startEdit(c: Constructora) {
    setEditingId(c.id)
    setEditNombre(c.nombre)
    setError(null)
  }

  async function handleRenombrar(id: string) {
    if (!editNombre.trim() || editNombre === lista.find(c => c.id === id)?.nombre) {
      setEditingId(null)
      return
    }
    setLoadingId(id)
    const res = await fetch('/api/superadmin/constructoras', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ constructoraId: id, nombre: editNombre }),
    })
    if (res.ok) {
      setLista(prev => prev.map(c => c.id === id ? { ...c, nombre: editNombre.trim() } : c))
      setEditingId(null)
    } else {
      const d = await res.json()
      setError(d.error ?? 'Error al renombrar')
    }
    setLoadingId(null)
  }

  // ── Eliminar constructora ───────────────────────────────────────
  async function handleEliminarConstructora() {
    if (!confirmDeleteId) return
    setLoadingId(confirmDeleteId)
    const res = await fetch('/api/superadmin/constructoras', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ constructoraId: confirmDeleteId }),
    })
    if (res.ok) {
      setLista(prev => prev.filter(c => c.id !== confirmDeleteId))
      setConfirmDeleteId(null)
      if (expandedId === confirmDeleteId) setExpandedId(null)
    } else {
      const d = await res.json()
      setError(d.error ?? 'Error al eliminar')
    }
    setLoadingId(null)
  }

  // ── Cambiar contraseña ──────────────────────────────────────────
  async function handleCambiarPassword() {
    if (!pwModal || newPassword.length < 8) return
    setLoadingId(pwModal.userId)
    const res = await fetch('/api/superadmin/usuarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: pwModal.userId, password: newPassword }),
    })
    if (res.ok) {
      setPwModal(null)
      setNewPassword('')
    } else {
      const d = await res.json()
      setError(d.error ?? 'Error al cambiar contraseña')
    }
    setLoadingId(null)
  }

  // ── Eliminar usuario ────────────────────────────────────────────
  async function handleEliminarUsuario() {
    if (!confirmDeleteUser) return
    const { userId, constructoraId } = confirmDeleteUser
    setLoadingId(userId)
    const res = await fetch('/api/superadmin/usuarios', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    if (res.ok) {
      setLista(prev => prev.map(c =>
        c.id === constructoraId
          ? { ...c, usuarios: c.usuarios.filter(u => u.id !== userId) }
          : c
      ))
      setConfirmDeleteUser(null)
    } else {
      const d = await res.json()
      setError(d.error ?? 'Error al eliminar usuario')
    }
    setLoadingId(null)
  }

  const confirmDeleteNombre = lista.find(c => c.id === confirmDeleteId)?.nombre

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Constructoras</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {lista.length} empresa{lista.length !== 1 ? 's' : ''} registrada{lista.length !== 1 ? 's' : ''}
          </p>
        </div>
        <NuevaConstructoraModal onCreated={refresh} />
      </div>

      {/* Error global */}
      {error && (
        <div className="mb-4 flex items-center justify-between p-3 bg-red-950 border border-red-800 rounded-lg text-sm text-red-300">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-4 text-red-500 hover:text-red-300">✕</button>
        </div>
      )}

      {/* Lista de constructoras */}
      {lista.length === 0 ? (
        <div className="text-center py-16 text-slate-600">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16" />
          </svg>
          <p className="text-sm">No hay constructoras todavía.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lista.map(c => (
            <div key={c.id} className="border border-slate-800 rounded-xl overflow-hidden">
              {/* Fila principal */}
              <div className="flex items-center gap-3 px-4 py-3 bg-slate-900">
                {/* Nombre / campo de edición */}
                <div className="flex-1 min-w-0">
                  {editingId === c.id ? (
                    <input
                      autoFocus
                      value={editNombre}
                      onChange={e => setEditNombre(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRenombrar(c.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="w-full bg-slate-800 border border-indigo-500 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
                    />
                  ) : (
                    <span className="font-semibold text-white text-sm">{c.nombre}</span>
                  )}
                  <span className="text-slate-500 text-xs ml-2">
                    {new Date(c.createdAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                </div>

                {/* Acciones de la constructora */}
                <div className="flex items-center gap-1 shrink-0">
                  {editingId === c.id ? (
                    <>
                      <button
                        onClick={() => handleRenombrar(c.id)}
                        disabled={loadingId === c.id}
                        className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {loadingId === c.id ? '...' : 'Guardar'}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Usuarios toggle */}
                      <button
                        onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded-lg transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197" />
                        </svg>
                        {c.usuarios.length} usuario{c.usuarios.length !== 1 ? 's' : ''}
                        <svg className={`w-3 h-3 transition-transform ${expandedId === c.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {/* Editar */}
                      <button
                        onClick={() => startEdit(c)}
                        title="Renombrar"
                        className="p-1.5 text-slate-500 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>

                      {/* Eliminar */}
                      <button
                        onClick={() => { setConfirmDeleteId(c.id); setError(null) }}
                        title="Eliminar constructora"
                        className="p-1.5 text-slate-600 hover:text-red-400 rounded-lg hover:bg-slate-800 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Sección de usuarios (expandible) */}
              {expandedId === c.id && (
                <div className="border-t border-slate-800 bg-slate-950">
                  {c.usuarios.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-slate-600">Sin usuarios registrados en esta constructora.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-600 uppercase tracking-wider">
                          <th className="text-left px-4 py-2 font-medium">Nombre</th>
                          <th className="text-left px-4 py-2 font-medium">Email</th>
                          <th className="text-left px-4 py-2 font-medium">Rol</th>
                          <th className="px-4 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {c.usuarios.map(u => (
                          <tr key={u.id} className="border-b border-slate-900 last:border-0">
                            <td className="px-4 py-2.5 text-slate-300">{u.nombre}</td>
                            <td className="px-4 py-2.5 text-slate-400">{u.email ?? '—'}</td>
                            <td className="px-4 py-2.5">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                u.rol === 'admin'
                                  ? 'bg-indigo-900/50 text-indigo-300'
                                  : 'bg-slate-800 text-slate-400'
                              }`}>
                                {u.rol}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => { setPwModal({ userId: u.id, email: u.email }); setNewPassword(''); setError(null) }}
                                  className="text-slate-500 hover:text-slate-200 text-[10px] underline underline-offset-2"
                                >
                                  Cambiar contraseña
                                </button>
                                <button
                                  onClick={() => { setConfirmDeleteUser({ userId: u.id, constructoraId: c.id }); setError(null) }}
                                  className="text-slate-600 hover:text-red-400 transition-colors"
                                  title="Eliminar usuario"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal: confirmar eliminar constructora */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-white font-semibold mb-2">Eliminar constructora</h3>
            <p className="text-slate-400 text-sm mb-1">
              Vas a eliminar <span className="text-white font-medium">{confirmDeleteNombre}</span>.
            </p>
            <p className="text-red-400 text-xs mb-5">
              Esta acción elimina la constructora, todos sus usuarios y todos sus datos. No se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 py-2 text-sm text-slate-300 border border-slate-700 rounded-xl hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleEliminarConstructora}
                disabled={!!loadingId}
                className="flex-1 py-2 text-sm font-medium text-white bg-red-700 rounded-xl hover:bg-red-600 disabled:opacity-50"
              >
                {loadingId ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: cambiar contraseña */}
      {pwModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-white font-semibold mb-1">Nueva contraseña</h3>
            <p className="text-slate-400 text-sm mb-4">{pwModal.email}</p>
            <input
              type="text"
              autoFocus
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => { setPwModal(null); setError(null) }}
                className="flex-1 py-2 text-sm text-slate-300 border border-slate-700 rounded-xl hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleCambiarPassword}
                disabled={newPassword.length < 8 || !!loadingId}
                className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50"
              >
                {loadingId ? 'Guardando...' : 'Cambiar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: confirmar eliminar usuario */}
      {confirmDeleteUser && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-white font-semibold mb-2">Eliminar usuario</h3>
            <p className="text-slate-400 text-sm mb-5">
              El usuario perderá acceso al sistema. Esta acción no se puede deshacer.
            </p>
            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteUser(null)}
                className="flex-1 py-2 text-sm text-slate-300 border border-slate-700 rounded-xl hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleEliminarUsuario}
                disabled={!!loadingId}
                className="flex-1 py-2 text-sm font-medium text-white bg-red-700 rounded-xl hover:bg-red-600 disabled:opacity-50"
              >
                {loadingId ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
