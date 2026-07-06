export default function ProyectoLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 bg-slate-200 rounded-lg w-40" />
        <div className="h-4 bg-slate-100 rounded w-64" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 bg-white border border-slate-200 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-48 bg-white border border-slate-200 rounded-xl" />
        <div className="space-y-3">
          <div className="h-20 bg-white border border-slate-200 rounded-xl" />
          <div className="h-20 bg-white border border-slate-200 rounded-xl" />
        </div>
      </div>
      <div className="h-64 bg-white border border-slate-200 rounded-xl" />
    </div>
  )
}
