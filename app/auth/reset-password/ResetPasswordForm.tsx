'use client'

import { useActionState } from 'react'
import { actualizarPasswordAction } from '@/app/actions/auth'

export default function ResetPasswordForm() {
  const [state, formAction, isPending] = useActionState(actualizarPasswordAction, { error: null })

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">Nueva contraseña</label>
        <input
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="Mínimo 8 caracteres"
          className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white
                     placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500
                     focus:border-transparent transition-colors"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">Confirmar contraseña</label>
        <input
          type="password"
          name="confirmacion"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="Repetí la contraseña"
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
        {isPending ? 'Guardando...' : 'Guardar nueva contraseña'}
      </button>
    </form>
  )
}
