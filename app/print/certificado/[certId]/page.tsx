import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
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

const ESTADO_LABEL: Record<string, string> = {
  borrador:   'Borrador',
  presentado: 'Presentado al comitente',
  aprobado:   'Aprobado por el comitente',
}

export default async function PrintCertificadoPage({ params }: { params: Promise<{ certId: string }> }) {
  const { certId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')

  const admin = createAdminClient()

  const { data: cert } = await admin
    .from('certificados_avance')
    .select(`
      *,
      contratos_obra (
        monto_total, moneda,
        compradores (nombre_completo, dni_cuit, email, telefono)
      ),
      obras (nombre, direccion, constructoras(nombre))
    `)
    .eq('id', certId)
    .maybeSingle()

  if (!cert || cert.constructora_id !== ctx.constructoraId) redirect('/admin')

  const contrato = (cert.contratos_obra as any) ?? {}
  const cliente = contrato.compradores ?? {}
  const obraNombre = (cert.obras as any)?.nombre ?? ''
  const obraDireccion = (cert.obras as any)?.direccion ?? ''
  const constructoraNombre = (cert.obras as any)?.constructoras?.nombre ?? 'Constructora'
  const hoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const pctContrato = contrato.monto_total > 0
    ? ((cert.monto_certificado / contrato.monto_total) * 100).toFixed(1)
    : '—'

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

      <PrintToolbar title={`Vista previa — Certificado de Avance N°${cert.numero}`} />

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
            <p className="text-xl font-bold">CERTIFICADO DE AVANCE</p>
            <p className="text-2xl font-bold">N° {cert.numero}</p>
            <p className="text-sm mt-0.5">{hoy}</p>
          </div>
        </div>

        {/* Datos principales */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm border border-black p-4 mb-6">
          <div><span className="font-semibold">Comitente:</span> {cliente.nombre_completo ?? '—'}</div>
          <div><span className="font-semibold">CUIT:</span> {cliente.dni_cuit ?? '—'}</div>
          <div><span className="font-semibold">Obra:</span> {obraNombre}</div>
          <div><span className="font-semibold">Período:</span> {cert.periodo}</div>
          <div><span className="font-semibold">Fecha presentación:</span> {fmtDate(cert.fecha_presentacion)}</div>
          <div><span className="font-semibold">Fecha aprobación:</span> {fmtDate(cert.fecha_aprobacion)}</div>
          <div className="col-span-2"><span className="font-semibold">Estado:</span> {ESTADO_LABEL[cert.estado] ?? cert.estado}</div>
        </div>

        {/* Avance y monto — destacado */}
        <div className="flex gap-4 mb-6">
          <div className="border-2 border-black p-4 text-center w-36 shrink-0">
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">Avance</p>
            <p className="text-3xl font-bold">{cert.porcentaje_avance}%</p>
          </div>
          <div className="border-2 border-black p-4 flex-1 min-w-0 text-center">
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">Monto certificado</p>
            <p className="text-2xl font-bold leading-tight break-all">{fmt(cert.monto_certificado, contrato.moneda)}</p>
            <p className="text-xs text-gray-400 mt-1">{pctContrato}% del total · {fmt(contrato.monto_total, contrato.moneda)}</p>
          </div>
        </div>

        {/* Descripción de avances */}
        <div className="mb-8">
          <p className="font-bold uppercase text-sm mb-2 border-b border-gray-300 pb-1">
            Descripción de trabajos ejecutados en el período
          </p>
          <p className="text-sm leading-relaxed text-justify min-h-[80px]">
            {cert.descripcion_avances ?? 'Sin descripción detallada.'}
          </p>
        </div>

        {cert.notas && (
          <div className="mb-8 p-3 border border-gray-300">
            <p className="font-semibold text-sm mb-1">Notas:</p>
            <p className="text-sm">{cert.notas}</p>
          </div>
        )}

        {/* Conformidad */}
        <div className="mb-4">
          <p className="text-sm text-center text-gray-600 italic">
            Las partes prestan conformidad con el avance y el monto certificado precedentes,
            comprometiéndose al pago en los plazos acordados.
          </p>
        </div>

        {/* Firmas */}
        <div className="grid grid-cols-2 gap-16 mt-12">
          <div className="text-center">
            <div className="border-t border-black pt-3 mt-16">
              <p className="font-semibold">{constructoraNombre}</p>
              <p className="text-sm text-gray-600">EL CONTRATISTA</p>
              <p className="text-xs text-gray-400 mt-2">Fecha: ____/____/________</p>
            </div>
          </div>
          <div className="text-center">
            <div className="border-t border-black pt-3 mt-16">
              <p className="font-semibold">{cliente.nombre_completo ?? 'Comitente'}</p>
              <p className="text-sm text-gray-600">EL COMITENTE</p>
              {cliente.dni_cuit && <p className="text-xs text-gray-500">CUIT {cliente.dni_cuit}</p>}
              <p className="text-xs text-gray-400 mt-2">Fecha: ____/____/________</p>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-10">
          {constructoraNombre} · Certificado de Avance N°{cert.numero} · {cert.periodo} · Generado {hoy}
        </p>
      </div>
    </>
  )
}
