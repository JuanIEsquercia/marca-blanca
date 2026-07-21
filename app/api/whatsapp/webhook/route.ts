import { NextResponse } from 'next/server'
import { verificarFirmaWebhook, enviarMensajeWhatsapp, enviarListaWhatsapp, enviarBotonesWhatsapp } from '@/lib/kapso'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  resolverConstructoraPorNumero, resolverPerfilPorTelefono, obtenerAccesoCaja,
  type WhatsappPerfil,
} from '@/lib/whatsapp-tenant'
import { calcularCajaEmpresa, calcularCajaProyecto, formatearMonto } from '@/lib/tesoreria'
import { obtenerBorrador, guardarBorrador, limpiarBorrador, reclamarBorrador } from '@/lib/whatsapp-borrador'
import { obtenerCategorias, obtenerAccesoGastos, obtenerCuentasParaGasto, registrarGasto } from '@/lib/whatsapp-gastos'
import { obtenerAccesoCobros, obtenerCuentasParaCobro, registrarCobro } from '@/lib/whatsapp-cobros'

export const runtime = 'nodejs'

const REGEX_VINCULAR = /^vincular\s+(\d{6})$/i
const MONTO_MAXIMO = 1_000_000_000 // 1.000 millones — tope de sanidad ante un typo, no un límite de negocio

interface Entrada {
  texto: string | null
  listReplyId: string | null
  buttonReplyId: string | null
}

// Convención AR (igual que el resto de la app, Intl.NumberFormat('es-AR')):
// la coma es el separador decimal, el punto se ignora siempre (separador de
// miles o error de tipeo) — "7.569.659" -> 7569659, "1000222,55" -> 1000222.55.
// Redondea a 2 decimales máximo.
function parsearMonto(texto: string): number {
  const limpio = texto.replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.')
  if (!limpio) return NaN
  const monto = parseFloat(limpio)
  return isNaN(monto) ? NaN : Math.round(monto * 100) / 100
}

async function intentarVincular(phoneNumberId: string, from: string, codigo: string): Promise<string> {
  const admin = createAdminClient()

  // El número<->constructora se configura SOLO por el superadmin de la
  // plataforma (ver PATCH /api/superadmin/constructoras) — sistema
  // white-label donde el tenant ni sabe ni debería tocar su phone_number_id
  // de Kapso. Acá nunca se crea ni se reasigna. Si el número que recibió el
  // mensaje no está configurado, no hay forma de saber a qué constructora
  // pertenece el código, así que se rechaza. Esto evita que un código
  // robado/adivinado se redima en un número ajeno (incluso el público de la
  // propia constructora atacada) y secuestre la cuenta — ver auditoría 2026-07-13.
  const { data: numero } = await admin
    .from('whatsapp_numeros')
    .select('constructora_id')
    .eq('kapso_phone_id', phoneNumberId)
    .eq('activo', true)
    .maybeSingle()

  if (!numero) {
    return 'Este número todavía no está configurado en el panel. Pedile al admin que lo configure en WhatsApp antes de vincular un teléfono.'
  }

  const { data: vinculo } = await admin
    .from('whatsapp_vinculos_pendientes')
    .select('id, constructora_id, perfil_id, expira_en, usado_en')
    .eq('codigo', codigo)
    .is('usado_en', null)
    .maybeSingle()

  if (!vinculo || new Date(vinculo.expira_en) < new Date()) {
    return 'Ese código no es válido o venció. Generá uno nuevo desde el panel.'
  }

  if (vinculo.constructora_id !== numero.constructora_id) {
    return 'Ese código no corresponde a este número de WhatsApp.'
  }

  const { error: telefonoError } = await admin
    .from('perfiles')
    .update({ telefono: from })
    .eq('id', vinculo.perfil_id)

  if (telefonoError) {
    return 'Ese teléfono ya está vinculado a otra constructora. Desvinculalo primero.'
  }

  await admin
    .from('whatsapp_vinculos_pendientes')
    .update({ usado_en: new Date().toISOString() })
    .eq('id', vinculo.id)

  return '✅ Tu WhatsApp quedó vinculado. Ya podés hacer consultas por acá.'
}

