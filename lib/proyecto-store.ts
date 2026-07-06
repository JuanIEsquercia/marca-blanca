'use client'

export interface ProyectoData {
  id: string
  nombre: string
  tipo: 'desarrollo' | 'obra'
  modo_cuentas: 'empresa' | 'especificas'
}

// Store a nivel de módulo — persiste entre renders de React (no entre recargas)
let current: ProyectoData | null = null
const listeners = new Set<() => void>()

export function setCurrentProyecto(data: ProyectoData | null) {
  current = data
  listeners.forEach(fn => fn())
}

export function getCurrentProyecto(): ProyectoData | null {
  return current
}

export function subscribeProyecto(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
