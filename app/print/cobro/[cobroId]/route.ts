import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import { puedeAcceder } from '@/lib/permisos'
import { renderCobroPdf } from '@/lib/pdf/cobro-document'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ cobroId: string }> }
) {
  const { cobroId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/auth/login', req.url))

  const ctx = await getConstructoraContext()
  if (!ctx) return NextResponse.redirect(new URL('/auth/login', req.url))

  const admin = createAdminClient()

  const { data: cobro } = await admin
    .from('cobros_proyecto')
    .select(`
      *,
      certificados_avance (
        numero, periodo, monto_certificado,
        contratos_obra (moneda, compradores (nombre_completo, dni_cuit))
      ),
      cuentas_propias (nombre, tipo, moneda),
      obras (nombre, direccion, constructoras(nombre))
    `)
    .eq('id', cobroId)
    .maybeSingle()

  if (!cobro || cobro.constructora_id !== ctx.constructoraId) {
    return NextResponse.redirect(new URL('/admin', req.url))
  }

  if (!puedeAcceder(ctx.perfilRol, ctx.perfilPermisos, ctx.perfilProyectos, 'cobros', cobro.obra_id)) {
    return NextResponse.redirect(new URL('/admin', req.url))
  }

  const cert = (cobro.certificados_avance as unknown as { numero: number; periodo: string; contratos_obra: { moneda: string; compradores: { nombre_completo: string; dni_cuit: string | null } | null } | null } | null)
  const contrato = cert?.contratos_obra ?? null
  const cliente = contrato?.compradores ?? null
  const obra = (cobro.obras as unknown as { nombre: string; direccion: string | null; constructoras: { nombre: string } | null } | null)
  const cuenta = (cobro.cuentas_propias as unknown as { nombre: string; tipo: string; moneda: string } | null)
  const moneda = cobro.moneda ?? contrato?.moneda ?? 'ARS'
  const reciboNum = cobro.numero ? String(cobro.numero).padStart(4, '0') : '—'

  const buffer = await renderCobroPdf({
    reciboNum,
    constructoraNombre: obra?.constructoras?.nombre ?? 'Constructora',
    obraNombre: obra?.nombre ?? '',
    obraDireccion: obra?.direccion ?? null,
    clienteNombre: cliente?.nombre_completo ?? null,
    clienteCuit: cliente?.dni_cuit ?? null,
    monto: cobro.monto,
    moneda,
    fechaPago: cobro.fecha_pago ?? cobro.fecha,
    cuentaNombre: cuenta?.nombre ?? null,
    cuentaTipo: cuenta?.tipo ?? null,
    cuentaMoneda: cuenta?.moneda ?? null,
    certificadoNumero: cert?.numero ?? null,
    certificadoPeriodo: cert?.periodo ?? null,
    notas: cobro.notas,
    montoNeto: cobro.monto_neto,
    iva: cobro.iva,
    percepciones: cobro.percepciones,
  })

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="recibo-${reciboNum}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
