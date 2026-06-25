'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const redirectTo = params.get('redirectTo') ?? '/admin/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('Credenciales incorrectas. Verificá tu email y contraseña.')
      setLoading(false)
      return
    }

    router.push(redirectTo)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
          placeholder="usuario@empresa.com"
          className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white
                     placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500
                     focus:border-transparent transition-colors"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">Contraseña</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white
                     placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500
                     focus:border-transparent transition-colors"
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-950 border border-red-800 rounded-lg">
          <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
                   disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
      >
        {loading ? 'Ingresando...' : 'Ingresar al Panel'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 21h18M3 10h18M3 7l9-4 9 4M4 10h1v11H4zm15 0h1v11h-1zM9 10h2v4H9zm4 0h2v4h-2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Panel ERP</h1>
          <p className="text-slate-400 text-sm mt-1">Acceso exclusivo para operadores autorizados</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
          <Suspense fallback={<div className="text-slate-400 text-sm text-center py-4">Cargando...</div>}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          No tenés acceso? Contactá al administrador del sistema.
        </p>
      </div>
    </div>
  )
}
