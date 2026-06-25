export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-end overflow-hidden bg-slate-950">
      {/* Fondo con gradiente arquitectónico */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-black" />
        {/* Grid decorativo */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,1) 1px, transparent 1px),
                              linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)`,
            backgroundSize: '80px 80px',
          }}
        />
        {/* Acento de luz */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px]
                        bg-indigo-600/10 rounded-full blur-[120px]" />
      </div>

      {/* Contenido */}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 lg:px-12 pb-24 pt-40">
        <div className="max-w-3xl">
          {/* Eyebrow */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-px bg-indigo-400" />
            <span className="text-indigo-400 text-xs font-semibold uppercase tracking-[0.2em]">
              Preventa exclusiva · 2025
            </span>
          </div>

          {/* Título principal */}
          <h1 className="text-5xl lg:text-7xl font-bold text-white leading-[1.05] mb-6">
            Torre{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
              Zentrum
            </span>
          </h1>

          {/* Bajada */}
          <p className="text-slate-300 text-lg lg:text-xl leading-relaxed mb-10 max-w-xl">
            Vivir en altura es una decisión de estilo. 22 pisos de arquitectura contemporánea
            en el corazón del microcentro. Unidades desde 32 m² hasta 85 m².
          </p>

          {/* CTA */}
          <div className="flex flex-wrap gap-4">
            <a
              href="#stock"
              className="px-7 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold
                         rounded-xl transition-colors text-sm"
            >
              Ver unidades disponibles
            </a>
            <a
              href="#contacto"
              className="px-7 py-3.5 border border-slate-600 hover:border-slate-400 text-slate-300
                         hover:text-white font-semibold rounded-xl transition-colors text-sm"
            >
              Hablar con un asesor
            </a>
          </div>
        </div>

        {/* Stats strip */}
        <div className="mt-20 grid grid-cols-2 lg:grid-cols-4 gap-6 pt-12 border-t border-slate-800">
          {[
            { value: '22', label: 'Pisos' },
            { value: '88', label: 'Unidades' },
            { value: '2026', label: 'Entrega estimada' },
            { value: '4', label: 'Tipologías' },
          ].map(s => (
            <div key={s.label}>
              <p className="text-3xl font-bold text-white">{s.value}</p>
              <p className="text-slate-500 text-sm mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
        <span className="text-slate-600 text-xs uppercase tracking-widest">Scroll</span>
        <div className="w-px h-10 bg-gradient-to-b from-slate-600 to-transparent" />
      </div>
    </section>
  )
}
