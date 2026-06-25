'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Perfil } from '@/types/database'

interface Props {
  perfiles: (Perfil & { email: string })[]
  currentUserId: string
}

export default function UsuariosManager({ perfiles, currentUserId }: Props) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rol, setRol] = useState<'admin' | 'operador'>('operador')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [, startTransition] = useTransition()

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const res = await fetch('/api/admin/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, email, password, rol }),
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error)
      return
    }

    setSuccess(true)
    setNombre('')
    setEmail('')
    setPassword('')
    setRol('operador')
    setTimeout(() => {
      setSuccess(false)
      setShowForm(false)
    }, 2000)
    startTransition(() => router.refresh())
  }

  async function handleDelete(userId: string) {
    if (!confirm('¿Eliminar este usuario? Esta acción no se puede deshacer.')) return

    const res = await fetch('/api/admin/usuarios', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })

    if (res.ok) startTransition(() => router.refresh())
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <p className="text-slate-500 text-sm">{perfiles.length} usuario(s) en el sistema</p>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500
                     text-white rounded-lg text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuevo usuario
        </button>
      </div>

      {/* Formulario de creación */}
      {showForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
          <h3 className="font-semibold text-slate-800 mb-4">Crear nuevo usuario</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nombre *</label>
              <input required value={nombre} onChange={e => setNombre(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
              <input required type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Contraseña *</label>
              <input required type="password" minLength={8} value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Rol</label>
              <select value={rol} onChange={e => setRol(e.target.value as 'admin' | 'operador')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="operador">Operador</option>
                <option value="admin">Administrador</option>
              </select>
            </div>

            {error && (
              <div className="col-span-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}
            {success && (
              <div className="col-span-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
                Usuario creado exitosamente.
              </div>
            )}

            <div className="col-span-2 flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button type="submit" disabled={loading}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-medium">
                {loading ? 'Creando...' : 'Crear usuario'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lista de usuarios */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Nombre</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Email</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Rol</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {perfiles.map(p => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {p.nombre}
                  {p.id === currentUserId && (
                    <span className="ml-2 text-xs text-indigo-600 font-normal">(vos)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{p.email}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border
                    ${p.rol === 'admin' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                    {p.rol === 'admin' ? 'Administrador' : 'Operador'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border
                    ${p.activo ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                    {p.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {p.id !== currentUserId && (
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="text-xs text-red-500 hover:text-red-700 transition-colors"
                    >
                      Eliminar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
