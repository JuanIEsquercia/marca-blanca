import { SkeletonTarjetas, SkeletonTabla, SkeletonTitulo } from '@/components/admin/Skeleton'

// Cubre /admin y todas sus subsecciones que no traigan su propio loading.
// Forma neutra (título + tarjetas + tabla) porque le sirve tanto al tablero
// como a las pantallas de listado, que son la mayoría del panel.
export default function AdminLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <SkeletonTitulo />
      <SkeletonTarjetas />
      <SkeletonTabla />
    </div>
  )
}
