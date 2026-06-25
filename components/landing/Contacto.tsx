export default function Contacto() {
  return (
    <section id="contacto" className="bg-black py-24">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Copy */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-px bg-indigo-400" />
              <span className="text-indigo-400 text-xs font-semibold uppercase tracking-[0.2em]">Contacto</span>
            </div>
            <h2 className="text-4xl font-bold text-white mb-6">
              Reservá tu unidad<br />
              <span className="text-slate-400 font-normal">antes del lanzamiento.</span>
            </h2>
            <p className="text-slate-500 leading-relaxed mb-8">
              Nuestros asesores comerciales te acompañan desde la consulta hasta la firma.
              Contactanos y coordiná una visita a nuestra sala de ventas.
            </p>
            <div className="space-y-3">
              {[
                { icon: '📞', label: '+54 11 0000-0000' },
                { icon: '📧', label: 'ventas@torrezentrum.com' },
                { icon: '📍', label: 'Av. Corrientes 1234, CABA' },
              ].map(c => (
                <div key={c.label} className="flex items-center gap-3 text-slate-300">
                  <span className="text-xl">{c.icon}</span>
                  <span className="text-sm">{c.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Formulario */}
          <form className="bg-slate-900 border border-slate-800 rounded-2xl p-8 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Nombre</label>
                <input
                  type="text"
                  placeholder="Tu nombre"
                  className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm
                             text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Teléfono</label>
                <input
                  type="tel"
                  placeholder="+54 11 ..."
                  className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm
                             text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
              <input
                type="email"
                placeholder="tu@email.com"
                className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm
                           text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">¿Qué unidad te interesa?</label>
              <textarea
                rows={3}
                placeholder="Tipología, piso, o dejá tu consulta..."
                className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm
                           text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold
                         rounded-xl transition-colors text-sm"
            >
              Enviar consulta
            </button>
            <p className="text-slate-600 text-xs text-center">
              Un asesor te contactará dentro de las 24hs hábiles.
            </p>
          </form>
        </div>
      </div>
    </section>
  )
}
