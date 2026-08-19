import type { SupabaseClient } from '@supabase/supabase-js'
import { puedeAcceder } from '@/lib/permisos'
import { crearProveedorRapido } from '@/lib/proveedores'
import { crearCompradorRapido } from '@/lib/compradores'
import { crearCuentaPropiaRapida } from '@/lib/cuentasPropias'
import { CATALOGO_ENTIDADES } from './catalogo-entidades'
import type { ContextoChat, EntidadKey, NombreHerramienta } from './tipos'

function esEntidadValida(valor: unknown): valor is EntidadKey {
  return typeof valor === 'string' && valor in CATALOGO_ENTIDADES
}

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() ? valor : undefined
}

function ejecutarConsultarEstructura(input: Record<string, unknown>) {
  if (!esEntidadValida(input.entidad)) return { error: 'Entidad desconocida' }
  const def = CATALOGO_ENTIDADES[input.entidad]
  return {
    entidad: def.key,
    label: def.label,
    campos: def.campos.map(c => ({
      nombre: c.nombre, label: c.label, requerido: c.requerido,
      descripcion: c.descripcion ?? null, opciones: c.opciones ?? null,
    })),
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
  const razonSocial = texto(input.razon_social)
  if (!razonSocial) return { error: 'Falta la razón social.' }
  const nuevo = await crearProveedorRapido(supabase, ctx.constructoraId, {
    razon_social: razonSocial,
    cuit: texto(input.cuit),
    telefono: texto(input.telefono),
    email: texto(input.email),
    direccion: texto(input.direccion),
    notas: texto(input.notas),
  })
  if (!nuevo) return { error: 'No se pudo crear el proveedor.' }
  return { creado: true, id: nuevo.id, razon_social: nuevo.razon_social }
}

async function ejecutarCrearCliente(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'clientes', null)) {
    return { error: 'Este usuario no tiene el módulo Clientes habilitado.' }
  }
  const nombreCompleto = texto(input.nombre_completo)
  if (!nombreCompleto) return { error: 'Falta el nombre completo.' }
  const nuevo = await crearCompradorRapido(supabase, ctx.constructoraId, {
    nombre_completo: nombreCompleto,
    dni_cuit: texto(input.dni_cuit),
    email: texto(input.email),
    telefono: texto(input.telefono),
  })
  if (!nuevo) return { error: 'No se pudo crear el cliente.' }
  return { creado: true, id: nuevo.id, nombre_completo: nuevo.nombre_completo }
}

async function ejecutarCrearCuentaPropia(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  // A diferencia de proveedor/cliente (módulos de empresa), una cuenta sin
  // proyecto asignado (obra_id null) solo la puede crear un admin — la RLS
  // de cuentas_propias lo exige así (ver migration_068 y CuentaPropiaSelect.tsx),
  // puedeAcceder('cuentas', null) no alcanza a distinguir esto porque
  // 'cuentas' es un módulo por-proyecto, no de empresa.
  if (ctx.perfilRol !== 'admin') {
    return { error: 'Solo un administrador puede crear una cuenta de empresa (sin proyecto asignado). Para una cuenta de un proyecto puntual, hacelo desde Cuentas dentro de ese proyecto.' }
  }
  const nombre = texto(input.nombre)
  if (!nombre) return { error: 'Falta el nombre de la cuenta.' }
  const tipo = input.tipo === 'caja' ? 'caja' : 'banco'
  const moneda = input.moneda === 'USD' ? 'USD' : 'ARS'
  const nueva = await crearCuentaPropiaRapida(supabase, ctx.constructoraId, nombre, tipo, moneda)
  if (!nueva) return { error: 'No se pudo crear la cuenta.' }
  return { creado: true, id: nueva.id, nombre: nueva.nombre, tipo: nueva.tipo, moneda: nueva.moneda }
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
    case 'crear_cliente': return ejecutarCrearCliente(ctx, supabase, input)
    case 'crear_cuenta_propia': return ejecutarCrearCuentaPropia(ctx, supabase, input)
  }
}
