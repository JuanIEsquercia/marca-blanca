import type { SupabaseClient } from '@supabase/supabase-js'
import { redondear2 } from '@/lib/utils'
import { puedeAcceder } from '@/lib/permisos'
import { crearProveedorRapido } from '@/lib/proveedores'
import { crearCompradorRapido } from '@/lib/compradores'
import { crearCuentaPropiaRapida } from '@/lib/cuentasPropias'
import { crearCategoriaCostoRapida } from '@/lib/categoriasCosto'
import { crearPersonalRapido, crearCuadrillaRapida } from '@/lib/personal'
import { crearGastoRapido } from '@/lib/gastos'
import { obtenerCuentasPropias, calcularCajaEmpresa, calcularCajaProyecto } from '@/lib/tesoreria'
import { obtenerIngresos } from '@/lib/ingresos'
import type { TipoContratacion } from '@/types/database'
import { CATALOGO_ENTIDADES } from './catalogo-entidades'
import { SECCIONES_EMPRESA, SECCIONES_PROYECTO } from './catalogo-secciones'
import { CATALOGO_MODULOS } from './catalogo-modulos'
import type { ContextoChat, EntidadKey, ModuloConocimientoKey, NombreHerramienta, SeccionEmpresaKey, SeccionProyectoKey } from './tipos'

function esEntidadValida(valor: unknown): valor is EntidadKey {
  return typeof valor === 'string' && valor in CATALOGO_ENTIDADES
}

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() ? valor : undefined
}

function numero(valor: unknown): number | undefined {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor
  if (typeof valor === 'string' && valor.trim()) {
    const n = Number(valor.trim().replace(',', '.'))
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

const TIPOS_CONTRATACION: TipoContratacion[] = ['relacion_dependencia', 'contratado', 'subcontratista']
function tipoContratacion(valor: unknown): TipoContratacion | undefined {
  return typeof valor === 'string' && (TIPOS_CONTRATACION as string[]).includes(valor) ? (valor as TipoContratacion) : undefined
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

function ejecutarConsultarModulo(input: Record<string, unknown>) {
  const modulo = texto(input.modulo) as ModuloConocimientoKey | undefined
  const def = modulo ? CATALOGO_MODULOS[modulo] : undefined
  if (!def) return { error: 'No tengo el detalle interno de ese módulo — ofrecé navegar a la sección en vez de adivinar cómo funciona.' }
  return {
    modulo: def.key,
    label: def.label,
    resumen: def.resumen,
    subsecciones: def.subsecciones,
    decisiones: def.decisiones ?? [],
  }
}

function ejecutarNavegarA(ctx: ContextoChat, input: Record<string, unknown>) {
  const seccion = texto(input.seccion) as SeccionEmpresaKey | undefined
  const def = SECCIONES_EMPRESA.find(s => s.key === seccion)
  if (!def) return { error: 'Sección desconocida.' }
  if (def.soloAdmin && ctx.perfilRol !== 'admin') {
    return { error: `Solo un administrador puede acceder a ${def.label}.` }
  }
  if (def.modulo && !puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, def.modulo, null)) {
    return { error: `Este usuario no tiene el módulo ${def.label} habilitado.` }
  }

  const subseccionInput = texto(input.subseccion)
  const sub = subseccionInput ? def.subsecciones?.find(s => s.key === subseccionInput) : undefined
  const ruta = sub ? `${def.ruta}?tab=${sub.key}` : def.ruta
  const label = sub ? `Ir a ${def.label} — ${sub.label}` : `Ir a ${def.label}`

  return { seccion: def.key, ruta, label }
}

async function ejecutarListarProyectos(ctx: ContextoChat, supabase: SupabaseClient) {
  // RLS de `obras` ya devuelve solo lo que este usuario puede ver (admin:
  // todo; operador: solo lo asignado en perfil_proyectos) — no hace falta
  // filtrar de nuevo acá.
  const { data, error } = await supabase
    .from('obras')
    .select('id, nombre, tipo')
    .eq('constructora_id', ctx.constructoraId)
    .order('nombre')
  if (error) return { error: 'No se pudo obtener la lista de proyectos.' }
  return { proyectos: (data ?? []).map(o => ({ id: o.id, nombre: o.nombre, tipo: o.tipo })) }
}

async function ejecutarNavegarAProyecto(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  const obraId = texto(input.obraId)
  if (!obraId) return { error: 'Falta indicar de qué proyecto — usá listar_proyectos primero para conseguir el id real.' }

  const { data: obra } = await supabase
    .from('obras')
    .select('id, nombre, tipo, modo_cuentas')
    .eq('id', obraId)
    .maybeSingle()
  if (!obra) return { error: 'No se encontró ese proyecto, o este usuario no tiene acceso.' }

  const seccionInput = (texto(input.seccion) as SeccionProyectoKey | undefined) ?? 'dashboard'
  const def = SECCIONES_PROYECTO.find(s => s.key === seccionInput)
  if (!def) return { error: 'Sección de proyecto desconocida.' }
  if (!def.tipos.includes(obra.tipo)) {
    return { error: `"${def.label}" no existe para este tipo de proyecto (${obra.tipo}).` }
  }
  if (def.soloModoCuentas && obra.modo_cuentas !== def.soloModoCuentas) {
    return { error: 'Este proyecto no tiene cuentas propias — usa el pool de cuentas de la empresa.' }
  }
  if (def.modulo && !puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, def.modulo, obraId)) {
    return { error: `Este usuario no tiene el módulo ${def.label} habilitado en el proyecto "${obra.nombre}".` }
  }

  // contratoId (solo tiene sentido para seccion='certificados', ver
  // certificados/page.tsx): valida que el contrato sea de ESTA obra antes
  // de armar el ?contrato= — nunca confía en un id suelto del modelo.
  const contratoId = texto(input.contratoId)
  let contratoLabel = ''
  if (contratoId && def.key === 'certificados') {
    const { data: contrato } = await supabase.from('contratos_obra').select('id, tipo').eq('id', contratoId).eq('obra_id', obraId).maybeSingle()
    if (!contrato) return { error: 'No se encontró ese contrato en este proyecto.' }
    contratoLabel = ` (${contrato.tipo === 'cliente' ? 'contrato cliente' : 'subcontratista'})`
  }

  const ruta = contratoId && contratoLabel ? `/admin/proyectos/${obra.id}/${def.segmento}?contrato=${contratoId}` : `/admin/proyectos/${obra.id}/${def.segmento}`

  return {
    obraId: obra.id,
    obraNombre: obra.nombre,
    seccion: def.key,
    ruta,
    label: `Ir a ${def.label}${contratoLabel} — ${obra.nombre}`,
  }
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

async function ejecutarCrearCategoriaGasto(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'gastos', null)) {
    return { error: 'Este usuario no tiene el módulo Gastos habilitado en ningún proyecto.' }
  }
  const nombre = texto(input.nombre)
  if (!nombre) return { error: 'Falta el nombre de la categoría.' }
  const nueva = await crearCategoriaCostoRapida(supabase, ctx.constructoraId, { nombre })
  if (!nueva) return { error: 'No se pudo crear la categoría.' }
  return { creado: true, id: nueva.id, nombre: nueva.nombre }
}

