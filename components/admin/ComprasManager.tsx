'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency, formatDate, redondear2 } from '@/lib/utils'
import type { Producto, EstadoOrdenCompra, EstadoAcopio } from '@/types/database'
import ConfirmModal from './ConfirmModal'
import IvaCalculator from './IvaCalculator'
import ProveedorSelect from './ProveedorSelect'
import CategoriasCostoManager from './CategoriasCostoManager'

type ItemRow = {
  id: string
  producto_id: string
  cantidad_solicitada: number
  unidad_medida: string | null
  notas: string | null
  productos: { id: string; nombre: string; unidad_medida: string } | null
  orden_compra_recepcion_items: { cantidad_recibida: number }[]
}

type RecepcionItemRow = {
  id: string
  cantidad_recibida: number
  precio_unitario: number
  subtotal: number
  orden_compra_items: { producto_id: string; productos: { nombre: string; unidad_medida: string } | null } | null
}

type RecepcionRow = {
  id: string
  proveedor_id: string
  gasto_id: string | null
  fecha: string
  moneda: string
  notas: string | null
  proveedores: { razon_social: string } | null
  orden_compra_recepcion_items: RecepcionItemRow[]
}

type OrdenRow = {
  id: string
  numero: number
  obra_id: string | null
  estado: EstadoOrdenCompra
  fecha_emision: string
  notas: string | null
  obras: { nombre: string } | null
  orden_compra_items: ItemRow[]
  orden_compra_recepciones: RecepcionRow[]
}

interface ProductoConCategoria extends Producto {
  categorias_costo: { nombre: string; color: string } | null
}

interface StockResumenRow {
  producto_id: string
  obra_id: string | null
  cantidad: number
}

type AcopioRetiroRow = {
  id: string
  producto_id: string
  cantidad: number
  precio_unitario_retiro: number | null
  precio_unitario_referencia: number | null
  cantidad_referencia_descontada: number
  obra_id: string | null
  fecha: string
  notas: string | null
  productos: { nombre: string; unidad_medida: string } | null
  obras: { nombre: string } | null
}

type AcopioRow = {
  id: string
  numero: number
  obra_id: string | null
  proveedor_id: string
  producto_referencia_id: string
  saldo_inicial: number
  monto_pagado: number
  precio_referencia_inicial: number | null
  moneda: string
  fecha: string
  estado: EstadoAcopio
  notas: string | null
  proveedores: { razon_social: string } | null
  productos: { nombre: string; unidad_medida: string } | null
  obras: { nombre: string } | null
  acopio_retiros: AcopioRetiroRow[]
}

interface AcopioResumenRow {
  acopio_id: string
  saldo_actual: number
}

interface Props {
  ordenes: OrdenRow[]
  productos: ProductoConCategoria[]
  proveedores: { id: string; razon_social: string }[]
  obras: { id: string; nombre: string; tipo: string }[]
  categorias: { id: string; nombre: string; color: string }[]
  stockResumen: StockResumenRow[]
  acopios: AcopioRow[]
  acopiosResumen: AcopioResumenRow[]
  constructoraId: string
  constructoraNombre: string
  // 'proveedores' es un módulo de empresa aparte de 'compras' — ver
  // ProveedorSelect.tsx.
  puedeCrearProveedor: boolean
  // Con qué pestaña abrir — llega de ?tab= en la URL (ver app/admin/compras/page.tsx),
  // que hoy solo pone el chat (navegar_a) para poder llevar directo a
  // "Acopios" en vez de solo a Compras en general.
  tabInicial?: 'ordenes' | 'stock' | 'acopios'
}

type ConfirmState = { title: string; message: string; confirmLabel?: string; onConfirm: () => Promise<void> }

const ESTADO_ORDEN_INFO: Record<EstadoOrdenCompra, { label: string; color: string }> = {
  borrador: { label: 'Borrador', color: 'bg-slate-100 text-slate-600' },
  confirmada: { label: 'Confirmada', color: 'bg-indigo-100 text-indigo-700' },
  cancelada: { label: 'Cancelada', color: 'bg-red-100 text-red-600' },
}

// "Cuánto se recibió" y el estado de cumplimiento son SIEMPRE derivados de
// las recepciones — nunca una columna guardada, mismo criterio que
// estaVencido() en lib/utils.ts (ver migration_052.sql).
function cantidadRecibida(item: ItemRow): number {
  return (item.orden_compra_recepcion_items ?? []).reduce((s, r) => s + r.cantidad_recibida, 0)
}

function estadoCumplimiento(items: ItemRow[]): { label: string; color: string } {
  if (items.length === 0) return { label: 'Sin ítems', color: 'bg-slate-100 text-slate-400' }
  const recibidos = items.map(cantidadRecibida)
  const completos = items.every((it, idx) => recibidos[idx] >= it.cantidad_solicitada)
  const algoRecibido = recibidos.some(r => r > 0)
  if (completos) return { label: 'Completa', color: 'bg-emerald-100 text-emerald-700' }
  if (algoRecibido) return { label: 'Parcial', color: 'bg-amber-100 text-amber-700' }
  return { label: 'Sin recibir', color: 'bg-slate-100 text-slate-500' }
}

const EMPTY_ITEM_FORM = { producto_id: '', cantidad_solicitada: '', notas: '', creandoNuevo: false, nuevoNombre: '', nuevoUnidad: 'unidad' }
const EMPTY_ORDEN_FORM = { obra_id: '', fecha_emision: new Date().toISOString().split('T')[0], notas: '' }
const EMPTY_PRODUCTO_FORM = { nombre: '', unidad_medida: 'unidad', categoria_id: '' }
const EMPTY_ACOPIO_FORM = {
  proveedor_id: '', obra_id: '', producto_referencia_id: '', saldo_inicial: '', monto_pagado: '',
  precio_referencia_inicial: '', moneda: 'ARS',
  fecha: new Date().toISOString().split('T')[0], notas: '',
  creandoNuevo: false, nuevoNombre: '', nuevoUnidad: 'unidad',
}
const EMPTY_RETIRO_FORM = {
  producto_id: '', cantidad: '', precio_retiro: '', precio_referencia: '', obra_id: '', notas: '',
  creandoNuevo: false, nuevoNombre: '', nuevoUnidad: 'unidad',
}