// Menú de acciones — cada fila nueva (cobro, venta) se agrega acá.
async function enviarMenuAcciones(phoneNumberId: string, to: string) {
  await enviarListaWhatsapp({
    phoneNumberId,
    to,
    texto: '¿Qué querés hacer?',
    tituloBoton: 'Ver opciones',
    filas: [
      { id: 'accion_consultar_caja', title: 'Consultar caja', description: 'Saldo general o por proyecto' },
      { id: 'accion_registrar_gasto', title: 'Registrar gasto', description: 'Monto, descripción, categoría y proyecto' },
      { id: 'accion_registrar_cobro', title: 'Cobro de obra', description: 'Monto y cuenta para un proyecto de obra' },
    ],
  })
}

// ---------- Consultar caja (stateless — sin borrador) ----------

async function manejarAccionConsultarCaja(constructoraId: string, perfil: WhatsappPerfil, phoneNumberId: string, to: string) {
  const acceso = await obtenerAccesoCaja(constructoraId, perfil)

  if (!acceso.general && acceso.proyectos.length === 0) {
    await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'No tenés acceso al módulo de Caja.' })
    return
  }

  const filas = [
    ...(acceso.general ? [{ id: 'alcance_general', title: 'Caja general', description: 'Consolidado de la empresa' }] : []),
    ...acceso.proyectos.map(p => ({ id: `alcance_proyecto:${p.obraId}`, title: p.nombre.slice(0, 24) })),
  ]

  await enviarListaWhatsapp({ phoneNumberId, to, texto: '¿Caja de qué querés ver?', tituloBoton: 'Elegir', filas })
}

async function responderCajaGeneral(constructoraId: string): Promise<string> {
  const admin = createAdminClient()
  const cuentas = await calcularCajaEmpresa(admin, constructoraId)
  if (cuentas.length === 0) return 'No hay cuentas cargadas a nivel empresa.'
  const lineas = cuentas.map(c => `• ${c.nombre} (${c.moneda}): ${formatearMonto(c.saldo_actual, c.moneda)}`)
  return `💰 *Caja general*\n${lineas.join('\n')}`
}

async function responderCajaProyecto(constructoraId: string, perfil: WhatsappPerfil, obraId: string): Promise<string> {
  const acceso = await obtenerAccesoCaja(constructoraId, perfil)
  const proyecto = acceso.proyectos.find(p => p.obraId === obraId)
  if (!proyecto) return 'No tenés acceso a ese proyecto.'

  const admin = createAdminClient()
  const { cuentasConSaldo, totalesPorMoneda } = await calcularCajaProyecto(admin, {
    constructoraId, obraId, obraTipo: proyecto.tipo, obraModo: proyecto.modoCuentas,
  })

  const lineas = cuentasConSaldo.map(c => `• ${c.nombre} (${c.moneda}): ${formatearMonto(c.saldo_actual, c.moneda)}`)
  const totalesLineas = Object.entries(totalesPorMoneda).flatMap(([moneda, t]) => [
    `Ingresos ${moneda}: ${formatearMonto(t.ingresos, moneda)}`,
    `Egresos pagados ${moneda}: ${formatearMonto(t.egresosPagados, moneda)}`,
    t.egresosPendientes > 0 ? `Pendiente ${moneda}: ${formatearMonto(t.egresosPendientes, moneda)}` : null,
  ]).filter((l): l is string => l !== null)

  const resumen = [
    `💰 *Caja de ${proyecto.nombre}*`,
    ...totalesLineas,
    ...(lineas.length > 0 ? ['', ...lineas] : []),
  ]

  return resumen.join('\n')
}

// ---------- Registrar gasto (con estado — whatsapp_borradores) ----------

async function iniciarBorradorGasto(constructoraId: string, perfil: WhatsappPerfil, phoneNumberId: string, to: string) {
  const acceso = await obtenerAccesoGastos(constructoraId, perfil)
  if (!acceso.general && acceso.proyectos.length === 0) {
    await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'No tenés ningún proyecto con permiso para cargar gastos.' })
    return
  }
  await guardarBorrador(perfil.perfilId, constructoraId, 'gasto', 'monto', {})
  await enviarMensajeWhatsapp({ phoneNumberId, to, body: '¿Cuál es el monto del gasto? Escribí el número entero sin puntos; si tiene decimales usá coma, ej: 1000222,55\n\nEscribí "cancelar" en cualquier momento para salir.' })
}

