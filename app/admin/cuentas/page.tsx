import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConstructoraContext } from '@/lib/tenant'
import { calcularSaldosDeCuentas } from '@/lib/tesoreria'
import CuentasPropiasManager from '@/components/admin/CuentasPropiasManager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Cuentas propias' }
export const dynamic = 'force-dynamic'

export default async function CuentasPage() {
  const ctx = await getConstructoraContext()
  if (!ctx) redirect('/auth/login')

  const supabase = await createClient()
  const { data: cuentasRaw } = await supabase
    .from('cuentas_propias')
    .select('*, obras(nombre)')
    .eq('constructora_id', ctx.constructoraId)
    .order('nombre')

  // Esta vista lista TODAS las cuentas (compartidas de empresa + específicas
  // de cada proyecto) para tener un control único — antes no indicaba de qué
  // proyecto era cada una, lo que confundía porque Tesorería (el consolidado)
  // no necesariamente mostraba las mismas cuentas en el mismo lugar.
  const cuentas = (cuentasRaw ?? []).map(({ obras, ...c }) => ({ ...c, obra_nombre: obras?.nombre ?? null }))

  // saldo_inicial es fijo (solo cambia si un admin lo edita) — el saldo
  // consolidado (con movimientos de gastos/cuotas/cobros/señas) se calcula
  // aparte, igual que en Caja/Tesorería.
  const saldos = await calcularSaldosDeCuentas(supabase, ctx.constructoraId, cuentas)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Cuentas propias</h1>
        <p className="text-slate-500 text-sm mt-1">
          Cuentas bancarias y cajas de la constructora — compartidas entre proyectos o específicas de uno
        </p>
      </div>
      <CuentasPropiasManager
        cuentas={cuentas}
        saldos={saldos}
        constructoraId={ctx.constructoraId}
        readOnly={ctx.perfilRol !== 'admin'}
      />
    </div>
  )
}
