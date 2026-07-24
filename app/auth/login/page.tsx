'use client'

import { Suspense, useActionState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { loginAction } from '@/app/actions/auth'

function LoginForm() {
  const params = useSearchParams()
  const redirectTo = params.get('redirectTo') ?? '/admin'
  const callbackError = params.get('error') === 'auth_callback_failed'

  const [state, formAction, isPending] = useActionState(loginAction, { error: null })

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="redirectTo" value={redirectTo} />

      {callbackError && (
        <div className="flex items-center gap-2 p-3 bg-amber-950 border border-amber-800 rounded-lg">
          <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-amber-300 text-sm">El link dejó de ser válido o ya fue usado. Solicitá uno nuevo.</p>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="usuario@empresa.com"
          className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white
                     placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500
                     focus:border-transparent transition-colors"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-sm font-medium text-slate-300">Contraseña</label>
          <Link href="/auth/forgot-password" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
            ¿Olvidaste tu contraseña?
          </Link>
        </div>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white
                     placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500
                     focus:border-transparent transition-colors"
        />
      </div>

      {state.error && (
        <div className="flex items-center gap-2 p-3 bg-red-950 border border-red-800 rounded-lg">
          <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-red-300 text-sm">{state.error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
                   disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
      >
        {isPending ? 'Ingresando...' : 'Ingresar al Panel'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Image src="/logo.png" alt="" width={56} height={56} priority className="mx-auto mb-4 rounded-2xl" />
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
