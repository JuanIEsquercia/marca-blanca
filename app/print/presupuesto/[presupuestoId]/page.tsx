import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import PrintToolbar from '@/components/admin/PrintToolbar'
import { formatCurrency } from '@/lib/utils'

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
  const hoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const fechaPresupuesto = new Date(presupuesto.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const fmtFecha = (d: string | null) => d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null
  const fechaInicio = fmtFecha(presupuesto.fecha_inicio)
  const fechaFin = fmtFecha(presupuesto.fecha_fin_estimada)

  const items = [...(presupuesto.presupuesto_items ?? [])].sort((a, b) => a.orden - b.orden)
  const total = items.reduce((s, i) => s + i.subtotal, 0)

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 25mm 20mm 30mm 20mm; }
          body { font-size: 11pt; }
        }
        body { font-family: 'Times New Roman', Times, serif; background: #f5f5f5; }
        .doc { background: white; max-width: 210mm; margin: 0 auto; }
        table.items th, table.items td { padding: 6px 8px; }
      `}</style>

      <PrintToolbar title="Vista previa — Presupuesto" />

      <div className="doc p-[20mm] min-h-screen">

        {/* Encabezado */}
        <div className="text-center mb-8 pb-6 border-b border-gray-300">
          <p className="text-2xl font-bold tracking-tight">{constructoraNombre}</p>
          <p className="text-xs uppercase tracking-widest text-gray-400 mt-1">Presupuesto</p>
        </div>

        {/* Datos generales */}
        <div className="mb-6 flex justify-between text-sm">
          <div className="space-y-1.5">
            <p><span className="font-semibold">Cliente:</span> {presupuesto.cliente_nombre}</p>
            {presupuesto.cliente_cuit && <p><span className="font-semibold">CUIT:</span> {presupuesto.cliente_cuit}</p>}
            {presupuesto.cliente_email && <p><span className="font-semibold">Email:</span> {presupuesto.cliente_email}</p>}
            {presupuesto.cliente_telefono && <p><span className="font-semibold">Teléfono:</span> {presupuesto.cliente_telefono}</p>}
          </div>
          <div className="space-y-1.5 text-right">
            <p><span className="font-semibold">Fecha:</span> {fechaPresupuesto}</p>
            <p><span className="font-semibold">Estado:</span> {ESTADO_LABEL[presupuesto.estado] ?? presupuesto.estado}</p>
            {obraNombre && <p><span className="font-semibold">Proyecto:</span> {obraNombre}</p>}
          </div>
        </div>

        {(fechaInicio || fechaFin) && (
          <p className="mb-6 text-sm">
            <span className="font-semibold">Plazo estimado:</span>{' '}
            {fechaInicio && <>inicio {fechaInicio}</>}
            {fechaInicio && fechaFin && ' — '}
            {fechaFin && <>finalización estimada {fechaFin}</>}
          </p>
        )}

        {/* Descripción */}
        {presupuesto.descripcion && (
          <div className="mb-6">
            <p className="font-semibold text-sm mb-1 border-b border-gray-200 pb-1">Descripción del trabajo</p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{presupuesto.descripcion}</p>
          </div>
        )}

        {/* Ítems */}
        <table className="items w-full text-sm border-collapse mb-2">
          <thead>
            <tr className="border-b-2 border-gray-400 text-left">
              <th className="w-8">#</th>
              <th>Rubro</th>
              <th className="text-right">Cantidad</th>
              <th className="text-right">Precio unitario</th>
              <th className="text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id} className="border-b border-gray-200">
                <td className="text-gray-500">{i + 1}</td>
                <td>{item.rubro}</td>
                <td className="text-right">{item.cantidad} {item.unidad ?? ''}</td>
                <td className="text-right">{formatCurrency(item.precio_unitario, presupuesto.moneda)}</td>
                <td className="text-right font-medium">{formatCurrency(item.subtotal, presupuesto.moneda)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mb-10">
          <div className="text-right">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Total</p>
            <p className="text-xl font-bold">{formatCurrency(total, presupuesto.moneda)}</p>
          </div>
        </div>

        {presupuesto.notas && (
          <div className="mb-10">
            <p className="font-semibold text-sm mb-1 border-b border-gray-200 pb-1">Notas</p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{presupuesto.notas}</p>
          </div>
        )}

        <p className="text-xs text-gray-400 mt-16">Presupuesto emitido el {hoy}. Sujeto a aprobación — no válido como factura.</p>

      </div>
    </>
  )
}