async function ejecutarCrearPersonal(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'personal', null)) {
    return { error: 'Este usuario no tiene el módulo Personal habilitado.' }
  }
  const nombre = texto(input.nombre)
  if (!nombre) return { error: 'Falta el nombre de la persona.' }
  const nueva = await crearPersonalRapido(supabase, ctx.constructoraId, {
    nombre,
    dni: texto(input.dni),
    cuil: texto(input.cuil),
    telefono: texto(input.telefono),
    tipo_contratacion: tipoContratacion(input.tipo_contratacion),
    categoria: texto(input.categoria),
    jornal: numero(input.jornal),
  })
  if (!nueva) return { error: 'No se pudo crear la persona.' }
  return { creado: true, id: nueva.id, nombre: nueva.nombre }
}

async function ejecutarCrearCuadrilla(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'personal', null)) {
    return { error: 'Este usuario no tiene el módulo Personal habilitado.' }
  }
  const nombre = texto(input.nombre)
  if (!nombre) return { error: 'Falta el nombre de la cuadrilla.' }
  const nueva = await crearCuadrillaRapida(supabase, ctx.constructoraId, { nombre, notas: texto(input.notas) })
  if (!nueva) return { error: 'No se pudo crear la cuadrilla.' }
  return { creado: true, id: nueva.id, nombre: nueva.nombre }
}

async function ejecutarListarProveedores(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  // Misma lógica que ejecutarListarProyectos: la RLS de `proveedores` ya
  // devuelve vacío si este usuario no tiene el módulo — no hace falta
  // duplicar el chequeo acá. Tope de 50 + filtro opcional por nombre: una
  // constructora con muchos proveedores no debería mandar la nómina entera
  // en cada charla — más tokens (más costo) sin necesidad si el usuario ya
  // dio una pista del nombre.
  let query = supabase
    .from('proveedores')
    .select('id, razon_social')
    .eq('constructora_id', ctx.constructoraId)
    .order('razon_social')
    .limit(50)
  const nombre = texto(input.nombre)
  if (nombre) query = query.ilike('razon_social', `%${nombre}%`)

  const { data, error } = await query
  if (error) return { error: 'No se pudo obtener la lista de proveedores.' }
  return {
    proveedores: (data ?? []).map(p => ({ id: p.id, razon_social: p.razon_social })),
    truncado: !nombre && (data ?? []).length === 50,
  }
}

async function ejecutarListarCategoriasGasto(ctx: ContextoChat, supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('categorias_costo')
    .select('id, nombre')
    .eq('constructora_id', ctx.constructoraId)
    .order('nombre')
  if (error) return { error: 'No se pudo obtener la lista de categorías.' }
  return { categorias: (data ?? []).map(c => ({ id: c.id, nombre: c.nombre })) }
}

async function ejecutarCrearGasto(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  const descripcion = texto(input.descripcion)
  if (!descripcion) return { error: 'Falta la descripción del gasto.' }
  const monto = numero(input.monto)
  if (!monto || monto <= 0) return { error: 'Falta un monto válido.' }

  const proveedorId = texto(input.proveedor_id)
  const certificadoId = texto(input.certificado_id)
  let obraId = texto(input.obra_id) ?? null

  // certificado_id (pago a subcontratista, ver ContratoObraCard.tsx "+
  // Agregar pago"): si viene, manda sobre el resto — se valida que sea de
  // un contrato de SUBCONTRATISTA (no cliente, esos se cobran, no se
  // pagan) y, si también vinieron proveedor_id/obra_id, que coincidan.
  if (certificadoId) {
    const { data: cert } = await supabase.from('certificados_avance').select('id, obra_id, contrato_obra_id').eq('id', certificadoId).maybeSingle()
    if (!cert) return { error: 'No se encontró ese certificado, o este usuario no tiene acceso.' }
    const { data: contrato } = await supabase.from('contratos_obra').select('tipo, proveedor_id').eq('id', cert.contrato_obra_id).maybeSingle()
    if (!contrato || contrato.tipo !== 'subcontratista') {
      return { error: 'Ese certificado no es de un contrato con subcontratista — no corresponde pagarlo con un gasto.' }
    }
    if (proveedorId && contrato.proveedor_id !== proveedorId) {
      return { error: 'Ese certificado no pertenece al proveedor indicado.' }
    }
    if (obraId && obraId !== cert.obra_id) {
      return { error: 'Ese certificado no pertenece al proyecto indicado.' }
    }
    obraId = cert.obra_id
  }

  const cuentaProveedorId = texto(input.cuenta_proveedor_id)
  if (cuentaProveedorId) {
    const { data: cuenta } = await supabase.from('cuentas_proveedor').select('id, proveedor_id').eq('id', cuentaProveedorId).maybeSingle()
    if (!cuenta) return { error: 'No se encontró esa cuenta de proveedor.' }
    if (proveedorId && cuenta.proveedor_id !== proveedorId) {
      return { error: 'Esa cuenta no pertenece al proveedor indicado.' }
    }
  }

  if (obraId) {
    const { data: obra } = await supabase.from('obras').select('id, nombre').eq('id', obraId).maybeSingle()
    if (!obra) return { error: 'No se encontró ese proyecto, o este usuario no tiene acceso.' }
    if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'gastos', obraId)) {
      return { error: `Este usuario no tiene el módulo Gastos habilitado en el proyecto "${obra.nombre}".` }
    }
  } else if (ctx.perfilRol !== 'admin') {
    return { error: 'Solo un administrador puede cargar un gasto sin proyecto asignado (gasto administrativo de la empresa). Indicá a qué proyecto imputarlo.' }
  }

  const moneda = input.moneda === 'USD' ? 'USD' : 'ARS'
  const nuevo = await crearGastoRapido(supabase, ctx.constructoraId, {
    descripcion,
    monto,
    moneda,
    obraId,
    proveedorId,
    cuentaProveedorId,
    categoriaId: texto(input.categoria_id),
    certificadoId,
    numeroComprobante: texto(input.numero_comprobante),
    montoNeto: numero(input.monto_neto),
    iva: numero(input.iva),
    percepciones: numero(input.percepciones),
    fechaVencimiento: texto(input.fecha_vencimiento),
    notas: texto(input.notas),
  })
  if (!nuevo) return { error: 'No se pudo crear el gasto.' }
  return { creado: true, id: nuevo.id, descripcion: nuevo.descripcion, monto: nuevo.monto, moneda: nuevo.moneda }
}