async function manejarBorradorGasto(
  constructoraId: string, perfil: WhatsappPerfil, phoneNumberId: string, to: string,
  paso: string, datos: Record<string, unknown>, entrada: Entrada
) {
  if (entrada.texto?.trim().toLowerCase() === 'cancelar') {
    await limpiarBorrador(perfil.perfilId)
    await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Cancelado.' })
    return
  }

  if (paso === 'monto') {
    const monto = entrada.texto ? parsearMonto(entrada.texto) : NaN
    if (!entrada.texto || isNaN(monto) || monto <= 0) {
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Mandame el monto en números, ej: 1000222,55' })
      return
    }
    if (monto > MONTO_MAXIMO) {
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: `Ese monto (${formatearMonto(monto, 'ARS')}) parece demasiado alto — ¿te confundiste con los puntos? Escribilo de nuevo.` })
      return
    }
    await guardarBorrador(perfil.perfilId, constructoraId, 'gasto', 'moneda', { ...datos, monto })
    await enviarBotonesWhatsapp({
      phoneNumberId, to, texto: '¿En qué moneda?',
      botones: [{ id: 'moneda_ars', title: 'ARS' }, { id: 'moneda_usd', title: 'USD' }],
    })
    return
  }

  if (paso === 'moneda') {
    if (entrada.buttonReplyId !== 'moneda_ars' && entrada.buttonReplyId !== 'moneda_usd') {
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Tocá "ARS" o "USD" arriba.' })
      return
    }
    const moneda = entrada.buttonReplyId === 'moneda_usd' ? 'USD' : 'ARS'
    await guardarBorrador(perfil.perfilId, constructoraId, 'gasto', 'descripcion', { ...datos, moneda })
    await enviarMensajeWhatsapp({ phoneNumberId, to, body: '¿Descripción del gasto?' })
    return
  }

  if (paso === 'descripcion') {
    if (!entrada.texto?.trim()) {
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Mandame una descripción breve del gasto.' })
      return
    }
    const categorias = await obtenerCategorias(constructoraId)
    await guardarBorrador(perfil.perfilId, constructoraId, 'gasto', 'categoria', { ...datos, descripcion: entrada.texto.trim() })

    if (categorias.length === 0) {
      await avanzarAProyecto(constructoraId, perfil, phoneNumberId, to, { ...datos, descripcion: entrada.texto.trim(), categoriaId: null, categoriaNombre: null })
      return
    }
    await enviarListaWhatsapp({
      phoneNumberId, to, texto: '¿Categoría?', tituloBoton: 'Elegir',
      // Máx. 10 filas por sección (límite de WhatsApp) — se deja lugar para
      // "Sin categoría" recortando a las primeras 9. Si la constructora tiene
      // más, no aparecen todas por WhatsApp (sí en el panel web).
      filas: [
        ...categorias.slice(0, 9).map(c => ({ id: `gasto_categoria:${c.id}`, title: c.nombre.slice(0, 24) })),
        { id: 'gasto_categoria_ninguna', title: 'Sin categoría' },
      ],
    })
    return
  }

  if (paso === 'categoria') {
    if (!entrada.listReplyId?.startsWith('gasto_categoria')) {
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Elegí una categoría de la lista de arriba.' })
      return
    }
    if (entrada.listReplyId === 'gasto_categoria_ninguna') {
      await avanzarAProyecto(constructoraId, perfil, phoneNumberId, to, { ...datos, categoriaId: null, categoriaNombre: null })
      return
    }
    const categoriaId = entrada.listReplyId.slice('gasto_categoria:'.length)
    const categorias = await obtenerCategorias(constructoraId)
    const categoria = categorias.find(c => c.id === categoriaId)
    await avanzarAProyecto(constructoraId, perfil, phoneNumberId, to, { ...datos, categoriaId: categoria?.id ?? null, categoriaNombre: categoria?.nombre ?? null })
    return
  }

  if (paso === 'proyecto') {
    if (!entrada.listReplyId?.startsWith('gasto_proyecto')) {
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Elegí un proyecto de la lista de arriba.' })
      return
    }
    const acceso = await obtenerAccesoGastos(constructoraId, perfil)
    let obraId: string | null = null
    let obraNombre: string | null = null
    let modoCuentas: 'empresa' | 'especificas' = 'empresa'
    if (entrada.listReplyId !== 'gasto_proyecto_empresa') {
      obraId = entrada.listReplyId.slice('gasto_proyecto:'.length)
      const proyecto = acceso.proyectos.find(p => p.obraId === obraId)
      if (!proyecto) {
        await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'No tenés acceso a ese proyecto.' })
        return
      }
      obraNombre = proyecto.nombre
      modoCuentas = proyecto.modoCuentas
    }

    const cuentas = await obtenerCuentasParaGasto(constructoraId, obraId, modoCuentas, datos.moneda as string | undefined)
    if (cuentas.length === 0) {
      await limpiarBorrador(perfil.perfilId)
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: `No hay cuentas en ${datos.moneda ?? 'esa moneda'} cargadas para ese proyecto. Creá una desde el panel y volvé a intentar.` })
      return
    }

    const datosFinales: Record<string, unknown> = { ...datos, obraId, obraNombre }
    await guardarBorrador(perfil.perfilId, constructoraId, 'gasto', 'cuenta', datosFinales)
    await enviarListaWhatsapp({
      phoneNumberId, to, texto: '¿Con qué cuenta se pagó?', tituloBoton: 'Elegir',
      filas: cuentas.map(c => ({ id: `gasto_cuenta:${c.id}`, title: c.nombre.slice(0, 24), description: c.moneda })),
    })
    return
  }

  if (paso === 'cuenta') {
    if (!entrada.listReplyId?.startsWith('gasto_cuenta:')) {
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Elegí una cuenta de la lista de arriba.' })
      return
    }
    const cuentaPropiaId = entrada.listReplyId.slice('gasto_cuenta:'.length)
    const admin = createAdminClient()
    const { data: cuenta } = await admin.from('cuentas_propias').select('id, nombre').eq('id', cuentaPropiaId).eq('constructora_id', constructoraId).maybeSingle()
    if (!cuenta) {
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Cuenta inválida, elegí otra vez.' })
      return
    }

    const datosFinales: Record<string, unknown> = { ...datos, cuentaPropiaId: cuenta.id, cuentaPropiaNombre: cuenta.nombre }
    await guardarBorrador(perfil.perfilId, constructoraId, 'gasto', 'confirmar', datosFinales)

    const resumen = [
      '📝 *Confirmá el gasto (queda como Pagado)*',
      `Monto: ${formatearMonto(datosFinales.monto as number, datosFinales.moneda as string)}`,
      `Descripción: ${datosFinales.descripcion}`,
      `Categoría: ${datosFinales.categoriaNombre ?? 'Sin categoría'}`,
      `Proyecto: ${datosFinales.obraNombre ?? 'Gasto de empresa'}`,
      `Cuenta: ${cuenta.nombre}`,
    ].join('\n')

    await enviarBotonesWhatsapp({
      phoneNumberId, to, texto: resumen,
      botones: [{ id: 'gasto_confirmar', title: 'Confirmar' }, { id: 'gasto_cancelar', title: 'Cancelar' }],
    })
    return
  }

  if (paso === 'confirmar') {
    if (entrada.buttonReplyId === 'gasto_cancelar') {
      await limpiarBorrador(perfil.perfilId)
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Cancelado.' })
      return
    }
    if (entrada.buttonReplyId === 'gasto_confirmar') {
      // Reclamo atómico: si un retry de Kapso o un doble tap ya se adelantó
      // y se llevó la fila, esto devuelve null y no duplicamos el gasto.
      const reclamado = await reclamarBorrador(perfil.perfilId, 'confirmar')
      if (!reclamado) {
        await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Ese gasto ya se procesó (o expiró). Para cargar otro, escribí *gasto*.' })
        return
      }
      const d = reclamado.datos
      try {
        await registrarGasto(constructoraId, perfil.perfilId, {
          monto: d.monto as number,
          moneda: (d.moneda as 'ARS' | 'USD') ?? 'ARS',
          descripcion: d.descripcion as string,
          categoriaId: (d.categoriaId as string | null) ?? null,
          categoriaNombre: (d.categoriaNombre as string | null) ?? null,
          obraId: (d.obraId as string | null) ?? null,
          obraNombre: (d.obraNombre as string | null) ?? null,
          cuentaPropiaId: d.cuentaPropiaId as string,
          cuentaPropiaNombre: d.cuentaPropiaNombre as string,
        })
        await enviarMensajeWhatsapp({ phoneNumberId, to, body: '✅ Gasto registrado y marcado como pagado.' })
      } catch (err) {
        console.error('registrarGasto:', err)
        await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'No se pudo registrar el gasto. Iniciá de nuevo con *gasto*.' })
      }
      return
    }
    await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Tocá "Confirmar" o "Cancelar" arriba.' })
  }
}

