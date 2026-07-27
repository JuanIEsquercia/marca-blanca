'use client'

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
  moneda: string
  fecha_inicio: string
  fecha_fin_estimada: string
  descripcion: string
}

export const EMPTY_DATOS_GENERALES: DatosGenerales = {
  cliente_nombre: '', cliente_cuit: '', cliente_email: '', cliente_telefono: '',
  moneda: 'ARS', fecha_inicio: '', fecha_fin_estimada: '', descripcion: '',
}

interface Props {
  form: DatosGenerales
  onChange: (form: DatosGenerales) => void
  descripcionLabel?: string
  // Reemplaza el bloque cliente_nombre/cuit/email/telefono por otra cosa
  // (ej. un selector de proveedor, para un contrato de subcontratista) —
  // moneda/fechas/descripción se muestran siempre, son comunes a los dos casos.
  identidad?: React.ReactNode
}

export default function ClienteYFechasForm({ form, onChange, descripcionLabel = 'Descripción', identidad }: Props) {
  function set<K extends keyof DatosGenerales>(campo: K, valor: DatosGenerales[K]) {
    onChange({ ...form, [campo]: valor })
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {identidad ?? (
        <>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Cliente *</label>
            <input required value={form.cliente_nombre} onChange={e => set('cliente_nombre', e.target.value)}
              placeholder="Razón social o nombre"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">CUIT</label>
            <input value={form.cliente_cuit} onChange={e => set('cliente_cuit', e.target.value)}
              placeholder="20-12345678-9"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
            <input type="email" value={form.cliente_email} onChange={e => set('cliente_email', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
            <input value={form.cliente_telefono} onChange={e => set('cliente_telefono', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </>
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
      <div className="md:col-span-2">
        <label className="block text-xs font-medium text-slate-600 mb-1">{descripcionLabel}</label>
        <textarea rows={2} value={form.descripcion} onChange={e => set('descripcion', e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>
    </div>
  )
}