// El modelo NO debe sumar montos a mano en el texto de su respuesta (ya
// pasó: se comió un ítem grande y dio un total mal) — cualquier tool que
// devuelva una lista de montos tiene que traer el total ya calculado acá,
// agrupado por moneda (nunca se suman ARS y USD entre sí).
function totalesPorMoneda(items: { monto: number; moneda: string }[]): Record<string, number> {
  const totales: Record<string, number> = {}
  for (const it of items) totales[it.moneda] = redondear2((totales[it.moneda] ?? 0) + it.monto)
  return totales
}

interface FilaCuentaProveedor { id: string; tipo: string; denominacion: string | null; numero: string | null; moneda: string }

async function ejecutarListarCuentasProveedor(supabase: SupabaseClient, input: Record<string, unknown>) {
  const proveedorId = texto(input.proveedorId)
  if (!proveedorId) return { error: 'Falta indicar de qué proveedor — usá listar_proveedores primero.' }
  const { data, error } = await supabase
    .from('cuentas_proveedor')
    .select('id, tipo, denominacion, numero, moneda')
    .eq('proveedor_id', proveedorId)
    .order('tipo')
  if (error) return { error: 'No se pudo obtener las cuentas de este proveedor.' }
  return { cuentas: (data ?? []) as FilaCuentaProveedor[] }
}

interface FilaCertificadoPago {
  id: string
  numero: number
  periodo: string
  estado: string
  monto_certificado: number
  contrato_obra_id: string
}

async function ejecutarListarCertificadosPagoProveedor(supabase: SupabaseClient, input: Record<string, unknown>) {
  const proveedorId = texto(input.proveedorId)
  if (!proveedorId) return { error: 'Falta indicar de qué proveedor — usá listar_proveedores primero.' }

  let contratosQuery = supabase
    .from('contratos_obra')
    .select('id, descripcion')
    .eq('proveedor_id', proveedorId)
    .eq('tipo', 'subcontratista')
  const obraId = texto(input.obraId)
  if (obraId) contratosQuery = contratosQuery.eq('obra_id', obraId)
  const { data: contratos } = await contratosQuery
  if (!contratos || contratos.length === 0) return { certificados: [] }

  const contratoIds = contratos.map(c => c.id)
  const { data: certs } = await supabase
    .from('certificados_avance')
    .select('id, numero, periodo, estado, monto_certificado, contrato_obra_id')
    .in('contrato_obra_id', contratoIds)
    .order('numero')
  if (!certs || certs.length === 0) return { certificados: [] }

  const { data: gastos } = await supabase
    .from('gastos')
    .select('certificado_id, monto')
    .in('certificado_id', certs.map(c => c.id))

  const pagadoPorCert: Record<string, number> = {}
  for (const g of (gastos ?? []) as { certificado_id: string | null; monto: number }[]) {
    if (!g.certificado_id) continue
    pagadoPorCert[g.certificado_id] = (pagadoPorCert[g.certificado_id] ?? 0) + g.monto
  }

  const contratoDescPorId = new Map(contratos.map(c => [c.id, c.descripcion]))

  return {
    certificados: (certs as FilaCertificadoPago[]).map(c => ({
      id: c.id,
      numero: c.numero,
      periodo: c.periodo,
      estado: c.estado,
      contrato: contratoDescPorId.get(c.contrato_obra_id) ?? null,
      monto_certificado: c.monto_certificado,
      ya_pagado: redondear2(pagadoPorCert[c.id] ?? 0),
      saldo_sin_pagar: redondear2(c.monto_certificado - (pagadoPorCert[c.id] ?? 0)),
    })),
  }
}

interface ItemOrdenValido { nombre: string; cantidad: number; unidad?: string }

function parsearItemsOrden(valor: unknown): ItemOrdenValido[] {
  if (!Array.isArray(valor)) return []
  const items: ItemOrdenValido[] = []
  for (const raw of valor) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    const nombre = texto(r.producto_nombre)
    const cantidad = numero(r.cantidad)
    if (!nombre || !cantidad || cantidad <= 0) continue
    items.push({ nombre, cantidad, unidad: texto(r.unidad_medida) })
  }
  return items
}

// Igual criterio que ComprasManager.tsx (ver handleSubmit): resuelve cada
// producto por nombre vía la RPC obtener_o_crear_producto (get-or-create
// con dedupe por nombre_normalizado) en vez de exigir un id de antemano —
// el chat no tiene (ni necesita) una tool de listar_productos separada.
async function ejecutarCrearOrdenCompra(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'compras', null)) {
    return { error: 'Este usuario no tiene el módulo Compras habilitado.' }
  }

  const items = parsearItemsOrden(input.items)
  if (items.length === 0) return { error: 'La orden necesita al menos un ítem válido (producto y cantidad).' }

  const obraId = texto(input.obra_id) ?? null
  if (obraId) {
    const { data: obra } = await supabase.from('obras').select('id').eq('id', obraId).maybeSingle()
    if (!obra) return { error: 'No se encontró ese proyecto, o este usuario no tiene acceso.' }
  }

  const { data: orden, error: errOrden } = await supabase
    .from('ordenes_compra')
    .insert({
      constructora_id: ctx.constructoraId,
      obra_id: obraId,
      fecha_emision: texto(input.fecha_emision) ?? new Date().toISOString().slice(0, 10),
      notas: texto(input.notas) ?? null,
    })
    .select('id, numero')
    .single()
  if (errOrden || !orden) return { error: 'No se pudo crear la orden de compra.' }

  const itemsRows: { orden_compra_id: string; producto_id: string; cantidad_solicitada: number; unidad_medida: string | null }[] = []
  for (const item of items) {
    const { data: producto, error: errProducto } = await supabase
      .rpc('obtener_o_crear_producto', {
        p_constructora_id: ctx.constructoraId,
        p_nombre: item.nombre,
        p_unidad_medida: item.unidad ?? 'unidad',
      })
      .single() as { data: { id: string; unidad_medida: string } | null; error: { message: string } | null }
    if (errProducto || !producto) return { error: `No se pudo resolver el producto "${item.nombre}".` }
    itemsRows.push({
      orden_compra_id: orden.id,
      producto_id: producto.id,
      cantidad_solicitada: item.cantidad,
      unidad_medida: producto.unidad_medida ?? null,
    })
  }

  const { error: errItems } = await supabase.from('orden_compra_items').insert(itemsRows)
  if (errItems) return { error: `La orden #${orden.numero} se creó pero hubo un error al cargar los ítems: ${errItems.message}` }

  return { creado: true, id: orden.id, numero: orden.numero, items: items.length }
}

interface FilaContratoObra {
  id: string
  tipo: 'cliente' | 'subcontratista'
  estado: string
  moneda: string
  compradores: { nombre_completo: string } | null
  proveedores: { razon_social: string } | null
}

