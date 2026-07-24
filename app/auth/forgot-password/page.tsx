'use client'

import { useActionState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { solicitarResetAction } from '@/app/actions/auth'

function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(solicitarResetAction, { error: null, enviado: false })

  if (state.enviado) {
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-2 p-3 bg-emerald-950 border border-emerald-800 rounded-lg">
          <svg className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-emerald-300 text-sm">
            Si ese email está registrado, te enviamos instrucciones para restablecer tu contraseña. Revisá tu casilla (y la carpeta de spam).
          </p>
        </div>
        <Link
          href="/auth/login"
          className="block w-full text-center py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg transition-colors"
        >
          Volver a Ingresar
        </Link>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-5">
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
        {isPending ? 'Enviando...' : 'Enviar instrucciones'}
      </button>

      <Link href="/auth/login" className="block text-center text-sm text-slate-400 hover:text-slate-300 transition-colors">
        Volver a Ingresar
      </Link>
    </form>
  )
}

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Image src="/logo.png" alt="" width={56} height={56} className="mx-auto mb-4 rounded-2xl" />
          <h1 className="text-2xl font-bold text-white">Recuperar contraseña</h1>
          <p className="text-slate-400 text-sm mt-1">Te mandamos un link para elegir una nueva</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
          <ForgotPasswordForm />
        </div>
      </div>
    </div>
  )
}
