import { SkeletonTarjetas, SkeletonTabla, SkeletonTitulo } from '@/components/admin/Skeleton'

// Loading propio del proyecto: tiene una fila de tarjetas más que el del
// panel general, porque los tableros de obra y de desarrollo muestran más
// indicadores arriba.
export default function ProyectoLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <SkeletonTitulo />
      <SkeletonTarjetas />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-48 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
        <div className="space-y-3">
          <div className="h-20 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
          <div className="h-20 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
        </div>
      </div>
      <SkeletonTabla filas={4} />
    </div>
  )
}