async function ejecutarListarContratosObra(supabase: SupabaseClient, input: Record<string, unknown>) {
  const obraId = texto(input.obraId)
  if (!obraId) return { error: 'Falta indicar de qué proyecto — usá listar_proyectos primero.' }
  const { data, error } = await supabase
    .from('contratos_obra')
    .select('id, tipo, estado, moneda, compradores(nombre_completo), proveedores(razon_social)')
    .eq('obra_id', obraId)
    .order('created_at', { ascending: true })
  if (error) return { error: 'No se pudo obtener los contratos de este proyecto.' }
  return {
    contratos: ((data ?? []) as unknown as FilaContratoObra[]).map(c => ({
      id: c.id,
      tipo: c.tipo,
      estado: c.estado,
      moneda: c.moneda,
      contraparte: c.tipo === 'cliente' ? (c.compradores?.nombre_completo ?? 'Cliente') : (c.proveedores?.razon_social ?? 'Subcontratista'),
    })),
  }
}

// Calcula, por rubro, el % acumulado máximo ya certificado en certificados
// previos de ESE contrato — mismo criterio que avanceAcumuladoPrevio en
// ContratoObraCard.tsx (un rubro puede aparecer en varios certificados; lo
// que importa es el último acumulado, no la suma).
async function previoPorItemDeContrato(supabase: SupabaseClient, contratoId: string): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('certificado_items')
    .select('contrato_obra_item_id, pct_avance_acumulado, certificados_avance!inner(contrato_obra_id)')
    .eq('certificados_avance.contrato_obra_id', contratoId)
  const previo: Record<string, number> = {}
  for (const ci of (data ?? []) as { contrato_obra_item_id: string; pct_avance_acumulado: number }[]) {
    previo[ci.contrato_obra_item_id] = Math.max(previo[ci.contrato_obra_item_id] ?? 0, ci.pct_avance_acumulado)
  }
  return previo
}

async function ejecutarConsultarRubrosContrato(supabase: SupabaseClient, input: Record<string, unknown>) {
  const contratoId = texto(input.contratoId)
  if (!contratoId) return { error: 'Falta indicar de qué contrato — usá listar_contratos_obra primero.' }

  const { data: items, error: errItems } = await supabase
    .from('contrato_obra_items')
    .select('id, rubro, unidad, monto_contratado')
    .eq('contrato_obra_id', contratoId)
    .order('orden')
  if (errItems) return { error: 'No se pudo obtener los rubros de este contrato.' }
  if (!items || items.length === 0) return { error: 'Este contrato no tiene rubros cargados por ítem — no se puede certificar por rubro.' }

  const previoPorItem = await previoPorItemDeContrato(supabase, contratoId)

  return {
    rubros: items.map(it => ({
      id: it.id,
      rubro: it.rubro,
      unidad: it.unidad,
      monto_contratado: it.monto_contratado,
      pct_avance_acumulado_actual: previoPorItem[it.id] ?? 0,
    })),
  }
}

interface ItemPctInput { id: string; pct: number }

function parsearItemsCertificado(valor: unknown): ItemPctInput[] {
  if (!Array.isArray(valor)) return []
  const items: ItemPctInput[] = []
  for (const raw of valor) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    const id = texto(r.contrato_obra_item_id)
    const pct = numero(r.pct_avance_acumulado)
    if (!id || pct === undefined || pct < 0 || pct > 100) continue
    items.push({ id, pct })
  }
  return items
}

// Mismo flujo de dos pasos que handleCertSubmit en ContratoObraCard.tsx: el
// header nace con monto_certificado/porcentaje_avance en 0 (placeholder), y
// el trigger recalcular_monto_certificado los recalcula solo al insertar
// los certificado_items — por eso se re-lee el certificado al final en vez
// de calcular el total acá.
async function ejecutarCrearCertificadoAvance(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  const contratoId = texto(input.contrato_id)
  const periodo = texto(input.periodo)
  if (!contratoId) return { error: 'Falta indicar el contrato.' }
  if (!periodo) return { error: 'Falta el período que cubre este certificado.' }

  const { data: contrato } = await supabase.from('contratos_obra').select('id, obra_id').eq('id', contratoId).maybeSingle()
  if (!contrato) return { error: 'No se encontró ese contrato, o este usuario no tiene acceso.' }
  if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'certificados', contrato.obra_id)) {
    return { error: 'Este usuario no tiene el módulo Certificados habilitado en este proyecto.' }
  }

  const { data: itemsContrato, error: errItemsContrato } = await supabase
    .from('contrato_obra_items')
    .select('id, monto_contratado')
    .eq('contrato_obra_id', contratoId)
  if (errItemsContrato || !itemsContrato || itemsContrato.length === 0) {
    return { error: 'Este contrato no tiene rubros cargados por ítem — no se puede certificar por rubro.' }
  }

  const itemsInput = parsearItemsCertificado(input.items)
  if (itemsInput.length === 0) return { error: 'Falta indicar el % de avance de al menos un rubro.' }

  const idsValidos = new Set(itemsContrato.map(i => i.id))
  for (const i of itemsInput) {
    if (!idsValidos.has(i.id)) return { error: 'Uno de los rubros indicados no pertenece a este contrato — volvé a consultar_rubros_contrato.' }
  }

  const previoPorItem = await previoPorItemDeContrato(supabase, contratoId)
  for (const i of itemsInput) {
    const previo = previoPorItem[i.id] ?? 0
    if (i.pct < previo) return { error: `No se puede bajar el avance de un rubro (ya tenía ${previo}% acumulado).` }
  }
  const pctPorItem = new Map(itemsInput.map(i => [i.id, i.pct]))

  const { data: nuevoCert, error: errCert } = await supabase
    .from('certificados_avance')
    .insert({
      contrato_obra_id: contratoId,
      obra_id: contrato.obra_id,
      constructora_id: ctx.constructoraId,
      periodo,
      porcentaje_avance: 0,
      monto_certificado: 0,
      descripcion_avances: texto(input.descripcion_avances) ?? null,
      notas: texto(input.notas) ?? null,
      estado: 'borrador',
    })
    .select('id')
    .single()
  if (errCert || !nuevoCert) return { error: 'No se pudo crear el certificado.' }

  const filas = itemsContrato.map(item => {
    const previo = previoPorItem[item.id] ?? 0
    const nuevo = pctPorItem.get(item.id) ?? previo
    return {
      certificado_id: nuevoCert.id,
      contrato_obra_item_id: item.id,
      constructora_id: ctx.constructoraId,
      pct_avance_acumulado: nuevo,
      monto_certificado: redondear2(((nuevo - previo) / 100) * item.monto_contratado),
    }
  })

  const { error: errCertItems } = await supabase.from('certificado_items').insert(filas)
  if (errCertItems) {
    await supabase.from('certificados_avance').delete().eq('id', nuevoCert.id)
    return { error: `No se pudo cargar el avance por rubro: ${errCertItems.message}` }
  }

  const { data: certFinal } = await supabase
    .from('certificados_avance')
    .select('numero, monto_certificado, porcentaje_avance')
    .eq('id', nuevoCert.id)
    .maybeSingle()

  return {
    creado: true,
    id: nuevoCert.id,
    numero: certFinal?.numero,
    monto_certificado: certFinal?.monto_certificado,
    porcentaje_avance: certFinal?.porcentaje_avance,
  }
}

