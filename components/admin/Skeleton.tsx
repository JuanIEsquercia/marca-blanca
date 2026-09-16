// Piezas del esqueleto de carga que se muestra mientras una sección viaja
// desde el servidor.
//
// Existen por una razón concreta de Next 16: una ruta dinámica NO se
// precarga salvo que tenga un loading. Con `force-dynamic` en todo el panel,
// sin estos archivos el click quedaba bloqueado sin ningún feedback hasta
// que el servidor terminaba de responder.
//
// Llevan clases de modo oscuro a propósito: sin ellas el esqueleto pinta en
// blanco sobre el panel oscuro y cada navegación produce un destello.

export function SkeletonTitulo() {
  return (
    <div className="space-y-2">
      <div className="h-7 w-48 rounded-lg bg-slate-200 dark:bg-slate-800" />
      <div className="h-4 w-72 rounded bg-slate-100 dark:bg-slate-800/60" />
    </div>
  )
}

export function SkeletonTarjetas({ cantidad = 4 }: { cantidad?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: cantidad }).map((_, i) => (
        <div key={i} className="h-24 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
      ))}
    </div>
  )
}

// Filas de alto fijo en vez de un bloque sólido: el salto al llegar los datos
// reales es mucho menor si el esqueleto ya tiene la forma de una tabla.
export function SkeletonTabla({ filas = 6 }: { filas?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="h-11 border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50" />
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {Array.from({ length: filas }).map((_, i) => (
          <div key={i} className="h-14" />
        ))}
      </div>
    </div>
  )
}
