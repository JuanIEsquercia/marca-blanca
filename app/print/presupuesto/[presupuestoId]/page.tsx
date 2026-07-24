import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import PrintToolbar from '@/components/admin/PrintToolbar'
import { formatCurrency, formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const ESTADO_LABEL: Record<string, string> = {
  borrador: 'Borrador',
  enviado: 'Enviado',
  aceptado: 'Aceptado',
  rechazado: 'Rechazado',
}

export default async function PrintPresupuestoPage({ params }: { params: Promise<{ presupuestoId: string }> }) {
  const { presupuestoId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')

  const admin = createAdminClient()

  const { data: presupuesto } = await admin
    .from('presupuestos')
    .select('*, presupuesto_items(*), constructoras(nombre), obras(nombre)')
    .eq('id', presupuestoId)
    .maybeSingle()

  if (!presupuesto || presupuesto.constructora_id !== ctx.constructoraId) redirect('/admin/presupuestos')

  const constructoraNombre = (presupuesto.constructoras as unknown as { nombre: string } | null)?.nombre ?? 'Constructora'
  const obraNombre = (presupuesto.obras as unknown as { nombre: string } | null)?.nombre ?? null
  const hoy = formatDate(new Date().toISOString())
  const fechaPresupuesto = formatDate(presupuesto.created_at)
  const fechaInicio = presupuesto.fecha_inicio ? formatDate(presupuesto.fecha_inicio) : null
  const fechaFin = presupuesto.fecha_fin_estimada ? formatDate(presupuesto.fecha_fin_estimada) : null
  const codigo = presupuesto.id.slice(0, 8).toUpperCase()

  const items = [...(presupuesto.presupuesto_items ?? [])].sort((a, b) => a.orden - b.orden)
  const total = items.reduce((s, i) => s + i.subtotal, 0)

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 20mm 18mm 22mm 18mm; }
          body { background: white; }
        }
        body {
          font-family: Georgia, 'Times New Roman', serif;
          background: #eef0f3;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .doc { background: white; max-width: 210mm; margin: 0 auto; }
        .sans { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; }
        .label { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 9.5px; letter-spacing: 0.07em; text-transform: uppercase; color: #8891a0; }
        .num { font-variant-numeric: tabular-nums; }
        table.items thead th { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: #4a3f9e; }
        table.items tbody tr:nth-child(even) { background: #fafafe; }
      `}</style>

      <PrintToolbar title="Vista previa — Presupuesto" />

      <div className="doc p-[18mm] min-h-screen">

        {/* Encabezado */}
        <div className="flex items-start justify-between pb-6 mb-8 border-b-2" style={{ borderColor: '#4338ca' }}>
          <div>
            <p className="text-[26px] font-bold tracking-tight leading-tight">{constructoraNombre}</p>
            {obraNombre && <p className="sans text-[11px] text-gray-500 mt-1">Proyecto: {obraNombre}</p>}
          </div>
          <div className="text-right shrink-0 pl-6">
            <p className="sans text-[10px] uppercase tracking-[0.15em]" style={{ color: '#4338ca' }}>Presupuesto</p>
            <p className="sans text-[11px] text-gray-400 mt-1">N.º {codigo}</p>
          </div>
        </div>

        {/* Datos generales */}
        <div className="grid grid-cols-2 gap-8 mb-7">
          <div>
            <p className="label mb-2">Cliente</p>
            <p className="text-[15px] font-semibold leading-snug">{presupuesto.cliente_nombre}</p>
            <div className="sans text-[11.5px] text-gray-600 mt-1.5 space-y-0.5">
              {presupuesto.cliente_cuit && <p>CUIT {presupuesto.cliente_cuit}</p>}
              {presupuesto.cliente_email && <p>{presupuesto.cliente_email}</p>}
              {presupuesto.cliente_telefono && <p>{presupuesto.cliente_telefono}</p>}
            </div>
          </div>
          <div className="text-right">
            <div className="inline-flex flex-col items-end">
              <p className="label mb-2">Detalle</p>
              <table className="sans text-[11.5px] text-right">
                <tbody>
                  <tr>
                    <td className="text-gray-400 pr-3 py-0.5">Emitido</td>
                    <td className="font-medium">{fechaPresupuesto}</td>
                  </tr>
                  <tr>
                    <td className="text-gray-400 pr-3 py-0.5">Estado</td>
                    <td className="font-medium">{ESTADO_LABEL[presupuesto.estado] ?? presupuesto.estado}</td>
                  </tr>
                  {(fechaInicio || fechaFin) && (
                    <tr>
                      <td className="text-gray-400 pr-3 py-0.5 align-top">Plazo</td>
                      <td className="font-medium">
                        {fechaInicio && <>{fechaInicio}</>}
                        {fechaInicio && fechaFin && ' – '}
                        {fechaFin && <>{fechaFin}</>}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Descripción */}
        {presupuesto.descripcion && (
          <div className="mb-7 pt-5 border-t border-gray-200">
            <p className="label mb-2">Descripción del trabajo</p>
            <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{presupuesto.descripcion}</p>
          </div>
        )}

        {/* Ítems */}
        <table className="items w-full text-[12px] border-collapse mb-0 mt-2">
          <thead>
            <tr style={{ background: '#f4f3fc' }}>
              <th className="w-9 text-left py-2.5 pl-3">#</th>
              <th className="text-left py-2.5">Rubro</th>
              <th className="text-right py-2.5">Cantidad</th>
              <th className="text-right py-2.5">Precio unitario</th>
              <th className="text-right py-2.5 pr-3">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id} className="border-b border-gray-100">
                <td className="text-gray-400 py-2 pl-3 num">{i + 1}</td>
                <td className="py-2 font-medium">{item.rubro}</td>
                <td className="text-right py-2 num">{item.cantidad} <span className="text-gray-400">{item.unidad ?? ''}</span></td>
                <td className="text-right py-2 num">{formatCurrency(item.precio_unitario, presupuesto.moneda)}</td>
                <td className="text-right py-2 pr-3 num font-medium">{formatCurrency(item.subtotal, presupuesto.moneda)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mb-10">
          <div className="flex items-baseline gap-4 px-5 py-3.5 rounded-sm" style={{ background: '#4338ca' }}>
            <p className="sans text-[10px] uppercase tracking-[0.1em] text-indigo-200">Total</p>
            <p className="text-[22px] font-bold text-white num">{formatCurrency(total, presupuesto.moneda)}</p>
          </div>
        </div>

        {presupuesto.notas && (
          <div className="mb-10 pt-5 border-t border-gray-200">
            <p className="label mb-2">Notas</p>
            <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{presupuesto.notas}</p>
          </div>
        )}

        <p className="sans text-[10px] text-gray-400 mt-16 pt-4 border-t border-gray-100">
          Presupuesto emitido el {hoy}. Sujeto a aprobación — no válido como factura.
        </p>

      </div>
    </>
  )
}