async function avanzarAProyecto(constructoraId: string, perfil: WhatsappPerfil, phoneNumberId: string, to: string, datos: Record<string, unknown>) {
  const acceso = await obtenerAccesoGastos(constructoraId, perfil)
  await guardarBorrador(perfil.perfilId, constructoraId, 'gasto', 'proyecto', datos)

  const filas = [
    ...acceso.proyectos.map(p => ({ id: `gasto_proyecto:${p.obraId}`, title: p.nombre.slice(0, 24) })),
    ...(acceso.general ? [{ id: 'gasto_proyecto_empresa', title: 'Gasto de empresa' }] : []),
  ]
  await enviarListaWhatsapp({ phoneNumberId, to, texto: '¿A qué proyecto pertenece?', tituloBoton: 'Elegir', filas })
}

// ---------- Cobro de obra (con estado — whatsapp_borradores) ----------

async function iniciarBorradorCobro(constructoraId: string, perfil: WhatsappPerfil, phoneNumberId: string, to: string) {
  const proyectos = await obtenerAccesoCobros(constructoraId, perfil)
  if (proyectos.length === 0) {
    await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'No tenés ningún proyecto de obra con permiso para cobros.' })
    return
  }
  await guardarBorrador(perfil.perfilId, constructoraId, 'cobro', 'monto', {})
  await enviarMensajeWhatsapp({ phoneNumberId, to, body: '¿Cuál es el monto del cobro? Escribí el número entero sin puntos; si tiene decimales usá coma, ej: 1000222,55\n\nEscribí "cancelar" en cualquier momento para salir.' })
}

