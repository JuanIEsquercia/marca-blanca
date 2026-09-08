'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { esComprobanteEnStorage, resolverUrlComprobante } from '@/lib/comprobantes'

interface Props {
  referencia: string
  className?: string
  children?: React.ReactNode
}

// Abre un comprobante en pestaña nueva. Para los guardados en Storage
// (migration_072) primero pide una URL firmada — la pestaña se abre
// ANTES del await y se le asigna la URL después, si no el bloqueador de
// popups del browser corta el window.open que no viene de un click directo.
// Los valores viejos de Cloudinary son un <a> común.
export default function LinkComprobante({ referencia, className, children }: Props) {
  const [abriendo, setAbriendo] = useState(false)
  const label = children ?? 'Ver comprobante adjunto'

  if (!esComprobanteEnStorage(referencia)) {
    return (
      <a href={referencia} target="_blank" rel="noopener noreferrer" className={className}>
        {label}
      </a>
    )
  }

  async function abrir() {
    if (abriendo) return
    setAbriendo(true)
    const pestana = window.open('', '_blank')
    try {
      const url = await resolverUrlComprobante(createClient(), referencia)
      if (pestana) pestana.location.href = url
      else window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      pestana?.close()
      alert('No se pudo abrir el comprobante. Probá de nuevo.')
    } finally {
      setAbriendo(false)
    }
  }

  return (
    <button type="button" onClick={abrir} disabled={abriendo} className={className}>
      {abriendo ? 'Abriendo...' : label}
    </button>
  )
}
