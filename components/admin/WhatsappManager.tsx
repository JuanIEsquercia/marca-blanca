'use client'

import { useState } from 'react'

interface Props {
  telefonoInicial: string | null
  // Nombre del admin que vinculó el teléfono, solo si NO es quien está
  // mirando esta pantalla — permite que cualquier admin de la constructora
  // vea y desvincule el teléfono de un compañero (ver API DELETE).
  vinculadoNombre?: string | null
  kapsoPhoneIdInicial: string | null
  numeroWhatsappInicial: string | null
}

export default function WhatsappManager({ telefonoInicial, vinculadoNombre, kapsoPhoneIdInicial, numeroWhatsappInicial }: Props) {
  const [telefono, setTelefono] = useState(telefonoInicial)
  const [kapsoPhoneId] = useState(kapsoPhoneIdInicial)
  const [numeroWhatsapp] = useState(numeroWhatsappInicial)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generarCodigo() {
    setCargando(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/whatsapp', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al generar el código')
      setCodigo(data.codigo)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al generar el código')
    } finally {
      setCargando(false)
    }
  }

  async function desvincular() {
    setCargando(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/whatsapp', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al desvincular')
      setTelefono(null)
      setCodigo(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al desvincular')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 max-w-lg space-y-6">
      {!kapsoPhoneId && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-4 py-3">
          <p className="text-sm text-amber-800 dark:text-amber-400">
            Tu constructora todavía no tiene un número de WhatsApp configurado. Contactanos para activarlo antes de poder vincular un teléfono.
          </p>
        </div>
      )}

      {kapsoPhoneId && numeroWhatsapp && (
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">Número de WhatsApp de tu constructora</p>
          <p className="text-lg font-semibold text-slate-900 dark:text-white">{numeroWhatsapp}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Este es el número al que le escribís vos (o quien vincule el teléfono) para operar el ERP por WhatsApp.</p>
        </div>
      )}

      {!kapsoPhoneId ? null : telefono ? (
        <div className="space-y-4">
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Teléfono vinculado</p>
            <p className="text-lg font-semibold text-slate-900 dark:text-white">{telefono}</p>
            {vinculadoNombre && (
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Vinculado por {vinculadoNombre}</p>
            )}
          </div>
          <button
            onClick={desvincular}
            disabled={cargando}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50 transition-colors"
          >
            Desvincular
          </button>
        </div>
      ) : codigo ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Desde el WhatsApp que querés usar, escribile a{' '}
            {numeroWhatsapp ? (
              <span className="font-semibold text-slate-900 dark:text-white">{numeroWhatsapp}</span>
            ) : (
              'el número de WhatsApp de la constructora'
            )}:
          </p>
          <p className="text-2xl font-mono font-bold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3 text-center">
            VINCULAR {codigo}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">El código vence en 10 minutos.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Todavía no vinculaste un teléfono. Solo se puede vincular uno por constructora.
          </p>
          <button
            onClick={generarCodigo}
            disabled={cargando}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            Generar código de vinculación
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400 mt-3">{error}</p>}
    </div>
  )
}
