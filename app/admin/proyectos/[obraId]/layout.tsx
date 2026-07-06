import { redirect } from 'next/navigation'
import { getProyectoContext } from '@/lib/tenant'
import ProyectoStoreSync from '@/components/admin/ProyectoStoreSync'

export default async function ProyectoLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ obraId: string }>
}) {
  const { obraId } = await params
  const ctx = await getProyectoContext(obraId)
  if (!ctx) redirect('/admin')

  const cerrado = ctx.obraEstado === 'finalizada'

  return (
    <>
      {/* Sincroniza datos del proyecto al store cliente — elimina el API call del sidebar */}
      <ProyectoStoreSync proyecto={{
        id: ctx.obraId,
        nombre: ctx.obraNombre,
        tipo: ctx.obraTipo,
        modo_cuentas: ctx.obraModo,
      }} />
      {cerrado && (
        <div className="mb-6 flex items-center gap-3 bg-slate-100 border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-600">
          <svg className="w-4 h-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span>
            <strong>Proyecto cerrado.</strong> Este proyecto está en modo solo lectura.
            Para agregar movimientos, reactivalo desde el tablero.
          </span>
        </div>
      )}
      {children}
    </>
  )
}
