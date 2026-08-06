'use client'

import ClienteSelect from './ClienteSelect'
import type { Comprador } from '@/types/database'

// Bloque de datos generales compartido entre NuevoPresupuestoForm y la
// creación de contrato en CertificadosManager — mismo orden de campos
// en los dos lugares, garantizado por ser el mismo componente (antes
// eran dos grids independientes que ya habían divergido en orden y en
// qué campos existían: el contrato tenía fecha_inicio/fecha_fin_estimada
// y el presupuesto no).

export type DatosGenerales = {
  cliente_nombre: string
  cliente_cuit: string
  cliente_email: string
  cliente_telefono: string
  // Se completan vía ClienteSelect — ver ese componente para el detalle.
  // Presupuestos no tiene FK a compradores (guarda los 4 campos de arriba
  // como texto), así que comprador_id acá solo sirve para decidir, en el
  // submit, si hay que además actualizar el registro de compradores del
  // que se copiaron los datos.
  comprador_id: string | null
  actualizar_comprador: boolean
  moneda: string
  fecha_inicio: string
  fecha_fin_estimada: string
  descripcion: string
  iva_modo: '0' | '10.5' | '21' | 'personalizado'
  iva_pct_personalizado: string
}

export const EMPTY_DATOS_GENERALES: DatosGenerales = {
  cliente_nombre: '', cliente_cuit: '', cliente_email: '', cliente_telefono: '',
  comprador_id: null, actualizar_comprador: false,
  moneda: 'ARS', fecha_inicio: '', fecha_fin_estimada: '', descripcion: '',
  iva_modo: '0', iva_pct_personalizado: '',
}

// Convierte el modo elegido acá a lo que se guarda en `iva_pct` (nullable
// = sin IVA) — mismos presets que IvaCalculator.tsx, para que el % quede
// precargado al generar el primer cobro/gasto desde un certificado.
export function ivaPctDeDatosGenerales(form: DatosGenerales): number | null {
  if (form.iva_modo === '0') return null
  if (form.iva_modo === 'personalizado') return parseFloat(form.iva_pct_personalizado) || null
  return parseFloat(form.iva_modo)
}

interface Props {
  form: DatosGenerales
  onChange: (form: DatosGenerales) => void
  descripcionLabel?: string
  // Reemplaza el bloque de cliente por otra cosa (ej. un selector de
  // proveedor, para un contrato de subcontratista) — moneda/fechas/
  // descripción se muestran siempre, son comunes a los dos casos.
  identidad?: React.ReactNode
  // Solo hace falta si no se pasa `identidad` — lista para ClienteSelect.
  compradores?: Pick<Comprador, 'id' | 'nombre_completo' | 'dni_cuit' | 'email' | 'telefono'>[]
}

export default function ClienteYFechasForm({ form, onChange, descripcionLabel = 'Descripción', identidad, compradores = [] }: Props) {
  function set<K extends keyof DatosGenerales>(campo: K, valor: DatosGenerales[K]) {
    onChange({ ...form, [campo]: valor })
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {identidad ?? (
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Cliente *</label>
          <ClienteSelect
            compradores={compradores}
            value={{
              compradorId: form.comprador_id,
              nombre: form.cliente_nombre,
              cuit: form.cliente_cuit,
              email: form.cliente_email,
              telefono: form.cliente_telefono,
              actualizarExistente: form.actualizar_comprador,
            }}
            onChange={v => onChange({
              ...form,
              comprador_id: v.compradorId,
              cliente_nombre: v.nombre,
              cliente_cuit: v.cuit,
              cliente_email: v.email,
              cliente_telefono: v.telefono,
              actualizar_comprador: v.actualizarExistente,
            })}
          />
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Moneda</label>
        <select value={form.moneda} onChange={e => set('moneda', e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="ARS">ARS — Pesos</option>
          <option value="USD">USD — Dólares</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Fecha inicio</label>
          <input type="date" value={form.fecha_inicio} onChange={e => set('fecha_inicio', e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Fin estimado</label>
          <input type="date" value={form.fecha_fin_estimada} onChange={e => set('fecha_fin_estimada', e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
      </div>
      <div className={form.iva_modo === 'personalizado' ? 'grid grid-cols-2 gap-4' : ''}>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Condición de IVA</label>
          <select value={form.iva_modo} onChange={e => set('iva_modo', e.target.value as DatosGenerales['iva_modo'])}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="0">Sin IVA</option>
            <option value="10.5">+ IVA 10.5%</option>
            <option value="21">+ IVA 21%</option>
            <option value="personalizado">Personalizado</option>
          </select>
        </div>
        {form.iva_modo === 'personalizado' && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">% de IVA</label>
            <input type="number" min="0" step="0.01" value={form.iva_pct_personalizado}
              onChange={e => set('iva_pct_personalizado', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        )}
      </div>
      <div className="md:col-span-2">
        <label className="block text-xs font-medium text-slate-600 mb-1">{descripcionLabel}</label>
        <textarea rows={2} value={form.descripcion} onChange={e => set('descripcion', e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>
    </div>
  )
}