async function manejarBorradorCobro(
  constructoraId: string, perfil: WhatsappPerfil, phoneNumberId: string, to: string,
  paso: string, datos: Record<string, unknown>, entrada: Entrada
) {
  if (entrada.texto?.trim().toLowerCase() === 'cancelar') {
    await limpiarBorrador(perfil.perfilId)
    await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Cancelado.' })
    return
  }

  if (paso === 'monto') {
    const monto = entrada.texto ? parsearMonto(entrada.texto) : NaN
    if (!entrada.texto || isNaN(monto) || monto <= 0) {
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Mandame el monto en números, ej: 1000222,55' })
      return
    }
    if (monto > MONTO_MAXIMO) {
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: `Ese monto (${formatearMonto(monto, 'ARS')}) parece demasiado alto — ¿te confundiste con los puntos? Escribilo de nuevo.` })
      return
    }
    await guardarBorrador(perfil.perfilId, constructoraId, 'cobro', 'moneda', { ...datos, monto })
    await enviarBotonesWhatsapp({
      phoneNumberId, to, texto: '¿En qué moneda?',
      botones: [{ id: 'moneda_ars', title: 'ARS' }, { id: 'moneda_usd', title: 'USD' }],
    })
    return
  }

  if (paso === 'moneda') {
    if (entrada.buttonReplyId !== 'moneda_ars' && entrada.buttonReplyId !== 'moneda_usd') {
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Tocá "ARS" o "USD" arriba.' })
      return
    }
    const moneda = entrada.buttonReplyId === 'moneda_usd' ? 'USD' : 'ARS'
    const proyectos = await obtenerAccesoCobros(constructoraId, perfil)
    await guardarBorrador(perfil.perfilId, constructoraId, 'cobro', 'proyecto', { ...datos, moneda })
    await enviarListaWhatsapp({
      phoneNumberId, to, texto: '¿A qué proyecto de obra pertenece?', tituloBoton: 'Elegir',
      filas: proyectos.map(p => ({ id: `cobro_proyecto:${p.obraId}`, title: p.nombre.slice(0, 24) })),
    })
    return
  }

  if (paso === 'proyecto') {
    if (!entrada.listReplyId?.startsWith('cobro_proyecto:')) {
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Elegí un proyecto de la lista de arriba.' })
      return
    }
    const obraId = entrada.listReplyId.slice('cobro_proyecto:'.length)
    const proyectos = await obtenerAccesoCobros(constructoraId, perfil)
    const proyecto = proyectos.find(p => p.obraId === obraId)
    if (!proyecto) {
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'No tenés acceso a ese proyecto.' })
      return
    }

    const cuentas = await obtenerCuentasParaCobro(constructoraId, obraId, proyecto.modoCuentas, datos.moneda as string | undefined)
    if (cuentas.length === 0) {
      await limpiarBorrador(perfil.perfilId)
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: `No hay cuentas en ${datos.moneda ?? 'esa moneda'} cargadas para ese proyecto. Creá una desde el panel y volvé a intentar.` })
      return
    }

    const datosFinales: Record<string, unknown> = { ...datos, obraId, obraNombre: proyecto.nombre }
    await guardarBorrador(perfil.perfilId, constructoraId, 'cobro', 'cuenta', datosFinales)
    await enviarListaWhatsapp({
      phoneNumberId, to, texto: '¿A qué cuenta ingresó el cobro?', tituloBoton: 'Elegir',
      filas: cuentas.map(c => ({ id: `cobro_cuenta:${c.id}`, title: c.nombre.slice(0, 24), description: c.moneda })),
    })
    return
  }

  if (paso === 'cuenta') {
    if (!entrada.listReplyId?.startsWith('cobro_cuenta:')) {
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Elegí una cuenta de la lista de arriba.' })
      return
    }
    const cuentaPropiaId = entrada.listReplyId.slice('cobro_cuenta:'.length)
    const admin = createAdminClient()
    const { data: cuenta } = await admin.from('cuentas_propias').select('id, nombre').eq('id', cuentaPropiaId).eq('constructora_id', constructoraId).maybeSingle()
    if (!cuenta) {
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Cuenta inválida, elegí otra vez.' })
      return
    }

    const datosFinales: Record<string, unknown> = { ...datos, cuentaPropiaId: cuenta.id, cuentaPropiaNombre: cuenta.nombre }
    await guardarBorrador(perfil.perfilId, constructoraId, 'cobro', 'confirmar', datosFinales)

    const resumen = [
      '📝 *Confirmá el cobro*',
      `Monto: ${formatearMonto(datosFinales.monto as number, datosFinales.moneda as string)}`,
      `Proyecto: ${datosFinales.obraNombre}`,
      `Cuenta: ${cuenta.nombre}`,
    ].join('\n')

    await enviarBotonesWhatsapp({
      phoneNumberId, to, texto: resumen,
      botones: [{ id: 'cobro_confirmar', title: 'Confirmar' }, { id: 'cobro_cancelar', title: 'Cancelar' }],
    })
    return
  }

  if (paso === 'confirmar') {
    if (entrada.buttonReplyId === 'cobro_cancelar') {
      await limpiarBorrador(perfil.perfilId)
      await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Cancelado.' })
      return
    }
    if (entrada.buttonReplyId === 'cobro_confirmar') {
      // Reclamo atómico: mismo patrón que gasto_confirmar — evita duplicar
      // el cobro si llegan dos entregas del mismo evento casi juntas.
      const reclamado = await reclamarBorrador(perfil.perfilId, 'confirmar')
      if (!reclamado) {
        await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Ese cobro ya se procesó (o expiró). Para cargar otro, escribí *cobro*.' })
        return
      }
      const d = reclamado.datos
      try {
        await registrarCobro(constructoraId, perfil.perfilId, {
          monto: d.monto as number,
          moneda: (d.moneda as 'ARS' | 'USD') ?? 'ARS',
          obraId: d.obraId as string,
          obraNombre: d.obraNombre as string,
          cuentaPropiaId: d.cuentaPropiaId as string,
          cuentaPropiaNombre: d.cuentaPropiaNombre as string,
        })
        await enviarMensajeWhatsapp({ phoneNumberId, to, body: '✅ Cobro registrado.' })
      } catch (err) {
        console.error('registrarCobro:', err)
        await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'No se pudo registrar el cobro. Iniciá de nuevo con *cobro*.' })
      }
      return
    }
    await enviarMensajeWhatsapp({ phoneNumberId, to, body: 'Tocá "Confirmar" o "Cancelar" arriba.' })
  }
}

