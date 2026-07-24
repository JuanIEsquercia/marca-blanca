import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import { renderCertificadoPdf } from '@/lib/pdf/certificado-document'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ certId: string }> }
) {
  const { certId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/auth/login', req.url))

  const ctx = await getConstructoraContext()
  if (!ctx) return NextResponse.redirect(new URL('/auth/login', req.url))

  const admin = createAdminClient()

  const { data: cert } = await admin
    .from('certificados_avance')
    .select(`
      *,
      contratos_obra (
        monto_total, moneda,
        compradores (nombre_completo, dni_cuit)
      ),
      obras (nombre, direccion, constructoras(nombre))
    `)
    .eq('id', certId)
    .maybeSingle()

  if (!cert || cert.constructora_id !== ctx.constructoraId) {
    return NextResponse.redirect(new URL('/admin', req.url))
  }

  const contrato = (cert.contratos_obra as unknown as { monto_total: number; moneda: string; compradores: { nombre_completo: string; dni_cuit: string | null } | null } | null)
  const cliente = contrato?.compradores ?? null
  const obra = (cert.obras as unknown as { nombre: string; direccion: string | null; constructoras: { nombre: string } | null } | null)

  const buffer = await renderCertificadoPdf({
    numero: cert.numero,
    constructoraNombre: obra?.constructoras?.nombre ?? 'Constructora',
    obraNombre: obra?.nombre ?? '',
    obraDireccion: obra?.direccion ?? null,
    clienteNombre: cliente?.nombre_completo ?? '',
    clienteCuit: cliente?.dni_cuit ?? null,
    periodo: cert.periodo,
    fechaPresentacion: cert.fecha_presentacion,
    fechaAprobacion: cert.fecha_aprobacion,
    estado: cert.estado,
    porcentajeAvance: cert.porcentaje_avance,
    montoCertificado: cert.monto_certificado,
    montoTotalContrato: contrato?.monto_total ?? 0,
    moneda: contrato?.moneda ?? 'ARS',
    descripcionAvances: cert.descripcion_avances,
    notas: cert.notas,
  })

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="certificado-N${cert.numero}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
