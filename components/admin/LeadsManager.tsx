'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { Lead, EstadoLead } from '@/types/database'
import { LEAD_ESTADOS } from '@/types/database'

const ESTADO_COLORS: Record<EstadoLead, string> = {
  Nuevo:       'bg-blue-50 text-blue-700 border-blue-200',
  Contactado:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  Interesado:  'bg-amber-50 text-amber-700 border-amber-200',
  Reservado:   'bg-orange-50 text-orange-700 border-orange-200',
  Vendido:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  Descartado:  'bg-slate-100 text-slate-500 border-slate-200',
}

interface Props {
  leads: Lead[]
}

const FILTROS: (EstadoLead | 'Todos')[] = ['Todos', ...LEAD_ESTADOS]

export default function LeadsManager({ leads }: Props) {
  const router = useRouter()
  const [filtro, setFiltro] = useState<EstadoLead | 'Todos'>('Todos')
  const [showForm, setShowForm] = useState(false)
  const [editLead, setEditLead] = useState<Lead | null>(null)
  const [, startTransition] = useTransition()

  // Form state
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [tipologiaInteres, setTipologiaInteres] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [origen, setOrigen] = useState('manual')
  const [loading, setLoading] = useState(false)

  function refresh() { startTransition(() => router.refresh()) }

  const filtrados = filtro === 'Todos'
    ? leads
    : leads.filter(l => l.estado === filtro)

  function abrirFormNuevo() {
    setNombre(''); setEmail(''); setTelefono(''); setTipologiaInteres('')
    setMensaje(''); setOrigen('manual'); setEditLead(null); setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const supabase = createClient()

    if (editLead) {
      await supabase.from('leads').update({
        nombre, email: email || null, telefono: telefono || null,
        tipologia_interes: tipologiaInteres || null, mensaje: mensaje || null, origen,
      }).eq('id', editLead.id)
    } else {
      await supabase.from('leads').insert({
        nombre, email: email || null, telefono: telefono || null,
        tipologia_interes: tipologiaInteres || null, mensaje: mensaje || null, origen,
      })
    }

    setLoading(false)
    setShowForm(false)
    refresh()
  }

  async function handleEstadoChange(leadId: string, estado: EstadoLead) {
    const supabase = createClient()
    await supabase.from('leads').update({ estado }).eq('id', leadId)
    refresh()
  }

  async function handleNotaChange(lead: Lead, notas: string) {
    const supabase = createClient()
    await supabase.from('leads').update({ notas_seguimiento: notas || null }).eq('id', lead.id)
    refresh()
  }

  async function handleDelete(id: string, nombre: string) {
    if (!confirm(`¿Eliminar el lead de ${nombre}?`)) return
    const supabase = createClient()
    await supabase.from('leads').delete().eq('id', id)
    refresh()
  }

  const nuevos = leads.filter(l => l.estado === 'Nuevo').length

  return (
    <>
      {nuevos > 0 && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-3">
          <svg className="w-5 h-5 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <p className="text-sm text-blue-800">
            <strong>{nuevos} lead{nuevos > 1 ? 's' : ''} nuevo{nuevos > 1 ? 's' : ''}</strong> sin contactar.
          </p>
        </div>
      )}

      {/* Filtros + acción */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {FILTROS.map(f => (
          <button key={f} onClick={() => setFiltro(f)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
              filtro === f
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            )}>
            {f}
            <span className="ml-1.5 text-xs opacity-70">
              ({f === 'Todos' ? leads.length : leads.filter(l => l.estado === f).length})
            </span>
          </button>
        ))}
        <button onClick={abrirFormNuevo}
          className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
                     bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuevo lead
        </button>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Nombre</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Contacto</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Tipología</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Origen</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600">Estado</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Notas</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtrados.map(lead => (
              <tr key={lead.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{lead.nombre}</p>
                  <p className="text-xs text-slate-400">
                    {new Date(lead.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {lead.email && <p className="text-xs">{lead.email}</p>}
                  {lead.telefono && <p className="text-xs">{lead.telefono}</p>}
                  {!lead.email && !lead.telefono && <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {lead.tipologia_interes ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded capitalize">
                    {lead.origen}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <select
                    value={lead.estado}
                    onChange={e => handleEstadoChange(lead.id, e.target.value as EstadoLead)}
                    className={cn(
                      'text-xs font-medium px-2 py-1 rounded-full border cursor-pointer focus:outline-none',
                      ESTADO_COLORS[lead.estado]
                    )}
                  >
                    {LEAD_ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3 max-w-[200px]">
                  <input
                    defaultValue={lead.notas_seguimiento ?? ''}
                    onBlur={e => {
                      if (e.target.value !== (lead.notas_seguimiento ?? '')) {
                        handleNotaChange(lead, e.target.value)
                      }
                    }}
                    placeholder="Agregar nota..."
                    className="w-full text-xs text-slate-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-400 focus:outline-none py-0.5 transition-colors"
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => {
                        setEditLead(lead)
                        setNombre(lead.nombre); setEmail(lead.email ?? ''); setTelefono(lead.telefono ?? '')
                        setTipologiaInteres(lead.tipologia_interes ?? ''); setMensaje(lead.mensaje ?? '')
                        setOrigen(lead.origen); setShowForm(true)
                      }}
                      className="text-xs text-slate-400 hover:text-indigo-600 transition-colors"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDelete(lead.id, lead.nombre)}
                      className="text-xs text-slate-300 hover:text-red-500 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtrados.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">
            {leads.length === 0
              ? 'Aún no hay leads. Los contactos del formulario de la landing aparecen aquí.'
              : 'No hay leads con este filtro.'}
          </div>
        )}
      </div>

      {/* Modal nuevo / editar lead */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="font-bold text-slate-900">{editLead ? 'Editar lead' : 'Nuevo lead'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre *</label>
                <input required value={nombre} onChange={e => setNombre(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
                  <input value={telefono} onChange={e => setTelefono(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tipología de interés</label>
                  <input value={tipologiaInteres} onChange={e => setTipologiaInteres(e.target.value)}
                    placeholder="Ej: 2 Ambientes"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Origen</label>
                  <select value={origen} onChange={e => setOrigen(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="manual">Manual</option>
                    <option value="landing">Landing</option>
                    <option value="referido">Referido</option>
                    <option value="redes">Redes sociales</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Mensaje / Consulta</label>
                <textarea rows={3} value={mensaje} onChange={e => setMensaje(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                  Cancelar
                </button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-semibold">
                  {loading ? 'Guardando...' : editLead ? 'Guardar cambios' : 'Agregar lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
