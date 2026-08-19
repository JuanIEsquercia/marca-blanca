import type { SupabaseClient } from '@supabase/supabase-js'
import { puedeAcceder } from '@/lib/permisos'
import { crearProveedorRapido } from '@/lib/proveedores'
import { CATALOGO_ENTIDADES } from './catalogo-entidades'
import type { ContextoChat, EntidadKey, NombreHerramienta } from './tipos'

function esEntidadValida(valor: unknown): valor is EntidadKey {
  return typeof valor === 'string' && valor in CATALOGO_ENTIDADES
}

function ejecutarConsultarEstructura(input: Record<string, unknown>) {
  if (!esEntidadValida(input.entidad)) return { error: 'Entidad desconocida' }
  const def = CATALOGO_ENTIDADES[input.entidad]
  return {
    entidad: def.key,
    label: def.label,
    campos: def.campos.map(c => ({ nombre: c.nombre, label: c.label, requerido: c.requerido, descripcion: c.descripcion ?? null })),
  }
}

function ejecutarNavegarA(input: Record<string, unknown>) {
  if (!esEntidadValida(input.entidad)) return { error: 'Entidad desconocida' }
  const def = CATALOGO_ENTIDADES[input.entidad]
  return { entidad: def.key, ruta: def.rutaNavegacion, label: `Ir a ${def.label}` }
}

async function ejecutarCrearProveedor(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'proveedores', null)) {
    return { error: 'Este usuario no tiene el módulo Proveedores habilitado.' }
  }
  const razonSocial = typeof input.razon_social === 'string' ? input.razon_social : ''
  if (!razonSocial.trim()) return { error: 'Falta la razón social.' }
  const nuevo = await crearProveedorRapido(supabase, ctx.constructoraId, {
    razon_social: razonSocial,
    cuit: typeof input.cuit === 'string' ? input.cuit : undefined,
    telefono: typeof input.telefono === 'string' ? input.telefono : undefined,
    email: typeof input.email === 'string' ? input.email : undefined,
    direccion: typeof input.direccion === 'string' ? input.direccion : undefined,
    notas: typeof input.notas === 'string' ? input.notas : undefined,
  })
  if (!nuevo) return { error: 'No se pudo crear el proveedor.' }
  return { creado: true, id: nuevo.id, razon_social: nuevo.razon_social }
}

// Dispatcher único que usa el loop agéntico (lib/chat/agente.ts) — nunca
// ejecuta SQL libre, solo estas funciones acotadas y tipadas por tool.
export async function ejecutarHerramienta(
  nombre: NombreHerramienta,
  ctx: ContextoChat,
  supabase: SupabaseClient,
  input: Record<string, unknown>
): Promise<unknown> {
  switch (nombre) {
    case 'consultar_estructura': return ejecutarConsultarEstructura(input)
    case 'navegar_a': return ejecutarNavegarA(input)
    case 'crear_proveedor': return ejecutarCrearProveedor(ctx, supabase, input)
  }
}
