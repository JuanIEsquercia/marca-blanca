export default function Footer() {
  return (
    <footer className="bg-black border-t border-slate-900 py-10">
      <div className="max-w-7xl mx-auto px-6 lg:px-12 flex flex-col sm:flex-row justify-between
                      items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 21h18M3 10h18M3 7l9-4 9 4" />
            </svg>
          </div>
          <span className="text-white font-semibold text-sm">Torre Zentrum</span>
        </div>
        <p className="text-slate-600 text-xs">
          © {new Date().getFullYear()} Torre Zentrum. Todos los derechos reservados.
        </p>
        <a
          href="/auth/login"
          className="text-slate-700 hover:text-slate-500 text-xs transition-colors"
        >
          Panel administrativo
        </a>
      </div>
    </footer>
  )
}