interface FilaGastoPendiente {
  id: string
  descripcion: string
  monto: number
  moneda: string
  fecha_vencimiento: string
  obra_id: string | null
  proveedores: { razon_social: string } | null
  obras: { nombre: string } | null
}

async function ejecutarListarGastosPendientes(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  let query = supabase
    .from('gastos')
    .select('id, descripcion, monto, moneda, fecha_vencimiento, obra_id, proveedores(razon_social), obras(nombre)')
    .eq('constructora_id', ctx.constructoraId)
    .eq('estado', 'Pendiente')
    .order('fecha_vencimiento', { ascending: true })
    .limit(30)

  const obraId = texto(input.obraId)
  if (obraId) query = query.eq('obra_id', obraId)
  const proveedorId = texto(input.proveedorId)
  if (proveedorId) query = query.eq('proveedor_id', proveedorId)

  const { data, error } = await query
  if (error) return { error: 'No se pudo obtener los gastos pendientes.' }
  const filas = (data ?? []) as unknown as FilaGastoPendiente[]
  return {
    gastos: filas.map(g => ({
      id: g.id,
      descripcion: g.descripcion,
      monto: g.monto,
      moneda: g.moneda,
      fecha_vencimiento: g.fecha_vencimiento,
      proveedor: g.proveedores?.razon_social ?? null,
      proyecto: g.obras?.nombre ?? (g.obra_id ? null : 'Administrativo (sin proyecto)'),
    })),
    // Total ya calculado por moneda — nunca sumar los montos de arriba a
    // mano en la respuesta, usar este campo tal cual.
    totales_por_moneda: totalesPorMoneda(filas),
  }
}

interface GastoParaPago { id: string; obra_id: string | null; moneda: string; estado: string; descripcion: string; monto: number }

async function obtenerGastoParaPago(supabase: SupabaseClient, gastoId: string): Promise<GastoParaPago | null> {
  const { data } = await supabase.from('gastos').select('id, obra_id, moneda, estado, descripcion, monto').eq('id', gastoId).maybeSingle()
  return data as GastoParaPago | null
}

// Mismo criterio que cuentasPermitidasParaObra() en GastosManager.tsx: un
// gasto de un proyecto en modo "específicas" solo se paga con SUS cuentas,
// nunca con las de otro proyecto ni con el pool — reusa la función que ya
// usa el resto del sistema (lib/tesoreria.ts) en vez de reimplementar la
// regla acá.
async function cuentasValidasParaGasto(supabase: SupabaseClient, constructoraId: string, gasto: GastoParaPago) {
  let modo: 'empresa' | 'especificas' = 'empresa'
  if (gasto.obra_id) {
    const { data: obra } = await supabase.from('obras').select('modo_cuentas').eq('id', gasto.obra_id).maybeSingle()
    modo = (obra?.modo_cuentas as 'empresa' | 'especificas' | null) ?? 'empresa'
  }
  return obtenerCuentasPropias(supabase, constructoraId, gasto.obra_id, modo, gasto.moneda)
}

async function ejecutarListarCuentasDisponiblesGasto(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  const gastoId = texto(input.gastoId)
  if (!gastoId) return { error: 'Falta indicar de qué gasto — usá listar_gastos_pendientes primero.' }
  const gasto = await obtenerGastoParaPago(supabase, gastoId)
  if (!gasto) return { error: 'No se encontró ese gasto, o este usuario no tiene acceso.' }
  const cuentas = await cuentasValidasParaGasto(supabase, ctx.constructoraId, gasto)
  return { cuentas: cuentas.map(c => ({ id: c.id, nombre: c.nombre, moneda: c.moneda })) }
}

async function ejecutarMarcarGastoPagado(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  const gastoId = texto(input.gasto_id)
  const cuentaId = texto(input.cuenta_propia_id)
  if (!gastoId) return { error: 'Falta indicar el gasto.' }
  if (!cuentaId) return { error: 'Falta indicar la cuenta.' }

  const gasto = await obtenerGastoParaPago(supabase, gastoId)
  if (!gasto) return { error: 'No se encontró ese gasto, o este usuario no tiene acceso.' }
  if (gasto.estado === 'Pagado') return { error: 'Ese gasto ya está marcado como pagado.' }

  const cuentas = await cuentasValidasParaGasto(supabase, ctx.constructoraId, gasto)
  if (!cuentas.some(c => c.id === cuentaId)) {
    return { error: 'Esa cuenta no es válida para este gasto — volvé a llamar a listar_cuentas_disponibles_gasto.' }
  }

  const { error } = await supabase
    .from('gastos')
    .update({
      estado: 'Pagado',
      fecha_pago: texto(input.fecha_pago) ?? new Date().toISOString().slice(0, 10),
      cuenta_propia_id: cuentaId,
    })
    .eq('id', gastoId)
  if (error) return { error: 'No se pudo registrar el pago.' }

  return { pagado: true, id: gasto.id, descripcion: gasto.descripcion, monto: gasto.monto, moneda: gasto.moneda }
}

interface FilaCertificadoParaCobro {
  id: string
  numero: number
  periodo: string
  estado: string
  monto_certificado: number
}

async function ejecutarListarCertificadosContrato(supabase: SupabaseClient, input: Record<string, unknown>) {
  const contratoId = texto(input.contratoId)
  if (!contratoId) return { error: 'Falta indicar de qué contrato — usá listar_contratos_obra primero.' }

  const { data: certs, error: errCerts } = await supabase
    .from('certificados_avance')
    .select('id, numero, periodo, estado, monto_certificado')
    .eq('contrato_obra_id', contratoId)
    .order('numero')
  if (errCerts) return { error: 'No se pudo obtener los certificados de este contrato.' }
  if (!certs || certs.length === 0) return { certificados: [] }

  const { data: cobros } = await supabase
    .from('cobros_proyecto')
    .select('certificado_id, monto')
    .eq('contrato_obra_id', contratoId)
  const cobradoPorCert: Record<string, number> = {}
  for (const c of (cobros ?? []) as { certificado_id: string | null; monto: number }[]) {
    if (!c.certificado_id) continue
    cobradoPorCert[c.certificado_id] = (cobradoPorCert[c.certificado_id] ?? 0) + c.monto
  }

  return {
    certificados: (certs as FilaCertificadoParaCobro[]).map(c => ({
      id: c.id,
      numero: c.numero,
      periodo: c.periodo,
      estado: c.estado,
      monto_certificado: c.monto_certificado,
      ya_cobrado_o_en_curso: redondear2(cobradoPorCert[c.id] ?? 0),
      saldo_sin_cobro: redondear2(c.monto_certificado - (cobradoPorCert[c.id] ?? 0)),
    })),
  }
}

