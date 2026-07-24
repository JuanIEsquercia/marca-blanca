'use client'

import { useEffect, useRef, useState } from 'react'

// Fade-up sutil cuando una sección entra en pantalla — pero el contenido
// arranca VISIBLE por defecto (SSR, sin JS, antes de hidratar). Recién si
// al montar el elemento ya está fuera de la pantalla, se lo oculta para
// animarlo al entrar. Así nunca hay una ventana en la que el contenido
// dependa de que el JS llegue a correr para poder verse — evitó un bug
// real: en la primera prueba, secciones enteras quedaban en blanco cuando
// el IntersectionObserver no llegaba a disparar antes de la captura.
type Phase = 'idle' | 'pre' | 'in'

interface Props {
  children: React.ReactNode
  className: string
  preClassName: string
  activeClassName: string
}

export default function ScrollReveal({ children, className, preClassName, activeClassName }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<Phase>('idle')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!('IntersectionObserver' in window)) return

    const rect = el.getBoundingClientRect()
    const yaVisible = rect.top < window.innerHeight && rect.bottom > 0
    if (yaVisible) return // ya está en pantalla al cargar (ej. el hero) — no hace falta animarlo

    setPhase('pre')
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setPhase('in')
          io.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const cls = phase === 'pre' ? `${className} ${preClassName}` : phase === 'in' ? `${className} ${activeClassName}` : className

  return (
    <div ref={ref} className={cls}>
      {children}
    </div>
  )
}
