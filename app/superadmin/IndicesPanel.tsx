'use client'

import { useCallback, useEffect, useState } from 'react'

// Panel de índices del sistema (migration_078 / migration_079 / migration_080).
//
// Dos cosas distintas conviven acá:
//   - Las series que trae el BCRA solas (dólar, UVA, CER, ICL). Acá solo se
//     ven y se puede forzar una captura si un día falló.
//   - El CAC, que la Cámara Argentina de la Construcción publica UNA VEZ POR
//     MES y no expone por API. Se carga a mano.
//
// Vive en superadmin y no en el panel de cada empresa a propósito: el CAC es
// un índice nacional, uno solo. Si cada constructora cargara el suyo, dos
// contratos idénticos ajustarían distinto según quién tipeó el número.

interface ValorIndice {
  tipo: string
  fecha: string
  valor: number
  fuente: string | null
}

const ETIQUETAS: Record<string, string> = {
  USD_MINORISTA: 'Dólar minorista',
  USD_MAYORISTA: 'Dólar mayorista',
  UVA: 'UVA',
  CER: 'CER',
  ICL: 'ICL',
  CAC: 'CAC (construcción)',
}

export default function IndicesPanel() {
  const [valores, setValores] = useState<ValorIndice[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const [fechaCac, setFechaCac] = useState(() => {
    // El CAC es mensual: se lo referencia por el primer día del mes.
    const hoy = new Date()
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [valorCac, setValorCac] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [capturando, setCapturando] = useState(false)

  const cargar = useCallback(async () => {
    const res = await fetch('/api/superadmin/indices')
    const data = await res.json()
    setCargando(false)
    if (!res.ok) { setError(data.error ?? 'No se pudieron leer los índices'); return }
    setValores(data.valores ?? [])
  }, [])

  // La carga inicial va con el fetch inline y el setState recién en el
  // .then — mismo patrón que el resto de los formularios del panel. Llamar
  // acá a cargar() encadenaría un render de más en cada montaje.
  useEffect(() => {
    let vigente = true
    fetch('/api/superadmin/indices')
      .then(r => r.json())
      .then((data: { valores?: ValorIndice[]; error?: string }) => {
        if (!vigente) return
        setCargando(false)
        if (data.error) { setError(data.error); return }
        setValores(data.valores ?? [])
      })
      .catch(() => { if (vigente) { setCargando(false); setError('No se pudieron leer los índices') } })
    return () => { vigente = false }
  }, [])

  // Último valor de cada serie: es lo único que hace falta ver para saber
  // si una serie está al día o quedó parada.
  const ultimos = new Map<string, ValorIndice>()
  for (const v of valores) if (!ultimos.has(v.tipo)) ultimos.set(v.tipo, v)

  async function guardarCac(e: React.FormEvent) {
    e.preventDefault()
    setGuardando(true)
    setError(null)
    setAviso(null)
    const res = await fetch('/api/superadmin/indices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'CAC', fecha: fechaCac, valor: valorCac }),
    })
    const data = await res.json()
    setGuardando(false)
    if (!res.ok) { setError(data.error ?? 'No se pudo guardar el índice'); return }
    setValorCac('')
    setAviso(`CAC de ${fechaCac} guardado.`)
    void cargar()
  }

  // Backfill / reintento de las series automáticas. Es idempotente (upsert
  // por tipo+fecha), así que se puede tocar las veces que haga falta.
  async function capturarBcra(desde?: string) {
    setCapturando(true)
    setError(null)
    setAviso(null)
    const url = desde ? `/api/cron/indices?desde=${desde}` : '/api/cron/indices'
    const res = await fetch(url)
    const data = await res.json()
    setCapturando(false)
    if (!res.ok && res.status !== 207) { setError(data.error ?? 'La captura falló'); return }
    const total = (data.resultados ?? []).reduce((acc: number, r: { guardados?: number }) => acc + (r.guardados ?? 0), 0)
    const fallidas = (data.resultados ?? []).filter((r: { error?: string }) => r.error)
    setAviso(
      fallidas.length > 0
        ? `Se guardaron ${total} valores, pero fallaron: ${fallidas.map((r: { tipo: string }) => r.tipo).join(', ')}.`
        : `Se guardaron ${total} valores.`
    )
    void cargar()
  }

  return (
    <div className="mt-10 border-t border-slate-800 pt-8">
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-white">Índices y cotizaciones</h2>
          <p className="text-slate-400 text-sm mt-0.5">
            Son globales: los usan todas las constructoras para ajustar cuotas y contratos.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => capturarBcra()}
            disabled={capturando}
            className="px-3 py-1.5 text-xs font-medium text-slate-200 border border-slate-700 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors">
            {capturando ? 'Capturando...' : 'Actualizar del BCRA'}
          </button>
          <button
            onClick={() => capturarBcra('2024-01-01')}
            disabled={capturando}
            title="Trae toda la historia desde enero de 2024. Es idempotente: se puede correr las veces que haga falta."
            className="px-3 py-1.5 text-xs font-medium text-indigo-300 border border-indigo-800 rounded-lg hover:bg-indigo-950 disabled:opacity-50 transition-colors">
            Backfill desde 2024
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-950 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>
      )}
      {aviso && (
        <div className="mb-4 p-3 bg-emerald-950 border border-emerald-800 rounded-lg text-sm text-emerald-300">{aviso}</div>
      )}

      {/* Estado de cada serie */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        {Object.entries(ETIQUETAS).map(([tipo, etiqueta]) => {
          const ultimo = ultimos.get(tipo)
          return (
            <div key={tipo} className="border border-slate-800 rounded-xl p-3 bg-slate-900">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{etiqueta}</p>
              {ultimo ? (
                <>
                  <p className="text-lg font-bold text-white tabular-nums mt-0.5">{ultimo.valor}</p>
                  <p className="text-[11px] text-slate-500">al {ultimo.fecha}</p>
                </>
              ) : (
                <p className="text-sm text-amber-400 mt-1">{cargando ? 'Leyendo...' : 'Sin cargar'}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Carga manual del CAC */}
      <form onSubmit={guardarCac} className="border border-slate-800 rounded-xl p-4 bg-slate-900">
        <h3 className="text-sm font-semibold text-white">Cargar CAC del mes</h3>
        <p className="text-xs text-slate-400 mt-0.5 mb-3">
          La Cámara Argentina de la Construcción no publica API: este es el único índice que se carga a mano.
          Volver a cargar un mes ya cargado lo corrige, no lo duplica — y las cuotas ya emitidas no cambian,
          porque su monto quedó congelado con el valor del día de la emisión.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-[11px] text-slate-400 mb-1">Mes (primer día)</label>
            <input required type="date" value={fechaCac} onChange={e => setFechaCac(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] text-slate-400 mb-1">Valor del índice</label>
            <input required type="number" min="0" step="0.0001" value={valorCac} onChange={e => setValorCac(e.target.value)}
              placeholder="Ej. 2185.4"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={guardando}
              className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold transition-colors">
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