// El certificado es opcional a propósito (ver CobrosObraManager.tsx,
// mkEmptyCobro/handleNuevoSubmit): un cobro puede no venir de ningún
// certificado — anticipos o señas cobrados antes de certificar avance son
// un caso real y frecuente. Lo único obligatorio de verdad es el contrato.
async function ejecutarCrearCobro(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  const contratoId = texto(input.contrato_id)
  if (!contratoId) return { error: 'Falta indicar el contrato.' }
  const monto = numero(input.monto)
  if (!monto || monto <= 0) return { error: 'Falta un monto válido.' }

  const { data: contrato } = await supabase.from('contratos_obra').select('id, obra_id, tipo, moneda').eq('id', contratoId).maybeSingle()
  if (!contrato) return { error: 'No se encontró ese contrato, o este usuario no tiene acceso.' }
  if (contrato.tipo !== 'cliente') {
    return { error: 'Este contrato es con un subcontratista — a un subcontratista se le paga con un gasto, no se le cobra.' }
  }
  if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'cobros', contrato.obra_id)) {
    return { error: 'Este usuario no tiene el módulo Cobros habilitado en este proyecto.' }
  }

  const certificadoId = texto(input.certificado_id)
  if (certificadoId) {
    const { data: cert } = await supabase.from('certificados_avance').select('id').eq('id', certificadoId).eq('contrato_obra_id', contratoId).maybeSingle()
    if (!cert) return { error: 'Ese certificado no pertenece a este contrato — volvé a consultar listar_certificados_contrato.' }
  }

  const moneda = input.moneda === 'USD' || input.moneda === 'ARS' ? input.moneda : contrato.moneda
  const fecha = texto(input.fecha_vencimiento) ?? new Date().toISOString().slice(0, 10)

  const { data: nuevo, error } = await supabase
    .from('cobros_proyecto')
    .insert({
      obra_id: contrato.obra_id,
      constructora_id: ctx.constructoraId,
      contrato_obra_id: contratoId,
      certificado_id: certificadoId ?? null,
      fecha,
      fecha_vencimiento: fecha,
      monto,
      moneda,
      notas: texto(input.notas) ?? null,
      estado: 'Pendiente',
    })
    .select('id, numero, monto, moneda')
    .single()
  if (error || !nuevo) return { error: `No se pudo crear el cobro: ${error?.message ?? 'error desconocido'}` }

  return { creado: true, id: nuevo.id, numero: nuevo.numero, monto: nuevo.monto, moneda: nuevo.moneda }
}

interface FilaCobroPendiente {
  id: string
  numero: number | null
  monto: number
  moneda: string
  fecha_vencimiento: string | null
  obras: { nombre: string } | null
  certificados_avance: { numero: number; periodo: string } | null
}

async function ejecutarListarCobrosPendientes(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  let query = supabase
    .from('cobros_proyecto')
    .select('id, numero, monto, moneda, fecha_vencimiento, obras(nombre), certificados_avance(numero, periodo)')
    .eq('constructora_id', ctx.constructoraId)
    .eq('estado', 'Pendiente')
    .order('fecha_vencimiento', { ascending: true })
    .limit(30)

  const obraId = texto(input.obraId)
  if (obraId) query = query.eq('obra_id', obraId)
  const contratoId = texto(input.contratoId)
  if (contratoId) query = query.eq('contrato_obra_id', contratoId)

  const { data, error } = await query
  if (error) return { error: 'No se pudo obtener los cobros pendientes.' }
  const filas = (data ?? []) as unknown as FilaCobroPendiente[]
  return {
    cobros: filas.map(c => ({
      id: c.id,
      numero: c.numero,
      monto: c.monto,
      moneda: c.moneda,
      fecha_vencimiento: c.fecha_vencimiento,
      proyecto: c.obras?.nombre ?? null,
      certificado: c.certificados_avance ? `N°${c.certificados_avance.numero} (${c.certificados_avance.periodo})` : null,
    })),
    // Total ya calculado por moneda — nunca sumar los montos de arriba a
    // mano en la respuesta, usar este campo tal cual.
    totales_por_moneda: totalesPorMoneda(filas),
  }
}

interface CobroParaPago { id: string; obra_id: string; moneda: string; estado: string; monto: number }

async function obtenerCobroParaPago(supabase: SupabaseClient, cobroId: string): Promise<CobroParaPago | null> {
  const { data } = await supabase.from('cobros_proyecto').select('id, obra_id, moneda, estado, monto').eq('id', cobroId).maybeSingle()
  return data as CobroParaPago | null
}

// Mismo criterio que cuentasValidasParaGasto — un cobro de un proyecto en
// modo "específicas" solo entra a SUS cuentas, nunca al pool ni a las de
// otro proyecto.
async function cuentasValidasParaCobro(supabase: SupabaseClient, constructoraId: string, cobro: CobroParaPago) {
  const { data: obra } = await supabase.from('obras').select('modo_cuentas').eq('id', cobro.obra_id).maybeSingle()
  const modo = (obra?.modo_cuentas as 'empresa' | 'especificas' | null) ?? 'empresa'
  return obtenerCuentasPropias(supabase, constructoraId, cobro.obra_id, modo, cobro.moneda)
}

async function ejecutarListarCuentasDisponiblesCobro(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  const cobroId = texto(input.cobroId)
  if (!cobroId) return { error: 'Falta indicar de qué cobro — usá listar_cobros_pendientes primero.' }
  const cobro = await obtenerCobroParaPago(supabase, cobroId)
  if (!cobro) return { error: 'No se encontró ese cobro, o este usuario no tiene acceso.' }
  const cuentas = await cuentasValidasParaCobro(supabase, ctx.constructoraId, cobro)
  return { cuentas: cuentas.map(c => ({ id: c.id, nombre: c.nombre, moneda: c.moneda })) }
}

