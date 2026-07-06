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
  if (!d) return '___/___/______'
  return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function numeroALetras(n: number): string {
  // Simplificado — solo para mostrar un texto aproximado
  return n.toLocaleString('es-AR')
}

export default async function PrintCobroPage({ params }: { params: Promise<{ cobroId: string }> }) {
  const { cobroId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  const { data: cobro } = await admin
    .from('cobros_proyecto')
    .select(`
      *,
      certificados_avance (
        numero, periodo, monto_certificado,
        contratos_obra (cliente_nombre, cliente_cuit, moneda)
      ),
      cuentas_propias (nombre, tipo, moneda),
      obras (nombre, direccion, constructoras(nombre))
    `)
    .eq('id', cobroId)
    .maybeSingle()

  if (!cobro) redirect('/admin')

  const cert = (cobro.certificados_avance as any) ?? null
  const contrato = cert?.contratos_obra ?? null
  const obraNombre = (cobro.obras as any)?.nombre ?? ''
  const obraDireccion = (cobro.obras as any)?.direccion ?? ''
  const constructoraNombre = (cobro.obras as any)?.constructoras?.nombre ?? 'Constructora'
  const cuenta = (cobro.cuentas_propias as any) ?? null
  const moneda = (cobro as any).moneda ?? contrato?.moneda ?? 'ARS'
  const hoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const reciboNum = cobro.numero ? String(cobro.numero).padStart(4, '0') : '—'

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 20mm 20mm 25mm 20mm; }
          body { font-size: 11pt; }
        }
        body { font-family: 'Times New Roman', Times, serif; background: #f5f5f5; }
        .doc { background: white; max-width: 210mm; margin: 0 auto; }
      `}</style>

      <PrintToolbar title={`Vista previa — Recibo de cobro N°${reciboNum}`} />

      {/* Documento */}
      <div className="doc p-[20mm] min-h-screen">

        {/* Encabezado */}
        <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-black">
          <div>
            <p className="text-2xl font-bold tracking-tight">{constructoraNombre}</p>
            {obraDireccion && <p className="text-sm mt-0.5">{obraDireccion}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-0.5">Documento</p>
            <p className="text-xl font-bold">RECIBO</p>
            <p className="text-2xl font-bold">N° {reciboNum}</p>
            <p className="text-sm mt-0.5">{fmtDate(cobro.fecha_pago ?? cobro.fecha)}</p>
          </div>
        </div>

        {/* Cuerpo principal del recibo */}
        <div className="mb-8">
          <p className="text-base leading-loose text-justify">
            Recibí de <strong>{contrato?.cliente_nombre ?? '___________________________'}</strong>
            {contrato?.cliente_cuit ? `, CUIT N° ${contrato.cliente_cuit},` : ','}{' '}
            la suma de{' '}
            <strong>{fmt(cobro.monto, moneda)}</strong>{' '}
            <em>({numeroALetras(cobro.monto)} {moneda === 'USD' ? 'dólares estadounidenses' : 'pesos argentinos'})</em>{' '}
            en concepto de:
          </p>

          {/* Concepto */}
          <div className="border border-black p-4 my-4 bg-gray-50">
            <p className="text-sm font-semibold">Concepto:</p>
            <p className="mt-1">
              Cobro{cert ? ` correspondiente al Certificado de Avance N°${cert.numero} — ${cert.periodo}` : ''}.
              Obra: <strong>{obraNombre}</strong>.
              {cobro.notas ? ` ${cobro.notas}.` : ''}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm mb-4">
            <div>
              <span className="font-semibold">Fecha de pago:</span>{' '}
              {fmtDate(cobro.fecha_pago ?? cobro.fecha)}
            </div>
            {cuenta && (
              <div>
                <span className="font-semibold">Acreditado en:</span>{' '}
                {cuenta.nombre} ({cuenta.tipo} · {cuenta.moneda})
              </div>
            )}
            {cert && (
              <div>
                <span className="font-semibold">Certificado N°:</span> {cert.numero} — {cert.periodo}
              </div>
            )}
            <div>
              <span className="font-semibold">Obra:</span> {obraNombre}
            </div>
          </div>
        </div>

        {/* Monto destacado */}
        <div className="border-2 border-black p-5 text-center mb-10">
          <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">Total recibido</p>
          <p className="text-4xl font-bold">{fmt(cobro.monto, moneda)}</p>
        </div>

        {/* Firmas */}
        <div className="grid grid-cols-2 gap-16 mt-12">
          <div className="text-center">
            <div className="border-t border-black pt-3 mt-16">
              <p className="font-semibold">{constructoraNombre}</p>
              <p className="text-sm text-gray-600">Firma y sello</p>
            </div>
          </div>
          <div className="text-center">
            <div className="border-t border-black pt-3 mt-16">
              <p className="font-semibold">{contrato?.cliente_nombre ?? 'Comitente'}</p>
              <p className="text-sm text-gray-600">Recibí conforme</p>
              {contrato?.cliente_cuit && <p className="text-xs text-gray-500">CUIT {contrato.cliente_cuit}</p>}
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-10">
          {constructoraNombre} · Recibo N°{reciboNum} · Generado {hoy}
        </p>
      </div>
    </>
  )
}