export default function ComprasManager({ ordenes, productos, proveedores, obras, categorias, stockResumen, acopios, acopiosResumen, constructoraId, constructoraNombre, puedeCrearProveedor, tabInicial }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [confirmModal, setConfirmModal] = useState<ConfirmState | null>(null)

  const [tab, setTab] = useState<'ordenes' | 'stock' | 'acopios'>(tabInicial ?? 'ordenes')

  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoOrdenCompra>('todos')
  const [detalleOrden, setDetalleOrden] = useState<OrdenRow | null>(null)

  // Nueva orden
  const [showForm, setShowForm] = useState(false)
  const [ordenForm, setOrdenForm] = useState(EMPTY_ORDEN_FORM)
  const [itemsForm, setItemsForm] = useState([{ ...EMPTY_ITEM_FORM }])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Productos creados "al vuelo" desde el selector de un ítem — se
  // acumulan acá para no depender de un refresh del servidor en medio de
  // cargar una orden con varios ítems nuevos (se pisan solos con la lista
  // real de `productos` en cuanto el próximo refresh los trae).
  const [productosNuevos, setProductosNuevos] = useState<ProductoConCategoria[]>([])

  // "+ Agregar proveedor nuevo" (ProveedorSelect) — compartido entre el
  // selector de "Registrar recepción" y "Nuevo acopio".
  const [proveedoresNuevos, setProveedoresNuevos] = useState<{ id: string; razon_social: string }[]>([])
  const [creandoProductoLoading, setCreandoProductoLoading] = useState(false)
  const [creandoProductoError, setCreandoProductoError] = useState<string | null>(null)

  // Administrar productos
  const [showProductos, setShowProductos] = useState(false)
  const [productoForm, setProductoForm] = useState(EMPTY_PRODUCTO_FORM)
  const [productoLoading, setProductoLoading] = useState(false)
  const [productoError, setProductoError] = useState<string | null>(null)

  // Nueva recepción (cumplimiento parcial contra una orden)
  const [recepcionOrden, setRecepcionOrden] = useState<OrdenRow | null>(null)
  const [recepcionForm, setRecepcionForm] = useState({ proveedor_id: '', fecha: new Date().toISOString().split('T')[0], moneda: 'ARS', notas: '', iva: '', percepciones: '', numero_comprobante: '', monto: '' })
  const [recepcionItems, setRecepcionItems] = useState<Record<string, { cantidad: string; precio: string }>>({})
  const [recepcionLoading, setRecepcionLoading] = useState(false)
  const [recepcionError, setRecepcionError] = useState<string | null>(null)
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null)

  // Reparto de stock
  const [showReparto, setShowReparto] = useState(false)
  const [repartoForm, setRepartoForm] = useState({ producto_id: '', obra_origen: '', obra_destino: '', cantidad: '' })
  const [repartoLoading, setRepartoLoading] = useState(false)
  const [repartoError, setRepartoError] = useState<string | null>(null)

  // Acopios
  const [detalleAcopio, setDetalleAcopio] = useState<AcopioRow | null>(null)
  const [showAcopioForm, setShowAcopioForm] = useState(false)
  const [acopioForm, setAcopioForm] = useState(EMPTY_ACOPIO_FORM)
  const [acopioLoading, setAcopioLoading] = useState(false)
  const [acopioError, setAcopioError] = useState<string | null>(null)

  const [retiroAcopio, setRetiroAcopio] = useState<AcopioRow | null>(null)
  const [retiroForm, setRetiroForm] = useState(EMPTY_RETIRO_FORM)
  const [retiroLoading, setRetiroLoading] = useState(false)
  const [retiroError, setRetiroError] = useState<string | null>(null)

  // Si se carga el precio del producto de referencia al momento del pago,
  // el saldo inicial se calcula solo (monto ÷ precio) al tipear cualquiera
  // de los dos — sigue siendo editable a mano después, por si el
  // proveedor da directamente la cantidad en vez de un precio (ej.
  // "700.000 ladrillos", sin precio).
  function actualizarMontoPagado(valor: string) {
    setAcopioForm(f => {
      const precio = parseFloat(f.precio_referencia_inicial)
      const monto = parseFloat(valor)
      const saldo = precio > 0 && monto > 0 ? String(redondear2(monto / precio)) : f.saldo_inicial
      return { ...f, monto_pagado: valor, saldo_inicial: saldo }
    })
  }
  function actualizarPrecioReferenciaInicial(valor: string) {
    setAcopioForm(f => {
      const precio = parseFloat(valor)
      const monto = parseFloat(f.monto_pagado)
      const saldo = precio > 0 && monto > 0 ? String(redondear2(monto / precio)) : f.saldo_inicial
      return { ...f, precio_referencia_inicial: valor, saldo_inicial: saldo }
    })
  }

  function refresh() { startTransition(() => router.refresh()) }

  // Para elegir un producto en un ítem NUEVO (orden/acopio) — solo activos
  // más los creados al vuelo en esta sesión (que todavía no volvieron por
  // props tras un refresh). `productos` en sí trae también los inactivos
  // (para "Administrar productos" y el tab Stock, que si tienen que poder
  // ver/repartir un producto discontinuado con remanente).
  const productosDisponibles = [...productos.filter(p => p.activo), ...productosNuevos.filter(pn => !productos.some(p => p.id === pn.id))]
  const proveedoresDisponibles = [...proveedores, ...proveedoresNuevos]

  const ordenesFiltradas = ordenes
    .filter(o => filtroEstado === 'todos' || o.estado === filtroEstado)
    .filter(o => {
      const q = busqueda.trim().toLowerCase()
      if (!q) return true
      return String(o.numero).includes(q) ||
        (o.obras?.nombre ?? 'empresa').toLowerCase().includes(q) ||
        (o.notas ?? '').toLowerCase().includes(q)
    })

  // Sincroniza el panel de detalle con datos frescos tras un refresh
  const detalleActual = detalleOrden ? ordenes.find(o => o.id === detalleOrden.id) ?? null : null
  const detalleAcopioActual = detalleAcopio ? acopios.find(a => a.id === detalleAcopio.id) ?? null : null

  function openNew() {
    setOrdenForm(EMPTY_ORDEN_FORM)
    setItemsForm([{ ...EMPTY_ITEM_FORM }])
    setError(null)
    setCreandoProductoError(null)
    setShowForm(true)
  }

  function actualizarItem(idx: number, campo: keyof typeof EMPTY_ITEM_FORM, valor: string) {
    setItemsForm(items => items.map((it, i) => i === idx ? { ...it, [campo]: valor } : it))
  }
  function agregarItem() {
    setItemsForm(items => [...items, { ...EMPTY_ITEM_FORM }])
  }
  function quitarItem(idx: number) {
    setItemsForm(items => items.length > 1 ? items.filter((_, i) => i !== idx) : items)
  }

  // "+ Agregar producto nuevo" en el selector de un ítem: en vez de tener
  // que cerrar la orden e ir al modal de Productos, la fila se convierte
  // en un mini-form (nombre + unidad) sin perder lo ya cargado en el resto
  // de la orden.
  function elegirProducto(idx: number, valor: string) {
    if (valor === '__nuevo__') {
      setItemsForm(items => items.map((it, i) => i === idx ? { ...it, creandoNuevo: true, producto_id: '' } : it))
    } else {
      setItemsForm(items => items.map((it, i) => i === idx ? { ...it, producto_id: valor } : it))
    }
  }

  function cancelarNuevoProducto(idx: number) {
    setItemsForm(items => items.map((it, i) => i === idx ? { ...it, creandoNuevo: false, nuevoNombre: '', nuevoUnidad: 'unidad' } : it))
  }

  async function crearProductoEnFila(idx: number) {
    const item = itemsForm[idx]
    if (!item.nuevoNombre.trim()) return
    setCreandoProductoLoading(true)
    setCreandoProductoError(null)
    const supabase = createClient()
    const { data, error } = await supabase
      .rpc('obtener_o_crear_producto', {
        p_constructora_id: constructoraId,
        p_nombre: item.nuevoNombre.trim(),
        p_unidad_medida: item.nuevoUnidad.trim() || 'unidad',
      })
      .single() as { data: { id: string; nombre: string; unidad_medida: string } | null; error: { message: string } | null }
    setCreandoProductoLoading(false)
    if (error || !data) {
      setCreandoProductoError(error?.message ?? 'Error al crear el producto')
      return
    }

    setProductosNuevos(prev => [...prev, {
      id: data.id, nombre: data.nombre, unidad_medida: data.unidad_medida,
      constructora_id: constructoraId, nombre_normalizado: '', categoria_id: null,
      activo: true, notas: null, created_at: new Date().toISOString(), categorias_costo: null,
    }])
    setItemsForm(items => items.map((it, i) => i === idx
      ? { ...it, producto_id: data.id, creandoNuevo: false, nuevoNombre: '', nuevoUnidad: 'unidad' }
      : it))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const itemsValidos = itemsForm.filter(it => it.producto_id && parseFloat(it.cantidad_solicitada) > 0)
    if (itemsValidos.length === 0) {
      setError('Agregá al menos un ítem con producto y cantidad.')
      return
    }

    setLoading(true)
    const supabase = createClient()

    const { data: orden, error: errOrden } = await supabase
      .from('ordenes_compra')
      .insert({
        constructora_id: constructoraId,
        obra_id: ordenForm.obra_id || null,
        fecha_emision: ordenForm.fecha_emision,
        notas: ordenForm.notas.trim() || null,
      })
      .select('id')
      .single()

    if (errOrden || !orden) {
      setLoading(false)
      setError(errOrden?.message ?? 'Error al crear la orden')
      return
    }

    const productoDe = (id: string) => productosDisponibles.find(p => p.id === id)
    const { error: errItems } = await supabase.from('orden_compra_items').insert(
      itemsValidos.map(it => ({
        orden_compra_id: orden.id,
        producto_id: it.producto_id,
        cantidad_solicitada: parseFloat(it.cantidad_solicitada),
        unidad_medida: productoDe(it.producto_id)?.unidad_medida ?? null,
        notas: it.notas.trim() || null,
      }))
    )

    setLoading(false)
    if (errItems) { setError(errItems.message); return }

    setShowForm(false)
    refresh()
  }

  function handleCancelar(orden: OrdenRow) {
    setConfirmModal({
      title: 'Cancelar orden de compra',
      message: `¿Cancelar la orden OC-${orden.numero}? Ya no se van a poder registrar más recepciones contra ella.`,
      confirmLabel: 'Cancelar orden',
      onConfirm: async () => {
        const supabase = createClient()
        const { error } = await supabase.from('ordenes_compra').update({ estado: 'cancelada' }).eq('id', orden.id)
        if (error) throw new Error(error.message)
        setConfirmModal(null)
        setDetalleOrden(null)
        refresh()
      },
    })
  }

  function handleDelete(orden: OrdenRow) {
    const tieneRecepciones = (orden.orden_compra_recepciones ?? []).length > 0
    setConfirmModal({
      title: 'Eliminar orden de compra',
      message: tieneRecepciones
        ? `¿Eliminar la orden OC-${orden.numero}? Esta acción no se puede deshacer. Los gastos y el stock ya generados por sus recepciones NO se eliminan (quedan como registros sueltos) — solo se borra la orden y su seguimiento.`
        : `¿Eliminar la orden OC-${orden.numero}? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      onConfirm: async () => {
        const supabase = createClient()
        const { error } = await supabase.from('ordenes_compra').delete().eq('id', orden.id)
        if (error) throw new Error(error.message)
        setConfirmModal(null)
        setDetalleOrden(null)
        refresh()
      },
    })
  }

  // Borra TODO el historial de movimientos de un producto en una ubicación
  // (pool o una obra) — pensado para limpiar stock de prueba mientras se
  // testea el módulo. Distinto de "Repartir stock": un excedente real (p.ej.
  // bolsas de cemento que sobraron en una obra) hay que devolverlo al pool
  // con "Repartir" (queda registrado como movimiento), no borrarlo — borrar
  // es solo para descartar datos que nunca debieron existir.
  function handleDeleteStock(row: StockResumenRow) {
    const nombre = productos.find(p => p.id === row.producto_id)?.nombre ?? 'este producto'
    const ubicacion = nombreUbicacion(row.obra_id)
    setConfirmModal({
      title: 'Eliminar stock',
      message: `¿Eliminar todo el historial de "${nombre}" en ${ubicacion}? Se borran los movimientos de entrada/salida de esa combinación — pensado para limpiar datos de prueba. Si es un excedente real, mejor devolvelo al pool con "Repartir stock" en vez de borrarlo.`,
      confirmLabel: 'Eliminar',
      onConfirm: async () => {
        const supabase = createClient()
        let query = supabase.from('stock_movimientos').delete().eq('producto_id', row.producto_id)
        query = row.obra_id ? query.eq('obra_id', row.obra_id) : query.is('obra_id', null)
        const { error } = await query
        if (error) throw new Error(error.message)
        setConfirmModal(null)
        refresh()
      },
    })
  }

  // Documento para enviar a proveedores y que coticen — muestra qué se pide
  // y en qué cantidad, sin precio (el precio lo completa el proveedor al
  // cotizar; recién se carga acá al registrar la recepción). Mismo patrón
  // que imprimirRecibo/imprimirEstadoCuenta en ContratosManager.tsx: HTML
  // standalone en una ventana nueva, sin depender de un endpoint de PDF.
  function imprimirOrden(orden: OrdenRow) {
    const fmtDate = (s: string) =>
      new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })

    const filas = (orden.orden_compra_items ?? []).map(item => {
      const unidad = item.unidad_medida ?? item.productos?.unidad_medida ?? ''
      return `<tr>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;">${item.productos?.nombre ?? '—'}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:center;">${item.cantidad_solicitada} ${unidad}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;color:#94a3b8;">${item.notas ?? ''}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;"></td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;"></td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Orden de Compra OC-${orden.numero}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; color: #1e293b; padding: 48px; max-width: 800px; margin: auto; }
    h1 { font-size: 22px; font-weight: bold; margin-bottom: 4px; }
    .subtitle { color: #64748b; font-size: 13px; margin-bottom: 32px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; color: #64748b; padding: 8px 10px; border-bottom: 2px solid #cbd5e1; }
    td { font-size: 13px; }
    .notas { margin-top: 24px; font-size: 13px; color: #475569; }
    .footer { margin-top: 56px; display: flex; justify-content: space-between; font-size: 12px; color: #64748b; }
    .firma { border-top: 1px solid #94a3b8; width: 220px; padding-top: 6px; text-align: center; }
  </style>
</head>
<body>
  <h1>${constructoraNombre}</h1>
  <p class="subtitle">Orden de Compra Nº ${orden.numero} · ${orden.obras?.nombre ?? 'Compra para stock de empresa'} · Emitida ${fmtDate(orden.fecha_emision)}</p>
  <table>
    <thead>
      <tr>
        <th>Producto</th>
        <th style="text-align:center;">Cantidad</th>
        <th>Notas</th>
        <th>Precio unitario</th>
        <th>Subtotal</th>
      </tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>
  ${orden.notas ? `<p class="notas"><strong>Notas:</strong> ${orden.notas}</p>` : ''}
  <div class="footer">
    <div class="firma">Cotizado por</div>
    <div class="firma">Fecha</div>
  </div>
</body>
</html>`
    const w = window.open('', '_blank', 'width=800,height=1000')
    if (!w) return
    w.document.write(html)
    w.document.close()
    setTimeout(() => { w.print() }, 300)
  }

  async function handleCreateProducto(e: React.FormEvent) {
    e.preventDefault()
    if (!productoForm.nombre.trim()) return
    setProductoLoading(true)
    setProductoError(null)
    const supabase = createClient()
    // Vía RPC (no insert directo): así el nombre queda normalizado/deduplicado
    // igual que rubros (lib/rubros.ts) — "Cemento" y "cemento" no terminan
    // siendo dos productos distintos.
    const { error } = await supabase.rpc('obtener_o_crear_producto', {
      p_constructora_id: constructoraId,
      p_nombre: productoForm.nombre.trim(),
      p_unidad_medida: productoForm.unidad_medida.trim() || 'unidad',
      p_categoria_id: productoForm.categoria_id || null,
    })
    setProductoLoading(false)
    if (error) { setProductoError(error.message); return }
    setProductoForm(EMPTY_PRODUCTO_FORM)
    refresh()
  }

  async function handleToggleProducto(producto: ProductoConCategoria) {
    const supabase = createClient()
    await supabase.from('productos').update({ activo: !producto.activo }).eq('id', producto.id)
    refresh()
  }

  function openRecepcion(orden: OrdenRow) {
    setRecepcionOrden(orden)
    setRecepcionForm({ proveedor_id: '', fecha: new Date().toISOString().split('T')[0], moneda: 'ARS', notas: '', iva: '', percepciones: '', numero_comprobante: '', monto: '' })
    setRecepcionItems({})
    setRecepcionError(null)
  }

  function actualizarRecepcionItem(itemId: string, campo: 'cantidad' | 'precio', valor: string) {
    setRecepcionItems(items => ({ ...items, [itemId]: { cantidad: items[itemId]?.cantidad ?? '', precio: items[itemId]?.precio ?? '', [campo]: valor } }))
  }

  async function handleSubmitRecepcion(e: React.FormEvent) {
    e.preventDefault()
    if (!recepcionOrden) return
    setRecepcionError(null)

    const itemsValidos = Object.entries(recepcionItems)
      .filter(([, v]) => parseFloat(v.cantidad) > 0 && parseFloat(v.precio) >= 0)
      .map(([itemId, v]) => ({ itemId, cantidad: parseFloat(v.cantidad), precio: parseFloat(v.precio) }))

    if (!recepcionForm.proveedor_id) {
      setRecepcionError('Elegí un proveedor.')
      return
    }
    if (itemsValidos.length === 0) {
      setRecepcionError('Cargá la cantidad y el precio de al menos un ítem recibido.')
      return
    }

    // Nada impedía recibir más de lo pedido (ni en la base ni acá) — una
    // orden de 10 bolsas podía terminar con el doble de stock/gasto
    // generado si se cargaban dos recepciones de 100 c/u por error.
    for (const it of itemsValidos) {
      const item = (recepcionOrden.orden_compra_items ?? []).find(i => i.id === it.itemId)
      if (!item) continue
      const pendiente = Math.max(0, item.cantidad_solicitada - cantidadRecibida(item))
      if (it.cantidad > pendiente) {
        setRecepcionError(`"${item.productos?.nombre ?? 'Ítem'}": estás recibiendo ${it.cantidad} pero solo quedan ${pendiente} pendientes.`)
        return
      }
    }

    setRecepcionLoading(true)
    const supabase = createClient()

    const { data: recepcion, error: errRecepcion } = await supabase
      .from('orden_compra_recepciones')
      .insert({
        orden_compra_id: recepcionOrden.id,
        proveedor_id: recepcionForm.proveedor_id,
        fecha: recepcionForm.fecha,
        moneda: recepcionForm.moneda,
        notas: recepcionForm.notas.trim() || null,
        iva: recepcionForm.iva ? redondear2(parseFloat(recepcionForm.iva)) : null,
        percepciones: recepcionForm.percepciones ? redondear2(parseFloat(recepcionForm.percepciones)) : null,
        numero_comprobante: recepcionForm.numero_comprobante.trim() || null,
      })
      .select('id')
      .single()

    if (errRecepcion || !recepcion) {
      setRecepcionLoading(false)
      setRecepcionError(errRecepcion?.message ?? 'Error al registrar la recepción')
      return
    }

    const { error: errItems } = await supabase.from('orden_compra_recepcion_items').insert(
      itemsValidos.map(it => ({
        recepcion_id: recepcion.id,
        orden_compra_item_id: it.itemId,
        cantidad_recibida: it.cantidad,
        precio_unitario: it.precio,
      }))
    )

    setRecepcionLoading(false)
    if (errItems) { setRecepcionError(errItems.message); return }

    setRecepcionOrden(null)
    refresh()
  }

  async function handleConfirmarRecepcion(recepcionId: string) {
    setConfirmandoId(recepcionId)
    const supabase = createClient()
    const { error } = await supabase.rpc('confirmar_recepcion_compra', { p_recepcion_id: recepcionId })
    setConfirmandoId(null)
    if (error) {
      setConfirmModal({
        title: 'No se pudo confirmar',
        message: error.message,
        confirmLabel: 'Entendido',
        onConfirm: async () => setConfirmModal(null),
      })
      return
    }
    refresh()
  }

  // Neto de la recepción: siempre la suma de cantidad×precio de los
  // ítems cargados — no es un campo propio, se recalcula en cada
  // cambio (mismo criterio que "cuánto se recibió" en este módulo).
  const netoRecepcion = Object.values(recepcionItems).reduce(
    (s, v) => s + (parseFloat(v.cantidad) || 0) * (parseFloat(v.precio) || 0), 0
  )

  // "Cuánto hay" ya viene agregado desde resumen_stock (Postgres) — acá
  // solo se arma un lookup rápido para no recorrer el array entero por
  // cada celda. obra_id null = pool de empresa.
  const stockPorClave = new Map(stockResumen.map(r => [`${r.producto_id}:${r.obra_id ?? 'pool'}`, r.cantidad]))
  function stockDe(productoId: string, obraId: string | null): number {
    return stockPorClave.get(`${productoId}:${obraId ?? 'pool'}`) ?? 0
  }
  function nombreUbicacion(obraId: string | null): string {
    if (!obraId) return 'Empresa (pool)'
    return obras.find(o => o.id === obraId)?.nombre ?? 'Proyecto eliminado'
  }

  const productosConStock = productos.filter(p => stockResumen.some(r => r.producto_id === p.id))

  function openReparto() {
    setRepartoForm({ producto_id: '', obra_origen: '', obra_destino: '', cantidad: '' })
    setRepartoError(null)
    setShowReparto(true)
  }

  async function handleSubmitReparto(e: React.FormEvent) {
    e.preventDefault()
    setRepartoError(null)

    const cantidad = parseFloat(repartoForm.cantidad)
    if (!repartoForm.producto_id) { setRepartoError('Elegí un producto.'); return }
    if (!cantidad || cantidad <= 0) { setRepartoError('La cantidad tiene que ser mayor a cero.'); return }
    if (repartoForm.obra_origen === repartoForm.obra_destino) { setRepartoError('El origen y el destino no pueden ser el mismo.'); return }

    setRepartoLoading(true)
    const supabase = createClient()
    const { error } = await supabase.rpc('repartir_stock', {
      p_producto_id: repartoForm.producto_id,
      p_obra_origen: repartoForm.obra_origen || null,
      p_obra_destino: repartoForm.obra_destino || null,
      p_cantidad: cantidad,
    })
    setRepartoLoading(false)
    if (error) { setRepartoError(error.message); return }

    setShowReparto(false)
    refresh()
  }

  // ── Acopios ───────────────────────────────────────────────────

  // "Cuánto queda" viene agregado desde resumen_acopios (Postgres) — mismo
  // criterio que stockPorClave/resumen_stock, nunca se suma en el cliente.
  const saldoPorAcopio = new Map(acopiosResumen.map(r => [r.acopio_id, r.saldo_actual]))
  function saldoDeAcopio(acopioId: string): number {
    return saldoPorAcopio.get(acopioId) ?? 0
  }

  // Valor de mercado estimado hoy = saldo × el precio de referencia más
  // reciente conocido de ESE acopio: el de algún retiro con conversión si
  // ya hubo alguno (más actualizado), si no el que se cargó al pagar
  // (precio_referencia_inicial), y solo si tampoco hay eso, el precio
  // implícito (monto_pagado / saldo_inicial) como último recurso para
  // acopios viejos sin ese dato. Puramente informativo — nunca es lo que
  // limita cuánto se puede retirar.
  function precioReferenciaEstimado(acopio: AcopioRow): number {
    const retirosConPrecio = (acopio.acopio_retiros ?? [])
      .filter(r => r.precio_unitario_referencia != null)
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
    if (retirosConPrecio.length > 0) return retirosConPrecio[0].precio_unitario_referencia!
    if (acopio.precio_referencia_inicial != null) return acopio.precio_referencia_inicial
    return acopio.saldo_inicial > 0 ? acopio.monto_pagado / acopio.saldo_inicial : 0
  }

  // Mismo patrón que crearProductoEnFila (órdenes), pero sin depender de un
  // índice de fila — lo llaman tanto "Nuevo acopio" como "Registrar retiro".
  async function crearProductoInline(nombre: string, unidad: string): Promise<{ id: string; nombre: string; unidad_medida: string } | null> {
    const supabase = createClient()
    const { data, error } = await supabase
      .rpc('obtener_o_crear_producto', {
        p_constructora_id: constructoraId,
        p_nombre: nombre.trim(),
        p_unidad_medida: unidad.trim() || 'unidad',
      })
      .single() as { data: { id: string; nombre: string; unidad_medida: string } | null; error: { message: string } | null }
    if (error || !data) return null
    setProductosNuevos(prev => [...prev, {
      id: data.id, nombre: data.nombre, unidad_medida: data.unidad_medida,
      constructora_id: constructoraId, nombre_normalizado: '', categoria_id: null,
      activo: true, notas: null, created_at: new Date().toISOString(), categorias_costo: null,
    }])
    return data
  }

  function openNuevoAcopio() {
    setAcopioForm(EMPTY_ACOPIO_FORM)
    setAcopioError(null)
    setShowAcopioForm(true)
  }

  async function crearProductoParaAcopio() {
    if (!acopioForm.nuevoNombre.trim()) return
    setAcopioLoading(true)
    const data = await crearProductoInline(acopioForm.nuevoNombre, acopioForm.nuevoUnidad)
    setAcopioLoading(false)
    if (!data) { setAcopioError('Error al crear el producto'); return }
    setAcopioForm(f => ({ ...f, producto_referencia_id: data.id, creandoNuevo: false, nuevoNombre: '', nuevoUnidad: 'unidad' }))
  }

  async function handleSubmitAcopio(e: React.FormEvent) {
    e.preventDefault()
    setAcopioError(null)

    const saldoInicial = parseFloat(acopioForm.saldo_inicial)
    const montoPagado = parseFloat(acopioForm.monto_pagado)
    if (!acopioForm.proveedor_id) { setAcopioError('Elegí un proveedor.'); return }
    if (!acopioForm.producto_referencia_id) { setAcopioError('Elegí el producto de referencia.'); return }
    if (!saldoInicial || saldoInicial <= 0) { setAcopioError('El saldo inicial tiene que ser mayor a cero.'); return }
    if (!montoPagado || montoPagado <= 0) { setAcopioError('El monto pagado tiene que ser mayor a cero.'); return }

    setAcopioLoading(true)
    const supabase = createClient()
    const proveedorNombre = proveedores.find(p => p.id === acopioForm.proveedor_id)?.razon_social ?? ''

    const { data: gasto, error: errGasto } = await supabase.from('gastos').insert({
      constructora_id: constructoraId,
      obra_id: acopioForm.obra_id || null,
      proveedor_id: acopioForm.proveedor_id,
      descripcion: `Acopio con ${proveedorNombre}`,
      monto: montoPagado,
      moneda: acopioForm.moneda,
      fecha_vencimiento: acopioForm.fecha,
      fecha_pago: acopioForm.fecha,
      estado: 'Pagado',
      notas: acopioForm.notas.trim() || null,
    }).select('id').single()

    if (errGasto || !gasto) {
      setAcopioLoading(false)
      setAcopioError(errGasto?.message ?? 'Error al registrar el pago')
      return
    }

    const { error: errAcopio } = await supabase.from('acopios').insert({
      constructora_id: constructoraId,
      obra_id: acopioForm.obra_id || null,
      proveedor_id: acopioForm.proveedor_id,
      producto_referencia_id: acopioForm.producto_referencia_id,
      saldo_inicial: saldoInicial,
      monto_pagado: montoPagado,
      precio_referencia_inicial: acopioForm.precio_referencia_inicial ? parseFloat(acopioForm.precio_referencia_inicial) : null,
      moneda: acopioForm.moneda,
      fecha: acopioForm.fecha,
      gasto_id: gasto.id,
      notas: acopioForm.notas.trim() || null,
    })

    setAcopioLoading(false)
    if (errAcopio) {
      // No dejar un gasto de $500M colgado sin el acopio que lo justifica.
      await supabase.from('gastos').delete().eq('id', gasto.id)
      setAcopioError(errAcopio.message)
      return
    }

    setShowAcopioForm(false)
    refresh()
  }

  function openRetiro(acopio: AcopioRow) {
    setRetiroAcopio(acopio)
    // Precarga el precio de referencia con el último conocido de este
    // acopio (de un retiro anterior, o el cargado al pagar) — de punto de
    // partida para ajustar al valor de hoy, no en blanco cada vez.
    const precioConocido = precioReferenciaEstimado(acopio)
    setRetiroForm({ ...EMPTY_RETIRO_FORM, precio_referencia: precioConocido > 0 ? String(precioConocido) : '' })
    setRetiroError(null)
  }

  async function crearProductoParaRetiro() {
    if (!retiroForm.nuevoNombre.trim()) return
    setRetiroLoading(true)
    const data = await crearProductoInline(retiroForm.nuevoNombre, retiroForm.nuevoUnidad)
    setRetiroLoading(false)
    if (!data) { setRetiroError('Error al crear el producto'); return }
    setRetiroForm(f => ({ ...f, producto_id: data.id, creandoNuevo: false, nuevoNombre: '', nuevoUnidad: 'unidad' }))
  }

  async function handleSubmitRetiro(e: React.FormEvent) {
    e.preventDefault()
    if (!retiroAcopio) return
    setRetiroError(null)

    const cantidad = parseFloat(retiroForm.cantidad)
    if (!retiroForm.producto_id) { setRetiroError('Elegí qué producto se retira.'); return }
    if (!cantidad || cantidad <= 0) { setRetiroError('La cantidad tiene que ser mayor a cero.'); return }

    const esProductoReferencia = retiroForm.producto_id === retiroAcopio.producto_referencia_id
    const precioRetiro = parseFloat(retiroForm.precio_retiro)
    const precioReferencia = parseFloat(retiroForm.precio_referencia)
    if (!esProductoReferencia && (!precioRetiro || precioRetiro <= 0 || !precioReferencia || precioReferencia <= 0)) {
      setRetiroError('Para retirar un producto distinto al de referencia, cargá el precio de hoy de los dos.')
      return
    }

    setRetiroLoading(true)
    const supabase = createClient()
    const { error } = await supabase.rpc('registrar_retiro_acopio', {
      p_acopio_id: retiroAcopio.id,
      p_producto_id: retiroForm.producto_id,
      p_cantidad: cantidad,
      p_precio_retiro: esProductoReferencia ? null : precioRetiro,
      p_precio_referencia: esProductoReferencia ? null : precioReferencia,
      p_obra_id: retiroForm.obra_id || null,
      p_notas: retiroForm.notas.trim() || null,
    })
    setRetiroLoading(false)
    if (error) { setRetiroError(error.message); return }

    setRetiroAcopio(null)
    refresh()
  }

  // El stock que generó el retiro NO se borra (mismo criterio que
  // "Eliminar orden de compra"/"Eliminar stock": lo real que ya entró al
  // depósito no desaparece por borrar el papeleo) — si es de prueba y
  // también querés sacar ese stock, usá "Eliminar" desde la pestaña Stock.
  function handleDeleteRetiro(retiro: AcopioRetiroRow) {
    setConfirmModal({
      title: 'Eliminar retiro',
      message: `¿Eliminar este retiro de ${retiro.cantidad} ${retiro.productos?.unidad_medida ?? ''} de "${retiro.productos?.nombre ?? '—'}"? El saldo del acopio vuelve a subir, pero el stock que ya generó NO se elimina (queda como un movimiento suelto) — si es de prueba, podés borrarlo aparte desde la pestaña Stock.`,
      confirmLabel: 'Eliminar',
      onConfirm: async () => {
        const supabase = createClient()
        const { error } = await supabase.from('acopio_retiros').delete().eq('id', retiro.id)
        if (error) throw new Error(error.message)
        setConfirmModal(null)
        refresh()
      },
    })
  }

  function handleDeleteAcopio(acopio: AcopioRow) {
    const tieneRetiros = (acopio.acopio_retiros ?? []).length > 0
    setConfirmModal({
      title: 'Eliminar acopio',
      message: tieneRetiros
        ? `¿Eliminar el acopio ACO-${acopio.numero}? Se eliminan también sus ${acopio.acopio_retiros.length} retiro(s) registrado(s). El gasto del pago original y el stock ya generado NO se eliminan — quedan como registros sueltos. Esta acción no se puede deshacer.`
        : `¿Eliminar el acopio ACO-${acopio.numero}? El gasto del pago original no se elimina. Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      onConfirm: async () => {
        const supabase = createClient()
        const { error } = await supabase.from('acopios').delete().eq('id', acopio.id)
        if (error) throw new Error(error.message)
        setConfirmModal(null)
        setDetalleAcopio(null)
        refresh()
      },
    })
  }

  return (
    <div>
      <div className="flex rounded-lg border border-slate-300 overflow-x-auto max-w-full text-sm bg-white no-scrollbar w-fit mb-5">
        {([['ordenes', 'Órdenes'], ['stock', 'Stock'], ['acopios', 'Acopios']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn('px-4 py-2 transition-colors', tab === key ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'stock' ? (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={openReparto} disabled={productosConStock.length === 0}
              title={productosConStock.length === 0 ? 'Todavía no hay stock cargado (confirmá una recepción primero)' : undefined}
              className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed
                         text-white rounded-lg text-sm font-medium transition-colors">
              Repartir stock
            </button>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Producto</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Ubicación</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Cantidad</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stockResumen.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {productos.find(p => p.id === r.producto_id)?.nombre ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{nombreUbicacion(r.obra_id)}</td>
                      <td className={cn('px-4 py-3 text-right font-semibold', r.cantidad < 0 ? 'text-red-600' : 'text-slate-800')}>
                        {r.cantidad}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => handleDeleteStock(r)}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors">Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {stockResumen.length === 0 && (
              <div className="text-center py-12 text-slate-400">
                <p className="text-sm">Todavía no hay stock — confirmá una recepción de una orden de compra para que aparezca acá.</p>
              </div>
            )}
          </div>
        </div>
      ) : tab === 'acopios' ? (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={openNuevoAcopio}
              className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500
                         text-white rounded-lg text-sm font-medium transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Nuevo acopio
            </button>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">N°</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Proveedor</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Producto de referencia</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Saldo actual</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Valor estimado hoy</th>
                    <th className="text-center px-4 py-3 font-semibold text-slate-600">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {acopios.map(a => {
                    const saldo = saldoDeAcopio(a.id)
                    const valorEstimado = saldo * precioReferenciaEstimado(a)
                    return (
                      <tr key={a.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setDetalleAcopio(a)}>
                        <td className="px-4 py-3 font-medium text-slate-900">ACO-{a.numero}</td>
                        <td className="px-4 py-3 text-slate-600">{a.proveedores?.razon_social ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{a.productos?.nombre ?? '—'}</td>
                        <td className={cn('px-4 py-3 text-right font-semibold', saldo < 0 ? 'text-red-600' : 'text-slate-900')}>
                          {saldo} {a.productos?.unidad_medida ?? ''}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-500">{formatCurrency(valorEstimado, a.moneda)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn('inline-block text-xs font-medium px-2.5 py-0.5 rounded-full',
                            a.estado === 'activo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                            {a.estado === 'activo' ? 'Activo' : 'Cerrado'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {acopios.length === 0 && (
              <div className="text-center py-12 text-slate-400">
                <p className="text-sm">Todavía no hay acopios cargados.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
      <>
      {/* Filtros + acciones */}
      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <input
          placeholder="Buscar por número, obra o notas..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          className="w-full md:flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="flex flex-wrap gap-2 shrink-0">
          <div className="flex rounded-lg border border-slate-300 overflow-x-auto max-w-full text-sm bg-white no-scrollbar">
            {(['todos', 'borrador', 'confirmada', 'cancelada'] as const).map(e => (
              <button key={e}
                onClick={() => setFiltroEstado(e)}
                className={cn(
                  'px-3 py-2 transition-colors',
                  filtroEstado === e ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                )}>
                {e === 'todos' ? 'Todos' : ESTADO_ORDEN_INFO[e].label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowProductos(true)}
            className="flex items-center gap-2 px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50
                       text-slate-700 rounded-lg text-sm font-medium transition-colors whitespace-nowrap">
            Productos
          </button>
          <button onClick={openNew}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500
                       text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nueva orden
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">N°</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Destino</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Emisión</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Ítems</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Estado</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Cumplimiento</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ordenesFiltradas.map(o => {
                const cumplimiento = estadoCumplimiento(o.orden_compra_items ?? [])
                return (
                  <tr key={o.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setDetalleOrden(o)}>
                    <td className="px-4 py-3 font-medium text-slate-900">OC-{o.numero}</td>
                    <td className="px-4 py-3 text-slate-600">{o.obras?.nombre ?? 'Empresa (sin asignar)'}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(o.fecha_emision)}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{(o.orden_compra_items ?? []).length}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn('inline-block text-xs font-medium px-2.5 py-0.5 rounded-full', ESTADO_ORDEN_INFO[o.estado].color)}>
                        {ESTADO_ORDEN_INFO[o.estado].label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn('inline-block text-xs font-medium px-2.5 py-0.5 rounded-full', cumplimiento.color)}>
                        {cumplimiento.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => imprimirOrden(o)}
                          className="text-xs text-slate-400 hover:text-indigo-600 transition-colors">Imprimir</button>
                        {o.estado !== 'cancelada' && (
                          <button onClick={() => handleCancelar(o)}
                            className="text-xs text-slate-400 hover:text-slate-700 transition-colors">Cancelar</button>
                        )}
                        <button onClick={() => handleDelete(o)}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors">Eliminar</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {ordenesFiltradas.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <p className="text-sm">No hay órdenes de compra{filtroEstado !== 'todos' ? ` en estado ${ESTADO_ORDEN_INFO[filtroEstado].label.toLowerCase()}` : ''}.</p>
          </div>
        )}
      </div>

      {/* Panel de detalle */}
      {detalleActual && (
        <div className="fixed inset-0 z-40 flex items-stretch">
          <div className="flex-1 bg-black/40" onClick={() => setDetalleOrden(null)} />
          <div className="w-full max-w-2xl bg-slate-50 flex flex-col shadow-2xl overflow-hidden">
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-start justify-between shrink-0">
              <div>
                <p className="font-bold text-slate-900 text-lg">OC-{detalleActual.numero}</p>
                <p className="text-slate-500 text-sm mt-0.5">
                  {detalleActual.obras?.nombre ?? 'Empresa (sin asignar)'} · Emitida {formatDate(detalleActual.fecha_emision)}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => imprimirOrden(detalleActual)}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-800 px-2 py-1.5">
                  Imprimir
                </button>
                <button onClick={() => setDetalleOrden(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Ítems solicitados */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                  <p className="font-semibold text-slate-800 text-sm">Ítems solicitados</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {(detalleActual.orden_compra_items ?? []).map(item => {
                    const recibido = cantidadRecibida(item)
                    const unidad = item.unidad_medida ?? item.productos?.unidad_medida ?? ''
                    return (
                      <div key={item.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{item.productos?.nombre ?? '—'}</p>
                          {item.notas && <p className="text-xs text-slate-400">{item.notas}</p>}
                        </div>
                        <div className="text-right shrink-0 text-sm">
                          <span className={recibido >= item.cantidad_solicitada ? 'text-emerald-600 font-semibold' : 'text-slate-700'}>
                            {recibido} / {item.cantidad_solicitada} {unidad}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Recepciones */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <p className="font-semibold text-slate-800 text-sm">Recepciones</p>
                  {detalleActual.estado !== 'cancelada' && (
                    <button onClick={() => openRecepcion(detalleActual)}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
                      + Registrar recepción
                    </button>
                  )}
                </div>
                {(detalleActual.orden_compra_recepciones ?? []).length === 0 ? (
                  <div className="px-4 py-8 text-center text-slate-400 text-sm">Todavía no se registró ninguna recepción.</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {detalleActual.orden_compra_recepciones.map(r => {
                      const total = r.orden_compra_recepcion_items.reduce((s, it) => s + it.subtotal, 0)
                      return (
                        <div key={r.id} className="px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-slate-800">{r.proveedores?.razon_social ?? '—'}</p>
                            <p className="text-sm font-semibold text-slate-900">{formatCurrency(total, r.moneda)}</p>
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <p className="text-xs text-slate-400">
                              {formatDate(r.fecha)} · {r.gasto_id ? 'Confirmada — gasto generado' : 'Sin confirmar'}
                            </p>
                            {!r.gasto_id && (
                              <button
                                onClick={() => handleConfirmarRecepcion(r.id)}
                                disabled={confirmandoId === r.id}
                                className="text-xs font-medium text-emerald-600 hover:text-emerald-800 disabled:opacity-50"
                              >
                                {confirmandoId === r.id ? 'Confirmando...' : 'Confirmar'}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nueva orden */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="font-bold text-slate-900">Nueva orden de compra</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <form id="orden-form" onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Destino</label>
                    <select value={ordenForm.obra_id} onChange={e => setOrdenForm(f => ({ ...f, obra_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                      <option value="">Empresa (repartir después)</option>
                      {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de emisión *</label>
                    <input required type="date" value={ordenForm.fecha_emision}
                      onChange={e => setOrdenForm(f => ({ ...f, fecha_emision: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Notas</label>
                  <textarea rows={2} value={ordenForm.notas}
                    onChange={e => setOrdenForm(f => ({ ...f, notas: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-slate-700">Ítems solicitados</p>
                    <button type="button" onClick={agregarItem}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-800">+ Agregar ítem</button>
                  </div>
                  <div className="space-y-2">
                    {itemsForm.map((item, idx) => (
                      <div key={idx} className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                        {item.creandoNuevo ? (
                          <div className="flex-1 min-w-0 flex gap-2">
                            <input autoFocus placeholder="Nombre del producto" value={item.nuevoNombre}
                              onChange={e => actualizarItem(idx, 'nuevoNombre', e.target.value)}
                              className="flex-1 min-w-0 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                            <input placeholder="Unidad" value={item.nuevoUnidad}
                              onChange={e => actualizarItem(idx, 'nuevoUnidad', e.target.value)}
                              className="w-20 shrink-0 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                            <button type="button" onClick={() => crearProductoEnFila(idx)}
                              disabled={creandoProductoLoading || !item.nuevoNombre.trim()}
                              className="shrink-0 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium">
                              {creandoProductoLoading ? '...' : 'Crear'}
                            </button>
                            <button type="button" onClick={() => cancelarNuevoProducto(idx)}
                              className="shrink-0 text-slate-400 hover:text-slate-600 px-1">✕</button>
                          </div>
                        ) : (
                          <select value={item.producto_id} onChange={e => elegirProducto(idx, e.target.value)}
                            className="flex-1 min-w-0 px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="">Producto...</option>
                            {productosDisponibles.map(p => <option key={p.id} value={p.id}>{p.nombre} ({p.unidad_medida})</option>)}
                            <option value="__nuevo__">+ Agregar producto nuevo</option>
                          </select>
                        )}
                        <input type="number" min="0" step="0.01" placeholder="Cant." value={item.cantidad_solicitada}
                          onChange={e => actualizarItem(idx, 'cantidad_solicitada', e.target.value)}
                          className="w-20 shrink-0 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                        <button type="button" onClick={() => quitarItem(idx)}
                          className="shrink-0 text-slate-400 hover:text-red-500 px-1.5 py-1.5">✕</button>
                      </div>
                    ))}
                  </div>
                  {creandoProductoError && (
                    <p className="text-xs text-red-600 mt-2">{creandoProductoError}</p>
                  )}
                  {productosDisponibles.length === 0 && (
                    <p className="text-xs text-amber-600 mt-2">
                      Todavía no hay productos — elegí &quot;+ Agregar producto nuevo&quot; en el selector de arriba para crear el primero.
                    </p>
                  )}
                </div>

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
                )}
              </form>
            </div>
            <div className="p-6 border-t border-slate-100 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3">
              <button type="button" onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button type="submit" form="orden-form" disabled={loading}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
                           text-white rounded-xl text-sm font-semibold">
                {loading ? 'Creando...' : 'Crear orden'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Administrar productos */}
      {showProductos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="font-bold text-slate-900">Administrar productos</h2>
                <p className="text-xs text-slate-500 mt-0.5">Catálogo de insumos para las órdenes de compra</p>
              </div>
              <button onClick={() => setShowProductos(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {productos.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No hay productos creados.</p>
              ) : productos.map(p => (
                <div key={p.id} className={cn(
                  'flex items-center justify-between px-3 py-2.5 rounded-lg border',
                  p.activo ? 'border-slate-100 hover:bg-slate-50' : 'border-slate-100 bg-slate-50 opacity-60'
                )}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{p.nombre}</p>
                    <p className="text-xs text-slate-400">
                      {p.unidad_medida}{p.categorias_costo ? ` · ${p.categorias_costo.nombre}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => handleToggleProducto(p)}
                    className="text-xs text-slate-400 hover:text-slate-700 transition-colors px-1 shrink-0"
                  >
                    {p.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
              <form onSubmit={handleCreateProducto} className="space-y-2">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Nuevo producto</p>
                <div className="flex gap-2">
                  <input
                    required
                    placeholder="Ej: Cemento, Hierro ø12..."
                    value={productoForm.nombre}
                    onChange={e => setProductoForm(f => ({ ...f, nombre: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  />
                  <input
                    placeholder="Unidad"
                    value={productoForm.unidad_medida}
                    onChange={e => setProductoForm(f => ({ ...f, unidad_medida: e.target.value }))}
                    className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  />
                </div>
                <div className="flex gap-2">
                  <select
                    value={productoForm.categoria_id}
                    onChange={e => setProductoForm(f => ({ ...f, categoria_id: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Sin categoría</option>
                    {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                  <CategoriasCostoManager categorias={categorias} constructoraId={constructoraId} onChanged={refresh} />
                </div>
                {productoError && <p className="text-xs text-red-600">{productoError}</p>}
                <button
                  type="submit"
                  disabled={productoLoading || !productoForm.nombre.trim()}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                             text-white rounded-lg text-sm font-semibold transition-colors"
                >
                  {productoLoading ? 'Creando...' : 'Crear producto'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal Registrar recepción */}
      {recepcionOrden && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="font-bold text-slate-900">Registrar recepción</h2>
                <p className="text-xs text-slate-500 mt-0.5">OC-{recepcionOrden.numero}</p>
              </div>
              <button onClick={() => setRecepcionOrden(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <form id="recepcion-form" onSubmit={handleSubmitRecepcion} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Proveedor *</label>
                    <ProveedorSelect
                      proveedores={proveedoresDisponibles}
                      onCreated={p => setProveedoresNuevos(prev => [...prev, { id: p.id, razon_social: p.razon_social }])}
                      value={recepcionForm.proveedor_id}
                      onChange={id => setRecepcionForm(f => ({ ...f, proveedor_id: id }))}
                      constructoraId={constructoraId}
                      puedeCrear={puedeCrearProveedor}
                      required
                      emptyLabel="Elegir..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Fecha *</label>
                    <input required type="date" value={recepcionForm.fecha}
                      onChange={e => setRecepcionForm(f => ({ ...f, fecha: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Moneda</label>
                  <select value={recepcionForm.moneda} onChange={e => setRecepcionForm(f => ({ ...f, moneda: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option>ARS</option>
                    <option>USD</option>
                  </select>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold text-slate-700 mb-2">Qué llegó en esta recepción</p>
                  <div className="space-y-2">
                    {(recepcionOrden.orden_compra_items ?? []).map(item => {
                      const recibido = cantidadRecibida(item)
                      const pendiente = Math.max(0, item.cantidad_solicitada - recibido)
                      const unidad = item.unidad_medida ?? item.productos?.unidad_medida ?? ''
                      const valores = recepcionItems[item.id] ?? { cantidad: '', precio: '' }
                      return (
                        <div key={item.id} className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                          <p className="text-sm font-medium text-slate-800">{item.productos?.nombre ?? '—'}</p>
                          <p className="text-xs text-slate-400 mb-1.5">Pendiente: {pendiente} {unidad}</p>
                          <div className="flex gap-2">
                            <input type="number" min="0" max={pendiente} step="0.01" placeholder="Cantidad"
                              value={valores.cantidad}
                              onChange={e => actualizarRecepcionItem(item.id, 'cantidad', e.target.value)}
                              className="flex-1 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                            <input type="number" min="0" step="0.01" placeholder="Precio unitario"
                              value={valores.precio}
                              onChange={e => actualizarRecepcionItem(item.id, 'precio', e.target.value)}
                              className="flex-1 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <IvaCalculator
                    montoNeto={String(netoRecepcion)} netoReadOnly labelNeto="Subtotal (ítems)"
                    iva={recepcionForm.iva} monto={recepcionForm.monto}
                    onChangeMontoNeto={() => {}}
                    onChangeIva={v => setRecepcionForm(f => ({ ...f, iva: v }))}
                    onChangeMonto={v => setRecepcionForm(f => ({ ...f, monto: v }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Percepciones</label>
                  <input type="number" min="0" step="0.01" value={recepcionForm.percepciones}
                    onChange={e => setRecepcionForm(f => ({ ...f, percepciones: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">N° comprobante</label>
                  <input value={recepcionForm.numero_comprobante}
                    onChange={e => setRecepcionForm(f => ({ ...f, numero_comprobante: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Notas</label>
                  <textarea rows={2} value={recepcionForm.notas}
                    onChange={e => setRecepcionForm(f => ({ ...f, notas: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
                </div>

                {recepcionError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{recepcionError}</div>
                )}
                <p className="text-[11px] text-slate-400">
                  Esto guarda la recepción como borrador — todavía no genera el gasto. Confirmala desde la lista de recepciones cuando estés list@ para que impacte en Gastos y en el stock.
                </p>
              </form>
            </div>
            <div className="p-6 border-t border-slate-100 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3">
              <button type="button" onClick={() => setRecepcionOrden(null)}
                className="flex-1 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button type="submit" form="recepcion-form" disabled={recepcionLoading}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
                           text-white rounded-xl text-sm font-semibold">
                {recepcionLoading ? 'Guardando...' : 'Guardar recepción'}
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}

      {/* Modal Repartir stock */}
      {showReparto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="p-6 border-b border-slate-200">
              <h2 className="font-bold text-slate-900">Repartir stock</h2>
              <p className="text-xs text-slate-500 mt-0.5">Mueve cantidad del pool de empresa a una obra, entre obras, o de vuelta al pool.</p>
            </div>
            <form onSubmit={handleSubmitReparto} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Producto *</label>
                <select required value={repartoForm.producto_id}
                  onChange={e => setRepartoForm(f => ({ ...f, producto_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">Elegir...</option>
                  {productosConStock.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Desde</label>
                  <select value={repartoForm.obra_origen} onChange={e => setRepartoForm(f => ({ ...f, obra_origen: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">Empresa (pool)</option>
                    {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                  </select>
                  {repartoForm.producto_id && (
                    <p className="text-xs text-slate-400 mt-1">
                      Hay {stockDe(repartoForm.producto_id, repartoForm.obra_origen || null)} ahí
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Hacia</label>
                  <select value={repartoForm.obra_destino} onChange={e => setRepartoForm(f => ({ ...f, obra_destino: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">Empresa (pool)</option>
                    {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Cantidad *</label>
                <input required type="number" min="0" step="0.01" value={repartoForm.cantidad}
                  onChange={e => setRepartoForm(f => ({ ...f, cantidad: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {repartoError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{repartoError}</div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowReparto(false)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                  Cancelar
                </button>
                <button type="submit" disabled={repartoLoading}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {repartoLoading ? 'Guardando...' : 'Repartir'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Panel de detalle: Acopio */}
      {detalleAcopioActual && (
        <div className="fixed inset-0 z-40 flex items-stretch">
          <div className="flex-1 bg-black/40" onClick={() => setDetalleAcopio(null)} />
          <div className="w-full max-w-2xl bg-slate-50 flex flex-col shadow-2xl overflow-hidden">
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-start justify-between shrink-0">
              <div>
                <p className="font-bold text-slate-900 text-lg">ACO-{detalleAcopioActual.numero}</p>
                <p className="text-slate-500 text-sm mt-0.5">
                  {detalleAcopioActual.proveedores?.razon_social ?? '—'} · Referencia: {detalleAcopioActual.productos?.nombre ?? '—'} · Cargado {formatDate(detalleAcopioActual.fecha)}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => handleDeleteAcopio(detalleAcopioActual)}
                  className="text-xs text-red-400 hover:text-red-600 px-2 py-1.5 transition-colors">
                  Eliminar
                </button>
                <button onClick={() => setDetalleAcopio(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs text-slate-400 mb-1">Saldo actual</p>
                  <p className={cn('text-xl font-bold', saldoDeAcopio(detalleAcopioActual.id) < 0 ? 'text-red-600' : 'text-slate-900')}>
                    {saldoDeAcopio(detalleAcopioActual.id)} {detalleAcopioActual.productos?.unidad_medida ?? ''}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs text-slate-400 mb-1">Pagado originalmente</p>
                  <p className="text-xl font-bold text-slate-900">{formatCurrency(detalleAcopioActual.monto_pagado, detalleAcopioActual.moneda)}</p>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <p className="font-semibold text-slate-800 text-sm">Retiros</p>
                  <button onClick={() => openRetiro(detalleAcopioActual)}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
                    + Registrar retiro
                  </button>
                </div>
                {(detalleAcopioActual.acopio_retiros ?? []).length === 0 ? (
                  <div className="px-4 py-8 text-center text-slate-400 text-sm">Todavía no se registró ningún retiro.</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {[...detalleAcopioActual.acopio_retiros].sort((a, b) => b.fecha.localeCompare(a.fecha)).map(r => (
                      <div key={r.id} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-slate-800">{r.productos?.nombre ?? '—'}</p>
                          <div className="flex items-center gap-2 shrink-0">
                            <p className="text-sm font-semibold text-slate-900">{r.cantidad} {r.productos?.unidad_medida ?? ''}</p>
                            <button onClick={() => handleDeleteRetiro(r)}
                              className="text-xs text-red-400 hover:text-red-600 transition-colors">✕</button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-0.5 text-xs text-slate-400">
                          <span>{formatDate(r.fecha)} · {r.obra_id ? (r.obras?.nombre ?? 'Proyecto eliminado') : 'Empresa (pool)'}</span>
                          <span>
                            {r.precio_unitario_retiro != null
                              ? `Convertido — descuenta ${r.cantidad_referencia_descontada} ${detalleAcopioActual.productos?.unidad_medida ?? ''}`
                              : `Descuenta ${r.cantidad_referencia_descontada} directo`}
                          </span>
                        </div>
                        {r.notas && <p className="text-xs text-slate-400 mt-1">{r.notas}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nuevo acopio */}
      {showAcopioForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="font-bold text-slate-900">Nuevo acopio</h2>
              <button onClick={() => setShowAcopioForm(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <form id="acopio-form" onSubmit={handleSubmitAcopio} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Proveedor *</label>
                    <ProveedorSelect
                      proveedores={proveedoresDisponibles}
                      onCreated={p => setProveedoresNuevos(prev => [...prev, { id: p.id, razon_social: p.razon_social }])}
                      value={acopioForm.proveedor_id}
                      onChange={id => setAcopioForm(f => ({ ...f, proveedor_id: id }))}
                      constructoraId={constructoraId}
                      puedeCrear={puedeCrearProveedor}
                      required
                      emptyLabel="Elegir..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Proyecto</label>
                    <select value={acopioForm.obra_id} onChange={e => setAcopioForm(f => ({ ...f, obra_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="">Empresa (sin asignar)</option>
                      {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Producto de referencia *</label>
                  <p className="text-[11px] text-slate-400 mb-1.5">La unidad en la que se va a llevar el saldo (ej. kg de acero).</p>
                  {acopioForm.creandoNuevo ? (
                    <div className="flex gap-2">
                      <input autoFocus placeholder="Nombre del producto" value={acopioForm.nuevoNombre}
                        onChange={e => setAcopioForm(f => ({ ...f, nuevoNombre: e.target.value }))}
                        className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                      <input placeholder="Unidad" value={acopioForm.nuevoUnidad}
                        onChange={e => setAcopioForm(f => ({ ...f, nuevoUnidad: e.target.value }))}
                        className="w-24 shrink-0 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                      <button type="button" onClick={crearProductoParaAcopio}
                        disabled={acopioLoading || !acopioForm.nuevoNombre.trim()}
                        className="shrink-0 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium">
                        Crear
                      </button>
                      <button type="button" onClick={() => setAcopioForm(f => ({ ...f, creandoNuevo: false, nuevoNombre: '', nuevoUnidad: 'unidad' }))}
                        className="shrink-0 text-slate-400 hover:text-slate-600 px-1">✕</button>
                    </div>
                  ) : (
                    <select value={acopioForm.producto_referencia_id}
                      onChange={e => e.target.value === '__nuevo__'
                        ? setAcopioForm(f => ({ ...f, creandoNuevo: true, producto_referencia_id: '' }))
                        : setAcopioForm(f => ({ ...f, producto_referencia_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="">Elegir...</option>
                      {productosDisponibles.map(p => <option key={p.id} value={p.id}>{p.nombre} ({p.unidad_medida})</option>)}
                      <option value="__nuevo__">+ Agregar producto nuevo</option>
                    </select>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Monto pagado *</label>
                    <input required type="number" min="0" step="0.01" value={acopioForm.monto_pagado}
                      onChange={e => actualizarMontoPagado(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Precio de referencia al pagar</label>
                    <input type="number" min="0" step="0.01" value={acopioForm.precio_referencia_inicial}
                      onChange={e => actualizarPrecioReferenciaInicial(e.target.value)}
                      placeholder="Ej: 1.000.000 ($/kg)"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Saldo inicial *</label>
                  <input required type="number" min="0" step="0.01" value={acopioForm.saldo_inicial}
                    onChange={e => setAcopioForm(f => ({ ...f, saldo_inicial: e.target.value }))}
                    placeholder="Ej: 100 (kg)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <p className="text-[11px] text-slate-400 mt-1">
                    {acopioForm.precio_referencia_inicial
                      ? 'Calculado solo (monto ÷ precio) — lo podés ajustar si hace falta.'
                      : 'Si cargás el precio de referencia de arriba, esto se calcula solo.'}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Moneda</label>
                    <select value={acopioForm.moneda} onChange={e => setAcopioForm(f => ({ ...f, moneda: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option>ARS</option>
                      <option>USD</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Fecha *</label>
                    <input required type="date" value={acopioForm.fecha}
                      onChange={e => setAcopioForm(f => ({ ...f, fecha: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Notas</label>
                  <textarea rows={2} value={acopioForm.notas}
                    onChange={e => setAcopioForm(f => ({ ...f, notas: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
                </div>
                {acopioError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{acopioError}</div>
                )}
                <p className="text-[11px] text-slate-400">
                  Esto registra el pago como un gasto ya pagado. El saldo se descuenta a medida que registrás retiros.
                </p>
              </form>
            </div>
            <div className="p-6 border-t border-slate-100 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3">
              <button type="button" onClick={() => setShowAcopioForm(false)}
                className="flex-1 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button type="submit" form="acopio-form" disabled={acopioLoading}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
                           text-white rounded-xl text-sm font-semibold">
                {acopioLoading ? 'Guardando...' : 'Crear acopio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Registrar retiro */}
      {retiroAcopio && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="font-bold text-slate-900">Registrar retiro</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  ACO-{retiroAcopio.numero} · Saldo actual: {saldoDeAcopio(retiroAcopio.id)} {retiroAcopio.productos?.unidad_medida ?? ''}
                </p>
              </div>
              <button onClick={() => setRetiroAcopio(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleSubmitRetiro} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Producto retirado *</label>
                {retiroForm.creandoNuevo ? (
                  <div className="flex gap-2">
                    <input autoFocus placeholder="Nombre del producto" value={retiroForm.nuevoNombre}
                      onChange={e => setRetiroForm(f => ({ ...f, nuevoNombre: e.target.value }))}
                      className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    <input placeholder="Unidad" value={retiroForm.nuevoUnidad}
                      onChange={e => setRetiroForm(f => ({ ...f, nuevoUnidad: e.target.value }))}
                      className="w-24 shrink-0 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    <button type="button" onClick={crearProductoParaRetiro}
                      disabled={retiroLoading || !retiroForm.nuevoNombre.trim()}
                      className="shrink-0 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium">
                      Crear
                    </button>
                    <button type="button" onClick={() => setRetiroForm(f => ({ ...f, creandoNuevo: false, nuevoNombre: '', nuevoUnidad: 'unidad' }))}
                      className="shrink-0 text-slate-400 hover:text-slate-600 px-1">✕</button>
                  </div>
                ) : (
                  <select value={retiroForm.producto_id}
                    onChange={e => e.target.value === '__nuevo__'
                      ? setRetiroForm(f => ({ ...f, creandoNuevo: true, producto_id: '' }))
                      : setRetiroForm(f => ({ ...f, producto_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">Elegir...</option>
                    {productosDisponibles.map(p => <option key={p.id} value={p.id}>{p.nombre} ({p.unidad_medida})</option>)}
                    <option value="__nuevo__">+ Agregar producto nuevo</option>
                  </select>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Cantidad *</label>
                <input required type="number" min="0" step="0.01" value={retiroForm.cantidad}
                  onChange={e => setRetiroForm(f => ({ ...f, cantidad: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              {retiroForm.producto_id && retiroForm.producto_id !== retiroAcopio.producto_referencia_id && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div>
                    <label className="block text-xs font-medium text-amber-800 mb-1">Precio de hoy de lo retirado *</label>
                    <input required type="number" min="0" step="0.01" value={retiroForm.precio_retiro}
                      onChange={e => setRetiroForm(f => ({ ...f, precio_retiro: e.target.value }))}
                      className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-amber-800 mb-1">Precio de hoy del producto de referencia *</label>
                    <input required type="number" min="0" step="0.01" value={retiroForm.precio_referencia}
                      onChange={e => setRetiroForm(f => ({ ...f, precio_referencia: e.target.value }))}
                      className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <p className="col-span-2 text-[11px] text-amber-700">
                    Como no es el producto de referencia del acopio, hace falta convertir: se descuenta (cantidad × precio retirado) ÷ precio de referencia.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Proyecto destino</label>
                <select value={retiroForm.obra_id} onChange={e => setRetiroForm(f => ({ ...f, obra_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">Empresa (pool)</option>
                  {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notas</label>
                <input value={retiroForm.notas} onChange={e => setRetiroForm(f => ({ ...f, notas: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {retiroError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{retiroError}</div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setRetiroAcopio(null)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                  Cancelar
                </button>
                <button type="submit" disabled={retiroLoading}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {retiroLoading ? 'Guardando...' : 'Registrar retiro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  )
}
