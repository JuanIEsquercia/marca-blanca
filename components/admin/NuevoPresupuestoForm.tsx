'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { redondear2 } from '@/lib/utils'
import { obtenerOCrearRubro } from '@/lib/rubros'
import ClienteYFechasForm, { EMPTY_DATOS_GENERALES, ivaPctDeDatosGenerales, type DatosGenerales } from './ClienteYFechasForm'
import ItemsRubroTable, { nuevaFilaItem, type FilaItem } from './ItemsRubroTable'
import type { Comprador } from '@/types/database'

interface Props {
  constructoraId: string
  rubros?: string[]
  compradores?: Pick<Comprador, 'id' | 'nombre_completo' | 'dni_cuit' | 'email' | 'telefono'>[]
}

export default function NuevoPresupuestoForm({ constructoraId, rubros = [], compradores = [] }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<DatosGenerales>(EMPTY_DATOS_GENERALES)
  const [filas, setFilas] = useState<FilaItem[]>([nuevaFilaItem()])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.cliente_nombre.trim()) return
    setLoading(true)
    setError(null)
    const supabase = createClient()

    // presupuestos no tiene FK a compradores (guarda el cliente como
    // texto) — pero si se eligió uno existente y se pidió actualizarlo,
    // sincronizamos igual ese registro para que quede al día en Clientes.
    if (form.comprador_id && form.actualizar_comprador) {
      const { error: errUpdate } = await supabase.from('compradores').update({
        nombre_completo: form.cliente_nombre.trim(),
        dni_cuit: form.cliente_cuit.trim() || null,
        email: form.cliente_email.trim() || null,
        telefono: form.cliente_telefono.trim() || null,
      }).eq('id', form.comprador_id)
      if (errUpdate) { setLoading(false); setError(errUpdate.message); return }
    }

    const { data: nuevo, error: err } = await supabase
      .from('presupuestos')
      .insert({
        constructora_id: constructoraId,
        cliente_nombre: form.cliente_nombre.trim(),
        cliente_cuit: form.cliente_cuit.trim() || null,
        cliente_email: form.cliente_email.trim() || null,
        cliente_telefono: form.cliente_telefono.trim() || null,
        moneda: form.moneda,
        fecha_inicio: form.fecha_inicio || null,
        fecha_fin_estimada: form.fecha_fin_estimada || null,
        descripcion: form.descripcion.trim() || null,
        estado: 'borrador',
        iva_pct: ivaPctDeDatosGenerales(form),
      })
      .select('id')
      .single()

    if (err || !nuevo) { setLoading(false); setError(err?.message ?? 'Error al crear el presupuesto'); return }

    const filasValidas = filas.filter(f => f.rubro.trim() && f.precio_unitario)
    if (filasValidas.length > 0) {
      // Estandariza cada rubro contra el catálogo de la constructora antes
      // de guardar — ver lib/rubros.ts.
      const rubrosCanonicos = await Promise.all(
        filasValidas.map(f => obtenerOCrearRubro(supabase, constructoraId, f.rubro))
      )
      const { error: errItems } = await supabase.from('presupuesto_items').insert(
        filasValidas.map((f, i) => ({
          presupuesto_id: nuevo.id,
          constructora_id: constructoraId,
          orden: i,
          rubro: rubrosCanonicos[i],
          unidad: f.unidad.trim() || null,
          cantidad: redondear2(parseFloat(f.cantidad) || 1),
          precio_unitario: redondear2(parseFloat(f.precio_unitario)),
        }))
      )
      if (errItems) {
        // Compensar: no dejar un presupuesto vacío colgado si los ítems fallaron.
        await supabase.from('presupuestos').delete().eq('id', nuevo.id)
        setLoading(false)
        setError(errItems.message)
        return
      }
    }

    router.push('/admin/presupuestos')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Datos del cliente</h2>
        <ClienteYFechasForm form={form} onChange={setForm} descripcionLabel="Descripción del trabajo" compradores={compradores} />
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <ItemsRubroTable filas={filas} onChange={setFilas} moneda={form.moneda} titulo="Ítems del presupuesto" rubros={rubros} />
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-3">
        <Link href="/admin/presupuestos"
          className="px-5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors">
          Cancelar
        </Link>
        <button type="submit" disabled={loading}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold transition-colors">
          {loading ? 'Guardando...' : 'Crear presupuesto'}
        </button>
      </div>
    </form>
  )
}