async function ejecutarMarcarCobroCobrado(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  const cobroId = texto(input.cobro_id)
  const cuentaId = texto(input.cuenta_propia_id)
  if (!cobroId) return { error: 'Falta indicar el cobro.' }
  if (!cuentaId) return { error: 'Falta indicar la cuenta.' }

  const cobro = await obtenerCobroParaPago(supabase, cobroId)
  if (!cobro) return { error: 'No se encontró ese cobro, o este usuario no tiene acceso.' }
  if (cobro.estado === 'Cobrado') return { error: 'Ese cobro ya está marcado como cobrado.' }

  const cuentas = await cuentasValidasParaCobro(supabase, ctx.constructoraId, cobro)
  if (!cuentas.some(c => c.id === cuentaId)) {
    return { error: 'Esa cuenta no es válida para este cobro — volvé a llamar a listar_cuentas_disponibles_cobro.' }
  }

  const { error } = await supabase
    .from('cobros_proyecto')
    .update({
      estado: 'Cobrado',
      fecha_pago: texto(input.fecha_pago) ?? new Date().toISOString().slice(0, 10),
      cuenta_propia_id: cuentaId,
    })
    .eq('id', cobroId)
  if (error) return { error: 'No se pudo registrar el cobro.' }

  return { cobrado: true, id: cobro.id, monto: cobro.monto, moneda: cobro.moneda }
}

// Reusa el mismo consolidado que ya alimenta la pantalla de Ingresos
// (cuotas de venta + cobros de obra, normalizados en una sola forma) en vez
// de reimplementar el cruce acá — así el chat nunca puede quedar
// desincronizado de lo que el usuario ve en esa pantalla. Lo pendiente
// siempre viene completo sin importar la ventana de 12 meses (ver el
// comentario de obtenerIngresos), por eso no hace falta exponer ese
// parámetro acá.
interface FilaCobroConCertificado {
  id: string
  certificado_id: string | null
  certificados_avance: { numero: number; periodo: string } | null
}

// obtenerIngresos() (lib/ingresos.ts) no distingue si un cobro_proyecto
// viene de un certificado o es un cobro suelto (anticipo/seña sin
// certificado, ver ejecutarCrearCobro) — rotular todo como "certificado"
// sería falso. Se resuelve acá con una consulta aparte en vez de asumir.
async function ejecutarListarPendientesCobro(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  const todos = await obtenerIngresos(supabase, ctx.constructoraId, true)
  const obraId = texto(input.obraId)
  const pendientesCompletos = todos
    .filter(i => !i.pagado)
    .filter(i => !obraId || i.obraId === obraId)
  // Los totales salen de la lista COMPLETA, no de los primeros 40 que se
  // muestran — así el total nunca queda corto por el recorte de abajo.
  const totalesPorMonedaCalculado = totalesPorMoneda(pendientesCompletos)
  const pendientes = pendientesCompletos.slice(0, 40)

  // Un cobro con plan de pago (cuotas/cheques) llega acá como "<id real>-cuota-N"
  // — se despoja el sufijo para consultar el cobro real, el certificado del
  // que depende (si tiene uno) es el mismo para todas sus cuotas.
  const idsCobroReal = [...new Set(
    pendientes.filter(i => i.origen === 'cobro_proyecto').map(i => i.id.split('-cuota-')[0])
  )]

  const certificadoPorCobro: Record<string, { numero: number; periodo: string } | null> = {}
  if (idsCobroReal.length > 0) {
    const { data } = await supabase
      .from('cobros_proyecto')
      .select('id, certificado_id, certificados_avance(numero, periodo)')
      .in('id', idsCobroReal)
    for (const row of (data ?? []) as unknown as FilaCobroConCertificado[]) {
      certificadoPorCobro[row.id] = row.certificado_id ? row.certificados_avance : null
    }
  }

  return {
    pendientes: pendientes.map(i => {
      const esCobroObra = i.origen === 'cobro_proyecto'
      const cert = esCobroObra ? certificadoPorCobro[i.id.split('-cuota-')[0]] : undefined
      return {
        origen: esCobroObra ? 'cobro_obra' : 'cuota_venta',
        certificado: cert ? `N°${cert.numero} (${cert.periodo})` : (esCobroObra ? 'sin certificado (anticipo/seña/cobro suelto)' : null),
        proyecto: i.obraNombre,
        cliente: i.clienteNombre,
        descripcion: i.descripcion,
        monto: i.monto,
        moneda: i.moneda,
        fecha_vencimiento: i.fechaVencimiento,
      }
    }),
    // Total de plata ya calculado por moneda sobre TODOS los pendientes
    // (no solo los que se listan arriba) — nunca sumar los montos
    // individuales a mano en la respuesta, usar este campo tal cual.
    totales_por_moneda: totalesPorMonedaCalculado,
    cantidad_items_listados: pendientes.length,
    cantidad_items_total: pendientesCompletos.length,
  }
}

// Reusa calcularCajaEmpresa/calcularCajaProyecto de lib/tesoreria.ts — la
// misma lógica que arma /admin/tesoreria y la Caja de cada proyecto, para
// que el chat nunca pueda dar un número de caja distinto al que el usuario
// ve en esas pantallas.
async function ejecutarConsultarCashflow(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'tesoreria', null)) {
    return { error: 'Este usuario no tiene el módulo Caja habilitado.' }
  }

  const obraId = texto(input.obraId)

  if (!obraId) {
    const cuentas = await calcularCajaEmpresa(supabase, ctx.constructoraId)
    const totalesPorMoneda: Record<string, { ingresos: number; egresos: number; saldo_actual: number }> = {}
    for (const c of cuentas) {
      const t = totalesPorMoneda[c.moneda] ?? { ingresos: 0, egresos: 0, saldo_actual: 0 }
      t.ingresos = redondear2(t.ingresos + c.ingresos_ventas)
      t.egresos = redondear2(t.egresos + c.egresos_gastos)
      t.saldo_actual = redondear2(t.saldo_actual + c.saldo_actual)
      totalesPorMoneda[c.moneda] = t
    }
    return {
      alcance: 'empresa',
      cuentas: cuentas.map(c => ({
        nombre: c.nombre,
        tipo: c.tipo,
        moneda: c.moneda,
        proyecto: c.obra_nombre ?? 'Pool de empresa',
        ingresos: c.ingresos_ventas,
        egresos: c.egresos_gastos,
        saldo_actual: c.saldo_actual,
      })),
      totales_por_moneda: totalesPorMoneda,
    }
  }

  const { data: obra } = await supabase.from('obras').select('id, nombre, tipo, modo_cuentas').eq('id', obraId).maybeSingle()
  if (!obra) return { error: 'No se encontró ese proyecto, o este usuario no tiene acceso.' }

  const caja = await calcularCajaProyecto(supabase, {
    constructoraId: ctx.constructoraId,
    obraId: obra.id,
    obraTipo: obra.tipo,
    obraModo: (obra.modo_cuentas ?? 'empresa') as 'empresa' | 'especificas',
  })

  return {
    alcance: 'proyecto',
    proyecto: obra.nombre,
    cuentas: caja.cuentasConSaldo,
    totales_por_moneda: caja.totalesPorMoneda,
  }
}

interface FilaResumenUnidades { obra_id: string; total: number; vendidas: number; reservadas: number; disponibles: number }

