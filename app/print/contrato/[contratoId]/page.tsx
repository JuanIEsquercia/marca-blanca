import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import PrintToolbar from '@/components/admin/PrintToolbar'

export const dynamic = 'force-dynamic'

function fmt(n: number, moneda = 'ARS') {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda === 'USD' ? 'USD' : 'ARS',
    minimumFractionDigits: 2,
  }).format(n)
}

function fmtDate(d: string | null) {
  if (!d) return null
  return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default async function PrintContratoPage({ params }: { params: Promise<{ contratoId: string }> }) {
  const { contratoId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  const { data: contrato } = await admin
    .from('contratos_obra')
    .select('*, obras(nombre, constructoras(nombre))')
    .eq('id', contratoId)
    .maybeSingle()

  if (!contrato) redirect('/admin')

  const obraNombre = (contrato.obras as any)?.nombre ?? ''
  const constructoraNombre = (contrato.obras as any)?.constructoras?.nombre ?? 'Constructora'
  const hoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const fechaInicio = fmtDate(contrato.fecha_inicio)
  const fechaFin = fmtDate(contrato.fecha_fin_estimada)

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
        .firma-linea { border-top: 1px solid black; margin-top: 60px; padding-top: 8px; }
      `}</style>

      <PrintToolbar title="Vista previa — Acuerdo de obra" />

      <div className="doc p-[20mm] min-h-screen">

        {/* Encabezado */}
        <div className="text-center mb-8 pb-6 border-b border-gray-300">
          <p className="text-2xl font-bold tracking-tight">{constructoraNombre}</p>
          <p className="text-xs uppercase tracking-widest text-gray-400 mt-1">Acuerdo de obra</p>
        </div>

        {/* Fecha y partes */}
        <div className="mb-6 text-sm space-y-1.5">
          <p><span className="font-semibold">Fecha:</span> {hoy}</p>
          <p><span className="font-semibold">Cliente:</span> {contrato.cliente_nombre}{contrato.cliente_cuit ? ` — CUIT ${contrato.cliente_cuit}` : ''}</p>
          <p><span className="font-semibold">Obra:</span> {obraNombre}</p>
        </div>

        {/* Precio y plazos */}
        <div className="mb-8 text-sm space-y-1.5">
          <p>
            <span className="font-semibold">Precio acordado:</span>{' '}
            <strong>{fmt(contrato.monto_total, contrato.moneda)}</strong>{' '}
            ({contrato.moneda === 'USD' ? 'dólares estadounidenses' : 'pesos argentinos'})
          </p>
          {(fechaInicio || fechaFin) && (
            <p>
              <span className="font-semibold">Plazo:</span>{' '}
              {fechaInicio && <>inicio {fechaInicio}</>}
              {fechaInicio && fechaFin && ' — '}
              {fechaFin && <>finalización estimada {fechaFin}</>}
            </p>
          )}
        </div>

        {/* Descripción / trabajos a realizar */}
        {contrato.descripcion && (
          <div className="mb-10">
            <p className="font-semibold text-sm mb-2 border-b border-gray-200 pb-1">Descripción de los trabajos</p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{contrato.descripcion}</p>
          </div>
        )}

        {/* Firmas */}
        <div className="grid grid-cols-2 gap-20 mt-16">
          <div className="text-center">
            <div className="firma-linea">
              <p className="font-semibold text-sm">{constructoraNombre}</p>
              <p className="text-xs text-gray-500 mt-0.5">Contratista</p>
            </div>
          </div>
          <div className="text-center">
            <div className="firma-linea">
              <p className="font-semibold text-sm">{contrato.cliente_nombre}</p>
              {contrato.cliente_cuit && <p className="text-xs text-gray-500">CUIT {contrato.cliente_cuit}</p>}
              <p className="text-xs text-gray-500 mt-0.5">Comitente</p>
            </div>
          </div>
        </div>

      </div>
    </>
  )
}