// ---------- Webhook ----------

export async function POST(request: Request) {
  const rawBody = await request.text()
  const firma = request.headers.get('x-webhook-signature')

  if (!verificarFirmaWebhook(rawBody, firma)) {
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 })
  }

  const evento = request.headers.get('x-webhook-event')
  const payload = JSON.parse(rawBody)

  if (evento !== 'whatsapp.message.received') {
    return NextResponse.json({ ok: true })
  }

  const phoneNumberId = payload.phone_number_id as string | undefined
  const from = payload.message?.from as string | undefined
  const messageId = payload.message?.id as string | undefined
  const texto = (payload.message?.text?.body as string | undefined) ?? null
  const interactive = payload.message?.interactive
  const listReplyId = interactive?.type === 'list_reply' ? (interactive.list_reply?.id as string | undefined) ?? null : null
  const buttonReplyId = interactive?.type === 'button_reply' ? (interactive.button_reply?.id as string | undefined) ?? null : null

  if (!phoneNumberId || !from) {
    return NextResponse.json({ ok: true })
  }

  const matchVincular = texto?.trim().match(REGEX_VINCULAR)

  if (matchVincular) {
    const respuesta = await intentarVincular(phoneNumberId, from, matchVincular[1])
    await enviarMensajeWhatsapp({ phoneNumberId, to: from, body: respuesta, replyToMessageId: messageId })
      .catch(err => console.error('Error enviando respuesta de WhatsApp:', err))
    return NextResponse.json({ ok: true })
  }

  const constructora = await resolverConstructoraPorNumero(phoneNumberId)
  if (!constructora) {
    await enviarMensajeWhatsapp({
      phoneNumberId, to: from,
      body: 'Este número todavía no está vinculado a ninguna constructora. Generá el código de vinculación desde el panel y escribime "VINCULAR 123456".',
    }).catch(err => console.error('Error enviando respuesta de WhatsApp:', err))
    return NextResponse.json({ ok: true })
  }

  const perfil = await resolverPerfilPorTelefono(constructora.id, from)
  if (!perfil) {
    await enviarMensajeWhatsapp({
      phoneNumberId, to: from, body: `Tu número no está autorizado para operar ${constructora.nombre} por WhatsApp.`,
    }).catch(err => console.error('Error enviando respuesta de WhatsApp:', err))
    return NextResponse.json({ ok: true })
  }

  const entrada: Entrada = { texto, listReplyId, buttonReplyId }

  try {
    const borrador = await obtenerBorrador(perfil.perfilId)

    if (borrador?.tipo === 'gasto') {
      await manejarBorradorGasto(constructora.id, perfil, phoneNumberId, from, borrador.paso, borrador.datos, entrada)
    } else if (borrador?.tipo === 'cobro') {
      await manejarBorradorCobro(constructora.id, perfil, phoneNumberId, from, borrador.paso, borrador.datos, entrada)
    } else if (listReplyId === 'accion_consultar_caja') {
      await manejarAccionConsultarCaja(constructora.id, perfil, phoneNumberId, from)
    } else if (listReplyId === 'accion_registrar_gasto') {
      await iniciarBorradorGasto(constructora.id, perfil, phoneNumberId, from)
    } else if (listReplyId === 'accion_registrar_cobro') {
      await iniciarBorradorCobro(constructora.id, perfil, phoneNumberId, from)
    } else if (listReplyId === 'alcance_general') {
      const respuesta = await responderCajaGeneral(constructora.id)
      await enviarMensajeWhatsapp({ phoneNumberId, to: from, body: respuesta })
    } else if (listReplyId?.startsWith('alcance_proyecto:')) {
      const obraId = listReplyId.slice('alcance_proyecto:'.length)
      const respuesta = await responderCajaProyecto(constructora.id, perfil, obraId)
      await enviarMensajeWhatsapp({ phoneNumberId, to: from, body: respuesta })
    } else {
      await enviarMenuAcciones(phoneNumberId, from)
    }
  } catch (err) {
    console.error('Error procesando mensaje de WhatsApp:', err)
  }

  return NextResponse.json({ ok: true })
}