// Reusa la RPC resumen_unidades_por_obra() (ya la usa el dashboard de
// /admin) en vez de traer todas las unidades y contarlas acá — mismo
// criterio en todo lib/chat/ejecutores.ts: nunca reimplementar un cálculo
// que ya existe en el backend real.
async function ejecutarConsultarUnidades(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  const obraId = texto(input.obraId)

  if (obraId) {
    const { data: obra } = await supabase.from('obras').select('id, nombre, tipo').eq('id', obraId).maybeSingle()
    if (!obra) return { error: 'No se encontró ese proyecto, o este usuario no tiene acceso.' }
    if (obra.tipo !== 'desarrollo') {
      return { error: `"${obra.nombre}" es un proyecto tipo obra — no tiene unidades a la venta, esto solo aplica a proyectos tipo desarrollo.` }
    }
    if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'unidades', obraId)) {
      return { error: `Este usuario no tiene el módulo Unidades habilitado en el proyecto "${obra.nombre}".` }
    }
    const { data, error } = await supabase.rpc('resumen_unidades_por_obra', { p_obra_ids: [obraId] })
    if (error) return { error: 'No se pudo obtener el resumen de unidades.' }
    const fila = (data as FilaResumenUnidades[] | null)?.[0]
    return {
      proyectos: [{
        proyecto: obra.nombre,
        total: fila?.total ?? 0,
        vendidas: fila?.vendidas ?? 0,
        reservadas: fila?.reservadas ?? 0,
        disponibles: fila?.disponibles ?? 0,
      }],
    }
  }

  const { data: obras } = await supabase
    .from('obras')
    .select('id, nombre')
    .eq('constructora_id', ctx.constructoraId)
    .eq('tipo', 'desarrollo')
    .order('nombre')
  if (!obras || obras.length === 0) return { proyectos: [], mensaje: 'No hay proyectos tipo desarrollo.' }

  const { data, error } = await supabase.rpc('resumen_unidades_por_obra', { p_obra_ids: obras.map(o => o.id) })
  if (error) return { error: 'No se pudo obtener el resumen de unidades.' }
  const porObra = new Map(((data ?? []) as FilaResumenUnidades[]).map(f => [f.obra_id, f]))

  return {
    proyectos: obras.map(o => {
      const fila = porObra.get(o.id)
      return {
        proyecto: o.nombre,
        total: fila?.total ?? 0,
        vendidas: fila?.vendidas ?? 0,
        reservadas: fila?.reservadas ?? 0,
        disponibles: fila?.disponibles ?? 0,
      }
    }),
  }
}

interface FilaResumenGasto { categoria_id: string | null; categoria_nombre: string; moneda: string; monto_total: number; cantidad: number }

// Misma razón que consultar_unidades: RPC nueva (resumen_gastos_por_categoria,
// migration_071.sql) en vez de traer todos los gastos y agruparlos acá —
// evita el límite de PostgREST en tenants con historial largo.
async function ejecutarResumenGastos(ctx: ContextoChat, supabase: SupabaseClient, input: Record<string, unknown>) {
  const obraId = texto(input.obraId) ?? null
  const desde = texto(input.desde) ?? null
  const hasta = texto(input.hasta) ?? null
  const soloPendientes = input.soloPendientes === true

  const { data, error } = await supabase.rpc('resumen_gastos_por_categoria', {
    p_constructora_id: ctx.constructoraId,
    p_obra_id: obraId,
    p_desde: desde,
    p_hasta: hasta,
    p_solo_pendientes: soloPendientes,
  })
  if (error) return { error: 'No se pudo obtener el resumen de gastos.' }

  return {
    categorias: ((data ?? []) as FilaResumenGasto[]).map(f => ({
      categoria: f.categoria_nombre,
      moneda: f.moneda,
      monto_total: f.monto_total,
      cantidad_gastos: f.cantidad,
    })),
  }
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
    case 'consultar_modulo': return ejecutarConsultarModulo(input)
    case 'navegar_a': return ejecutarNavegarA(ctx, input)
    case 'listar_proyectos': return ejecutarListarProyectos(ctx, supabase)
    case 'navegar_a_proyecto': return ejecutarNavegarAProyecto(ctx, supabase, input)
    case 'crear_proveedor': return ejecutarCrearProveedor(ctx, supabase, input)
    case 'crear_cliente': return ejecutarCrearCliente(ctx, supabase, input)
    case 'crear_cuenta_propia': return ejecutarCrearCuentaPropia(ctx, supabase, input)
    case 'crear_categoria_gasto': return ejecutarCrearCategoriaGasto(ctx, supabase, input)
    case 'crear_personal': return ejecutarCrearPersonal(ctx, supabase, input)
    case 'crear_cuadrilla': return ejecutarCrearCuadrilla(ctx, supabase, input)
    case 'listar_proveedores': return ejecutarListarProveedores(ctx, supabase, input)
    case 'listar_categorias_gasto': return ejecutarListarCategoriasGasto(ctx, supabase)
    case 'crear_gasto': return ejecutarCrearGasto(ctx, supabase, input)
    case 'listar_cuentas_proveedor': return ejecutarListarCuentasProveedor(supabase, input)
    case 'listar_certificados_pago_proveedor': return ejecutarListarCertificadosPagoProveedor(supabase, input)
    case 'crear_orden_compra': return ejecutarCrearOrdenCompra(ctx, supabase, input)
    case 'listar_contratos_obra': return ejecutarListarContratosObra(supabase, input)
    case 'consultar_rubros_contrato': return ejecutarConsultarRubrosContrato(supabase, input)
    case 'crear_certificado_avance': return ejecutarCrearCertificadoAvance(ctx, supabase, input)
    case 'listar_gastos_pendientes': return ejecutarListarGastosPendientes(ctx, supabase, input)
    case 'listar_cuentas_disponibles_gasto': return ejecutarListarCuentasDisponiblesGasto(ctx, supabase, input)
    case 'marcar_gasto_pagado': return ejecutarMarcarGastoPagado(ctx, supabase, input)
    case 'listar_certificados_contrato': return ejecutarListarCertificadosContrato(supabase, input)
    case 'crear_cobro': return ejecutarCrearCobro(ctx, supabase, input)
    case 'listar_cobros_pendientes': return ejecutarListarCobrosPendientes(ctx, supabase, input)
    case 'listar_cuentas_disponibles_cobro': return ejecutarListarCuentasDisponiblesCobro(ctx, supabase, input)
    case 'marcar_cobro_cobrado': return ejecutarMarcarCobroCobrado(ctx, supabase, input)
    case 'listar_pendientes_cobro': return ejecutarListarPendientesCobro(ctx, supabase, input)
    case 'consultar_cashflow': return ejecutarConsultarCashflow(ctx, supabase, input)
    case 'consultar_unidades': return ejecutarConsultarUnidades(ctx, supabase, input)
    case 'resumen_gastos': return ejecutarResumenGastos(ctx, supabase, input)
  }
}
