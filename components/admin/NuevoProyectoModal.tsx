'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface CuentaSimple {
  id: string
  nombre: string
  tipo: string
  moneda: string
}

interface Props {
  constructoraId: string
  cuentasExistentes: CuentaSimple[]
}

type TipoProyecto = 'desarrollo' | 'obra'
type ModoCuentas = 'empresa' | 'especificas'

export default function NuevoProyectoModal({ constructoraId, cuentasExistentes }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  // Form state
  const [tipo, setTipo] = useState<TipoProyecto>('desarrollo')
  const [nombre, setNombre] = useState('')
  const [direccion, setDireccion] = useState('')
  const [modoCuentas, setModoCuentas] = useState<ModoCuentas>('empresa')
  const [replicarCuentas, setReplicarCuentas] = useState(true)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetAndClose() {
    setOpen(false)
    setTipo('desarrollo')
    setNombre('')
    setDireccion('')
    setModoCuentas('empresa')
    setReplicarCuentas(true)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return

    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      // 1. Crear el proyecto
      const { data: obra, error: obraError } = await supabase
        .from('obras')
        .insert({
          nombre: nombre.trim(),
          tipo,
          estado: 'activa',
          constructora_id: constructoraId,
          direccion: direccion.trim() || null,
          modo_cuentas: modoCuentas,
        })
        .select('id')
        .single()

      if (obraError || !obra) {
        setError('No se pudo crear el proyecto. Intentá de nuevo.')
        setLoading(false)
        return
      }

      // 2. Si corresponde, replicar cuentas
      if (modoCuentas === 'especificas' && replicarCuentas && cuentasExistentes.length > 0) {
        await supabase
          .from('cuentas_propias')
          .insert(
            cuentasExistentes.map(c => ({
              nombre: c.nombre,
              tipo: c.tipo,
              moneda: c.moneda,
              saldo_inicial: 0,
              activa: true,
              constructora_id: constructoraId,
              obra_id: obra.id,
            }))
          )
      }

      // 3. Navegar al nuevo proyecto
      router.push(`/admin/proyectos/${obra.id}/dashboard`)
      router.refresh()
      resetAndClose()
    } catch {
      setError('Ocurrió un error inesperado.')
      setLoading(false)
    }
  }

  return (
    <>
      {/* Botón disparador */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Nuevo Proyecto
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <form onSubmit={handleSubmit}>
              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">Nuevo Proyecto</h2>
                <button
                  type="button"
                  onClick={resetAndClose}
                  className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="px-6 py-5 space-y-6">

                {/* Tipo de proyecto */}
                <div>
                  <p className="text-sm font-semibold text-slate-700 mb-3">¿Qué tipo de proyecto es?</p>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      {
                        value: 'desarrollo' as const,
                        label: 'Desarrollo',
                        desc: 'Venta de unidades, reservas, contratos',
                        badge: 'DESARROLLO',
                        badgeColor: 'bg-indigo-100 text-indigo-700',
                        activeColor: 'border-indigo-500 bg-indigo-50',
                        icon: (
                          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" />
                          </svg>
                        ),
                      },
                      {
                        value: 'obra' as const,
                        label: 'Obra',
                        desc: 'Certificados de avance, cobros al cliente',
                        badge: 'OBRA',
                        badgeColor: 'bg-amber-100 text-amber-700',
                        activeColor: 'border-amber-500 bg-amber-50',
                        icon: (
                          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        ),
                      },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setTipo(opt.value)}
                        className={cn(
                          'flex flex-col items-start gap-2 p-4 rounded-xl border-2 text-left transition-all',
                          tipo === opt.value
                            ? opt.activeColor
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        )}
                      >
                        <div className={cn(
                          'p-2 rounded-lg',
                          tipo === opt.value
                            ? opt.value === 'desarrollo' ? 'text-indigo-600' : 'text-amber-600'
                            : 'text-slate-400'
                        )}>
                          {opt.icon}
                        </div>
                        <div>
                          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', opt.badgeColor)}>
                            {opt.badge}
                          </span>
                          <p className="text-sm font-semibold text-slate-900 mt-1.5">{opt.label}</p>
                          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{opt.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Nombre */}
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Nombre del proyecto <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={nombre}
                    onChange={e => setNombre(e.target.value)}
                    placeholder={tipo === 'desarrollo' ? 'Ej: Torre San Martín' : 'Ej: Casa Rodríguez — Tigre'}
                    required
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                {/* Dirección */}
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Dirección <span className="text-slate-400 font-normal">(opcional)</span>
                  </label>
                  <input
                    type="text"
                    value={direccion}
                    onChange={e => setDireccion(e.target.value)}
                    placeholder="Ej: Av. Santa Fe 1234, CABA"
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                {/* Cuentas */}
                <div>
                  <p className="text-sm font-semibold text-slate-700 mb-3">Cuentas bancarias</p>
                  <div className="space-y-2">
                    <label className={cn(
                      'flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors',
                      modoCuentas === 'empresa' ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'
                    )}>
                      <input
                        type="radio"
                        name="cuentas"
                        checked={modoCuentas === 'empresa'}
                        onChange={() => setModoCuentas('empresa')}
                        className="mt-0.5 accent-indigo-600"
                      />
                      <div>
                        <p className="text-sm font-medium text-slate-900">Usar cuentas de la empresa</p>
                        <p className="text-xs text-slate-500 mt-0.5">Los cobros y pagos de este proyecto se registran en las cuentas compartidas</p>
                      </div>
                    </label>

                    <label className={cn(
                      'flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors',
                      modoCuentas === 'especificas' ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'
                    )}>
                      <input
                        type="radio"
                        name="cuentas"
                        checked={modoCuentas === 'especificas'}
                        onChange={() => setModoCuentas('especificas')}
                        className="mt-0.5 accent-indigo-600"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900">Cuentas específicas para este proyecto</p>
                        <p className="text-xs text-slate-500 mt-0.5">Ideal para fideicomisos — cuentas bancarias independientes</p>

                        {modoCuentas === 'especificas' && cuentasExistentes.length > 0 && (
                          <div className="mt-3 border-t border-indigo-200 pt-3">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={replicarCuentas}
                                onChange={e => setReplicarCuentas(e.target.checked)}
                                className="accent-indigo-600"
                              />
                              <span className="text-xs font-medium text-slate-700">
                                Copiar estructura de cuentas existentes
                              </span>
                            </label>
                            {replicarCuentas && (
                              <ul className="mt-2 space-y-1">
                                {cuentasExistentes.map(c => (
                                  <li key={c.id} className="flex items-center gap-2 text-xs text-slate-500">
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                                    <span>{c.nombre}</span>
                                    <span className="text-slate-400">· {c.tipo} · {c.moneda}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {replicarCuentas && (
                              <p className="text-[10px] text-slate-400 mt-2">Se crearán con saldo inicial $0</p>
                            )}
                          </div>
                        )}

                        {modoCuentas === 'especificas' && cuentasExistentes.length === 0 && (
                          <p className="text-xs text-slate-400 mt-2">
                            Podés crear cuentas más adelante desde el panel del proyecto → Finanzas → Cuentas.
                          </p>
                        )}
                      </div>
                    </label>
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                    <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex gap-3 px-6 pb-6">
                <button
                  type="button"
                  onClick={resetAndClose}
                  disabled={loading}
                  className="flex-1 py-2.5 border border-slate-300 rounded-xl text-sm font-medium
                             text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading || !nombre.trim()}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                             text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  {loading ? 'Creando...' : 'Crear proyecto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
