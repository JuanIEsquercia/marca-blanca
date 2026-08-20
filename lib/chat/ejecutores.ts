import type { SupabaseClient } from '@supabase/supabase-js'
import { redondear2 } from '@/lib/utils'
import { puedeAcceder } from '@/lib/permisos'
import { crearProveedorRapido } from '@/lib/proveedores'
import { crearCompradorRapido } from '@/lib/compradores'
import { crearCuentaPropiaRapida } from '@/lib/cuentasPropias'
import { crearCategoriaCostoRapida } from '@/lib/categoriasCosto'
import { crearPersonalRapido, crearCuadrillaRapida } from '@/lib/personal'
import { crearGastoRapido } from '@/lib/gastos'
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

async function ejecutarListarProveedores(ctx: ContextoChat, supabase: SupabaseClient) {
  // Misma lógica que ejecutarListarProyectos: la RLS de `proveedores` ya
  // devuelve vacío si este usuario no tiene el módulo — no hace falta
  // duplicar el chequeo acá.
  const { data, error } = await supabase
    .from('proveedores')
    .select('id, razon_social')
    .eq('constructora_id', ctx.constructoraId)
    .order('razon_social')
  if (error) return { error: 'No se pudo obtener la lista de proveedores.' }
  return { proveedores: (data ?? []).map(p => ({ id: p.id, razon_social: p.razon_social })) }
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

  const obraId = texto(input.obra_id) ?? null
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
    proveedorId: texto(input.proveedor_id),
    categoriaId: texto(input.categoria_id),
    fechaVencimiento: texto(input.fecha_vencimiento),
    notas: texto(input.notas),
  })
  if (!nuevo) return { error: 'No se pudo crear el gasto.' }
  return { creado: true, id: nuevo.id, descripcion: nuevo.descripcion, monto: nuevo.monto, moneda: nuevo.moneda }
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
    case 'listar_proveedores': return ejecutarListarProveedores(ctx, supabase)
    case 'listar_categorias_gasto': return ejecutarListarCategoriasGasto(ctx, supabase)
    case 'crear_gasto': return ejecutarCrearGasto(ctx, supabase, input)
    case 'crear_orden_compra': return ejecutarCrearOrdenCompra(ctx, supabase, input)
    case 'listar_contratos_obra': return ejecutarListarContratosObra(supabase, input)
    case 'consultar_rubros_contrato': return ejecutarConsultarRubrosContrato(supabase, input)
    case 'crear_certificado_avance': return ejecutarCrearCertificadoAvance(ctx, supabase, input)
  }
}
