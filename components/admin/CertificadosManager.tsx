'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, redondear2 } from '@/lib/utils'
import { obtenerOCrearRubro } from '@/lib/rubros'
import ClienteYFechasForm, { EMPTY_DATOS_GENERALES, type DatosGenerales } from './ClienteYFechasForm'
import ItemsRubroTable, { nuevaFilaItem, totalFilasItem, type FilaItem } from './ItemsRubroTable'
import ContratoObraCard from './ContratoObraCard'
import type { ContratoObra, CertificadoAvance, CobroProyecto, Gasto, CuentaPropia, ContratoObraItem, CertificadoItem, Proveedor, TipoContratoObra } from '@/types/database'

type CertificadoConMov = CertificadoAvance & { cobros_proyecto?: CobroProyecto[]; pagos?: Gasto[]; certificado_items?: CertificadoItem[] }

interface Props {
  contratos: ContratoObra[]
  certificados: CertificadoConMov[]
  contratoObraItems?: ContratoObraItem[]
  proveedores?: Proveedor[]
  cuentasPropias: CuentaPropia[]
  constructoraId: string
  obraId: string
  readOnly?: boolean
  rubros?: string[]
}

export default function CertificadosManager({ contratos, certificados, contratoObraItems = [], proveedores = [], cuentasPropias, constructoraId, obraId, readOnly = false, rubros = [] }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showContratoForm, setShowContratoForm] = useState(contratos.length === 0)
  // Una obra puede tener más de un contrato con el cliente (etapas
  // firmadas por separado) — no hay tope, a diferencia de subcontratistas
  // que tampoco lo tienen.
  const [contratoTipo, setContratoTipo] = useState<TipoContratoObra>('cliente')
  const [contratoProveedorId, setContratoProveedorId] = useState('')
  const [contratoForm, setContratoForm] = useState<DatosGenerales>(EMPTY_DATOS_GENERALES)
  const [contratoFilas, setContratoFilas] = useState<FilaItem[]>([nuevaFilaItem()])
  const totalContratoFilas = totalFilasItem(contratoFilas)

  function refresh() { startTransition(() => router.refresh()) }

  // Agrupa certificados/ítems (que llegan planos, de todos los contratos del
  // proyecto) por contrato — cada ContratoObraCard solo ve lo suyo.
  const certificadosPorContrato = useMemo(() => {
    const map = new Map<string, CertificadoConMov[]>()
    for (const c of certificados) {
      const lista = map.get(c.contrato_obra_id) ?? []
      lista.push(c)
      map.set(c.contrato_obra_id, lista)
    }
    return map
  }, [certificados])

  const itemsPorContrato = useMemo(() => {
    const map = new Map<string, ContratoObraItem[]>()
    for (const i of contratoObraItems) {
      const lista = map.get(i.contrato_obra_id) ?? []
      lista.push(i)
      map.set(i.contrato_obra_id, lista)
    }
    return map
  }, [contratoObraItems])

  function abrirNuevoContrato() {
    setContratoTipo('cliente')
    setContratoProveedorId('')
    setContratoForm(EMPTY_DATOS_GENERALES)
    setContratoFilas([nuevaFilaItem()])
    setError(null)
    setShowContratoForm(true)
  }

  async function handleContratoSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (contratoTipo === 'subcontratista' && !contratoProveedorId) {
      setError('Elegí un proveedor')
      return
    }

    setLoading(true)
    const supabase = createClient()

    let clienteId: string | null = null
    if (contratoTipo === 'cliente') {
      // Buscar o crear cliente (misma entidad `compradores` que usa el flujo
      // DESARROLLO — mismo patrón de dedupe por CUIT que SaleForm/ReservaForm).
      const cuit = contratoForm.cliente_cuit.trim() || null
      if (cuit) {
        const { data: existente } = await supabase
          .from('compradores')
          .select('id')
          .eq('constructora_id', constructoraId)
          .eq('dni_cuit', cuit)
          .maybeSingle()
        clienteId = existente?.id ?? null
      }
      if (!clienteId) {
        const { data: nuevoCliente, error: errCliente } = await supabase
          .from('compradores')
          .insert({
            constructora_id: constructoraId,
            nombre_completo: contratoForm.cliente_nombre.trim(),
            dni_cuit: cuit,
            email: contratoForm.cliente_email.trim() || null,
            telefono: contratoForm.cliente_telefono.trim() || null,
          })
          .select('id')
          .single()
        if (errCliente || !nuevoCliente) {
          setLoading(false)
          setError(errCliente?.message ?? 'Error al crear el cliente')
          return
        }
        clienteId = nuevoCliente.id
      }
    }

    // monto_total arranca en 0 — lo fija solo el trigger
    // recalcular_monto_total_contrato apenas se insertan los ítems abajo.
    const { data, error: err } = await supabase
      .from('contratos_obra')
      .insert({
        obra_id: obraId,
        constructora_id: constructoraId,
        tipo: contratoTipo,
        cliente_id: contratoTipo === 'cliente' ? clienteId : null,
        proveedor_id: contratoTipo === 'subcontratista' ? contratoProveedorId : null,
        monto_total: 0,
        moneda: contratoForm.moneda,
        fecha_inicio: contratoForm.fecha_inicio || null,
        fecha_fin_estimada: contratoForm.fecha_fin_estimada || null,
        descripcion: contratoForm.descripcion.trim() || null,
      })
      .select('id')
      .single()
    if (err || !data) { setLoading(false); setError(err?.message ?? 'Error al crear el contrato'); return }

    const filasValidas = contratoFilas.filter(f => f.rubro.trim() && f.precio_unitario)
    if (filasValidas.length > 0) {
      const rubrosCanonicos = await Promise.all(filasValidas.map(f => obtenerOCrearRubro(supabase, constructoraId, f.rubro)))
      const { error: errItems } = await supabase.from('contrato_obra_items').insert(
        filasValidas.map((f, i) => ({
          contrato_obra_id: data.id,
          constructora_id: constructoraId,
          orden: i,
          rubro: rubrosCanonicos[i],
          unidad: f.unidad.trim() || null,
          cantidad: redondear2(parseFloat(f.cantidad) || 1),
          precio_unitario: redondear2(parseFloat(f.precio_unitario)),
          origen: 'directo',
        }))
      )
      if (errItems) {
        // Compensar: no dejar un contrato sin ítems (monto_total=0) colgado.
        await supabase.from('contratos_obra').delete().eq('id', data.id)
        setLoading(false)
        setError(errItems.message)
        return
      }
    }

    setLoading(false)
    setShowContratoForm(false)
    refresh()
  }

  return (
    <div className="space-y-6">
      {contratos.length === 0 && !showContratoForm ? null : (
        <>
          {contratos.map(contrato => (
            <ContratoObraCard
              key={contrato.id}
              contrato={contrato}
              certificados={certificadosPorContrato.get(contrato.id) ?? []}
              contratoObraItems={itemsPorContrato.get(contrato.id) ?? []}
              cuentasPropias={cuentasPropias}
              constructoraId={constructoraId}
              obraId={obraId}
              readOnly={readOnly}
              rubros={rubros}
              onChanged={refresh}
            />
          ))}
        </>
      )}

      {!readOnly && !showContratoForm && (
        <button onClick={abrirNuevoContrato}
          className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-slate-300 hover:border-indigo-300 hover:bg-indigo-50/50 text-slate-500 hover:text-indigo-600 rounded-2xl text-sm font-medium transition-colors w-full justify-center">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {contratos.length === 0 ? 'Cargar contrato de obra' : 'Agregar otro contrato'}
        </button>
      )}

      {showContratoForm && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Nuevo contrato</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {contratos.length === 0
                ? 'Cargá el contrato con el cliente para comenzar a emitir certificados'
                : 'Con el cliente (entra plata) o con un subcontratista (sale plata) — cada uno certifica y se paga por separado'}
            </p>
          </div>
          <form onSubmit={handleContratoSubmit} className="p-6 space-y-4">
            <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
              <button type="button" onClick={() => setContratoTipo('cliente')}
                className={cn('flex-1 px-3 py-2 transition-colors',
                  contratoTipo === 'cliente' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>
                Contrato con el cliente
              </button>
              <button type="button" onClick={() => setContratoTipo('subcontratista')}
                className={cn('flex-1 px-3 py-2 transition-colors',
                  contratoTipo === 'subcontratista' ? 'bg-amber-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>
                Subcontratista
              </button>
            </div>
            {contratoTipo === 'cliente' && contratos.some(c => c.tipo === 'cliente') && (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                Este proyecto ya tiene {contratos.filter(c => c.tipo === 'cliente').length} contrato(s) con el cliente — este se suma como otra etapa, no los reemplaza.
              </p>
            )}

            {contratoTipo === 'subcontratista' ? (
              proveedores.length === 0 ? (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Todavía no tenés proveedores cargados — creá uno en <strong>Proveedores</strong> primero.
                </p>
              ) : (
                <ClienteYFechasForm
                  form={contratoForm}
                  onChange={setContratoForm}
                  descripcionLabel="Descripción del trabajo subcontratado"
                  identidad={
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Proveedor *</label>
                      <select required value={contratoProveedorId} onChange={e => setContratoProveedorId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="">Elegir proveedor...</option>
                        {proveedores.map(p => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
                      </select>
                    </div>
                  }
                />
              )
            ) : (
              <ClienteYFechasForm form={contratoForm} onChange={setContratoForm} descripcionLabel="Descripción del objeto del contrato" />
            )}

            <ItemsRubroTable filas={contratoFilas} onChange={setContratoFilas} moneda={contratoForm.moneda} titulo="Ítems del contrato" rubros={rubros} />

            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-3 justify-end">
              {contratos.length > 0 && (
                <button type="button" onClick={() => setShowContratoForm(false)}
                  className="px-5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                  Cancelar
                </button>
              )}
              <button type="submit" disabled={loading || totalContratoFilas <= 0 || (contratoTipo === 'subcontratista' && proveedores.length === 0)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg disabled:opacity-60">
                {loading ? 'Guardando...' : 'Crear contrato'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
