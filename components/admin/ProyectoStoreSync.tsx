'use client'

import { useEffect } from 'react'
import { setCurrentProyecto, type ProyectoData } from '@/lib/proyecto-store'

export default function ProyectoStoreSync({ proyecto }: { proyecto: ProyectoData }) {
  useEffect(() => {
    setCurrentProyecto(proyecto)
    return () => setCurrentProyecto(null)
  }, [proyecto.id, proyecto.nombre, proyecto.tipo, proyecto.modo_cuentas])

  return null
}
