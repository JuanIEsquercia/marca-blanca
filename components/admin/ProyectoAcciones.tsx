'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { EstadoObra, TipoProyecto } from '@/types/database'

interface Props {
  obraId: string
  nombre: string
  tipo: TipoProyecto
  estadoActual: EstadoObra
  esAdmin: boolean
}

const PUEDE_REACTIVAR: EstadoObra[] = ['finalizada', 'pausada']

export default function ProyectoAcciones({ obraId, nombre, tipo, estadoActual, esAdmin }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmCierre, setConfirmCierre] = useState(false)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [accionError, setAccionError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  function refresh() { startTransition(() => router.refresh()) }

  // Cambiar estado y eliminar pasan por /api/admin/proyecto/[obraId] en vez
  // de llamar a Supabase directo desde el browser (como hacía antes). No es
  // por Firefox/CORS (esa fue una hipótesis inicial descartada) — la causa
  // real era que purgar_obra_completa() escaneaba tablas enteras por faltar
  // índices (migration_039.sql) y tardaba tanto que el fetch se cortaba del
  // lado del cliente ANTES de recibir respuesta, aunque el borrado seguía
  // corriendo solo en el servidor y terminaba completándose igual. Con los
  // índices puestos esto debería dejar de pasar en la práctica, pero el
  // manejo de error de acá se hace robusto igual: si el fetch se corta (no
  // llegó ninguna respuesta), no se sabe si la operación server-side terminó
  // o no, así que no se puede asumir que falló.
  async function llamarApiProyecto(method: 'PATCH' | 'DELETE', body?: object) {
    try {
      const res = await fetch(`/api/admin/proyecto/${obraId}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json()
      return res.ok
        ? { ok: true as const }
        : { ok: false as const, network: false as const, message: data.error ?? 'Error desconocido.' }
    } catch {
      // El fetch nunca completó (timeout/conexión cortada) — no es lo mismo
      // que un error real del servidor: no sabemos si la operación terminó
      // igual del otro lado.
      return { ok: false as const, network: true as const, message: 'Error de red — no se pudo contactar al servidor.' }
    }
  }

  // Tras un fallo de red (fetch cortado, no una respuesta de error real),
  // se vuelve a consultar el proyecto antes de mostrar el error: si ya no
  // existe, es porque el borrado sí se completó del lado del servidor
  // aunque el cliente no llegó a enterarse.
  async function seSiguioBorrando(): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/proyecto/${obraId}`)
      return res.status === 404
    } catch {
      return false
    }
  }

  async function cambiarEstado(nuevoEstado: EstadoObra) {
    setLoading(true)
    setAccionError(null)
    const result = await llamarApiProyecto('PATCH', { estado: nuevoEstado })
    setLoading(false)
    if (!result.ok) { setAccionError(result.message); return }
    setOpen(false)
    setConfirmCierre(false)
    refresh()
  }

  async function eliminar() {
    setLoading(true)
    setAccionError(null)
    let result = await llamarApiProyecto('DELETE')
    if (!result.ok && result.network && await seSiguioBorrando()) {
      result = { ok: true }
    }
    setLoading(false)
    if (!result.ok) { setAccionError(result.message); return }
    setConfirmDelete(false)
    refresh()
  }

  async function exportarDatos(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setOpen(false)
    setExporting(true)

    const XLSX = await import('xlsx')
    const supabase = createClient()
    const wb = XLSX.utils.book_new()

    function addSheet(nombreHoja: string, rows: Record<string, unknown>[]) {
      if (rows.length === 0) return
      const ws = XLSX.utils.json_to_sheet(rows)
      XLSX.utils.book_append_sheet(wb, ws, nombreHoja.slice(0, 31))
    }

    const labelUnidad = (u: { piso: number; numero: string; letra: string | null } | null) =>
      u ? `P${u.piso} - ${u.numero}${u.letra ?? ''}` : ''

    if (tipo === 'desarrollo') {
      const [
        { data: unidades },
        { data: tipologias },
        { data: amenities },
        { data: reservas },
        { data: contratos },
      ] = await Promise.all([
        supabase.from('unidades').select('*, tipologias(nombre, m2_totales)').eq('obra_id', obraId).order('piso').order('numero'),
        supabase.from('tipologias').select('*').eq('obra_id', obraId).order('nombre'),
        supabase.from('amenities').select('*, amenity_imagenes(id)').eq('obra_id', obraId).order('orden'),
        supabase.from('reservas').select('*, compradores(*), unidades(piso, numero, letra)').eq('obra_id', obraId).order('fecha_reserva', { ascending: false }),
        supabase.from('contratos_venta').select('*, compradores(*), unidades(piso, numero, letra), cuotas(*)').eq('obra_id', obraId).order('fecha_firma', { ascending: false }),
      ])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addSheet('Unidades', (unidades ?? []).map((u: any) => ({
        Piso: u.piso, Número: u.numero, Letra: u.letra ?? '', Orientación: u.orientacion ?? '',
        'm²': u.m2 ?? u.tipologias?.m2_totales ?? '', Tipología: u.tipologias?.nombre ?? '',
        'Precio lista': u.precio_lista, Estado: u.estado_comercial,
      })))

      addSheet('Tipologías', (tipologias ?? []).map(t => ({
        Nombre: t.nombre, 'm² propios': t.m2_propios, 'm² comunes': t.m2_comunes, 'm² totales': t.m2_totales,
        Descripción: t.descripcion ?? '',
      })))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addSheet('Amenities', (amenities ?? []).map((a: any) => ({
        Nombre: a.nombre, Descripción: a.descripcion ?? '', Orden: a.orden, Activo: a.activo ? 'Sí' : 'No',
        Fotos: a.amenity_imagenes?.length ?? 0,
      })))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addSheet('Reservas', (reservas ?? []).map((r: any) => ({
        Comprador: r.compradores?.nombre_completo ?? '', 'DNI/CUIT': r.compradores?.dni_cuit ?? '',
        Unidad: labelUnidad(r.unidades), 'Fecha reserva': r.fecha_reserva, 'Fecha vencimiento': r.fecha_vencimiento,
        'Monto seña': r.monto_sena ?? '', Estado: r.estado,
      })))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addSheet('Contratos de venta', (contratos ?? []).map((c: any) => ({
        Comprador: c.compradores?.nombre_completo ?? '', 'DNI/CUIT': c.compradores?.dni_cuit ?? '',
        Unidad: labelUnidad(c.unidades), 'Precio final': c.precio_final, 'Entrega efectiva': c.entrega_efectiva,
        'Fecha firma': c.fecha_firma, Notas: c.notas ?? '',
      })))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cuotas = (contratos ?? []).flatMap((c: any) => (c.cuotas ?? []).map((q: any) => ({
        Comprador: c.compradores?.nombre_completo ?? '', Unidad: labelUnidad(c.unidades),
        'N° cuota': q.numero_cuota, 'Monto base': q.monto_base, 'Monto cobrado': q.monto_cobrado ?? '',
        'Fecha vencimiento': q.fecha_vencimiento, Estado: q.estado_pago, 'Fecha pago': q.fecha_pago ?? '',
      })))
      addSheet('Cuotas', cuotas)
    } else {
      const [
        { data: contratoObra },
        { data: certificados },
        { data: cobros },
      ] = await Promise.all([
        supabase.from('contratos_obra').select('*, compradores(*), proveedores(razon_social)').eq('obra_id', obraId),
        supabase.from('certificados_avance').select('*').eq('obra_id', obraId).order('numero'),
        supabase.from('cobros_proyecto').select('*, certificados_avance(numero, periodo)').eq('obra_id', obraId).order('numero'),
      ])

      // migration_047: puede haber más de un contrato (cliente +
      // subcontratistas) — se listan todos, con quién es cada uno.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addSheet('Contrato de obra', (contratoObra ?? []).map((c: any) => ({
        Tipo: c.tipo === 'subcontratista' ? 'Subcontratista' : 'Cliente',
        'Cliente/Proveedor': c.compradores?.nombre_completo ?? c.proveedores?.razon_social ?? '', 'Monto total': c.monto_total, Moneda: c.moneda,
        'Fecha inicio': c.fecha_inicio ?? '', 'Fecha fin estimada': c.fecha_fin_estimada ?? '',
        Estado: c.estado, Descripción: c.descripcion ?? '',
      })))

      addSheet('Certificados', (certificados ?? []).map(c => ({
        'N°': c.numero, Período: c.periodo, '% avance': c.porcentaje_avance,
        'Monto certificado': c.monto_certificado, Estado: c.estado,
        'Fecha presentación': c.fecha_presentacion ?? '', 'Fecha aprobación': c.fecha_aprobacion ?? '',
        Notas: c.notas ?? '',
      })))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addSheet('Cobros', (cobros ?? []).map((c: any) => ({
        'N°': c.numero ?? '', Certificado: c.certificados_avance ? `N°${c.certificados_avance.numero} - ${c.certificados_avance.periodo}` : '',
        Monto: c.monto, Moneda: c.moneda, Estado: c.estado,
        'Fecha vencimiento': c.fecha_vencimiento ?? '', 'Fecha pago': c.fecha_pago ?? '', Notas: c.notas ?? '',
      })))
    }

    const [{ data: gastos }, { data: cuentas }] = await Promise.all([
      supabase.from('gastos').select('*, proveedores(razon_social), categorias_costo(nombre)').eq('obra_id', obraId).order('fecha_vencimiento', { ascending: false }),
      supabase.from('cuentas_propias').select('*').eq('obra_id', obraId).order('nombre'),
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addSheet('Gastos', (gastos ?? []).map((g: any) => ({
      Descripción: g.descripcion, Monto: g.monto, Moneda: g.moneda,
      Proveedor: g.proveedores?.razon_social ?? '', Categoría: g.categorias_costo?.nombre ?? '',
      'Fecha vencimiento': g.fecha_vencimiento, 'Fecha pago': g.fecha_pago ?? '', Estado: g.estado,
    })))

    addSheet('Cuentas', (cuentas ?? []).map(c => ({
      Nombre: c.nombre, Tipo: c.tipo, Moneda: c.moneda, 'Saldo inicial': c.saldo_inicial,
      Activa: c.activa ? 'Sí' : 'No',
    })))

    const fecha = new Date().toISOString().split('T')[0]
    const slug = nombre.trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    XLSX.writeFile(wb, `${slug || 'proyecto'}_${fecha}.xlsx`)

    setExporting(false)
  }

  return (
    <>
      {/* Botón de 3 puntos — stop propagation para no activar el Link padre */}
      <div ref={ref} className="relative" onClick={e => e.preventDefault()}>
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(v => !v) }}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          title="Acciones del proyecto">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 top-8 z-30 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-44 text-sm">
            <button
              onClick={exportarDatos}
              disabled={exporting}
              className="w-full text-left px-4 py-2 hover:bg-slate-50 text-slate-700 disabled:opacity-60">
              {exporting ? 'Exportando...' : 'Exportar datos (Excel)'}
            </button>
            {esAdmin && (
              <>
                <div className="border-t border-slate-100 my-1" />
                {estadoActual === 'activa' && (
                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(false); setConfirmCierre(true) }}
                    className="w-full text-left px-4 py-2 hover:bg-slate-50 text-slate-700">
                    Cerrar proyecto
                  </button>
                )}
                {PUEDE_REACTIVAR.includes(estadoActual) && (
                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); cambiarEstado('activa') }}
                    className="w-full text-left px-4 py-2 hover:bg-emerald-50 text-emerald-700">
                    Reactivar
                  </button>
                )}
                <div className="border-t border-slate-100 my-1" />
                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(false); setConfirmDelete(true) }}
                  className="w-full text-left px-4 py-2 hover:bg-red-50 text-red-600">
                  Eliminar
                </button>
              </>
            )}
            {accionError && (
              <p className="px-4 py-2 text-xs text-red-600 border-t border-slate-100">{accionError}</p>
            )}
          </div>
        )}
      </div>

      {/* Modal: confirmar cierre — en portal, fuera del <Link> de la tarjeta.
          Aunque sea position:fixed, en el DOM seguía siendo descendiente del
          <a> de la tarjeta; confiar en stopPropagation() para que un click
          acá adentro no dispare la navegación del Link resultó frágil en
          producción (el usuario terminaba "entrando" al proyecto en vez de
          eliminarlo). El portal saca el modal del árbol del Link del todo. */}
      {confirmCierre && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={e => { e.preventDefault(); e.stopPropagation() }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Cerrar proyecto</h2>
            <p className="text-sm text-slate-600 mb-6">
              ¿Marcar <strong>{nombre}</strong> como finalizado? El proyecto quedará de solo lectura.
              Podés reactivarlo en cualquier momento.
            </p>
            {accionError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">{accionError}</div>
            )}
            <div className="flex gap-3">
              <button onClick={e => { e.preventDefault(); e.stopPropagation(); setConfirmCierre(false) }}
                className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={e => { e.preventDefault(); e.stopPropagation(); cambiarEstado('finalizada') }} disabled={loading}
                className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                {loading ? 'Cerrando...' : 'Cerrar proyecto'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: confirmar eliminación — mismo motivo, en portal */}
      {confirmDelete && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={e => { e.preventDefault(); e.stopPropagation() }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Eliminar proyecto</h2>
            <p className="text-sm text-slate-600 mb-1">
              ¿Eliminar <strong>{nombre}</strong>? Esta acción eliminará todos sus datos:
            </p>
            <ul className="text-xs text-slate-500 mb-6 list-disc list-inside space-y-0.5">
              <li>Contratos, certificados y cobros</li>
              <li>Unidades, tipologías y ventas</li>
              <li>Gastos, equipos asignados y presupuestos vinculados</li>
            </ul>
            <p className="text-xs text-slate-400 mb-4 -mt-4">
              Las cuentas propias específicas del proyecto no se eliminan: pasan a ser cuentas de empresa.
            </p>
            <button onClick={e => { e.preventDefault(); e.stopPropagation(); exportarDatos(e) }} disabled={exporting}
              className="w-full mb-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60 flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
              </svg>
              {exporting ? 'Descargando...' : 'Descargar Excel antes de eliminar'}
            </button>
            {accionError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">{accionError}</div>
            )}
            <div className="flex gap-3">
              <button onClick={e => { e.preventDefault(); e.stopPropagation(); setConfirmDelete(false) }}
                className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={e => { e.preventDefault(); e.stopPropagation(); eliminar() }} disabled={loading}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                {loading ? 'Eliminando...' : 'Eliminar definitivamente'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
