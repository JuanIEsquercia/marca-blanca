'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  onCreated?: () => void
}

export default function NuevaConstructoraModal({ onCreated }: Props = {}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ email: string; password: string } | null>(null)

  const [nombre, setNombre] = useState('')
  const [adminNombre, setAdminNombre] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')

  // Datos de facturación — opcionales, se pueden completar después desde
  // el listado si no se tienen a mano al momento de crear la constructora.
  const [razonSocial, setRazonSocial] = useState('')
  const [cuit, setCuit] = useState('')
  const [condicionIva, setCondicionIva] = useState('')
  const [emailFacturacion, setEmailFacturacion] = useState('')
  const [telefonoContacto, setTelefonoContacto] = useState('')
  const [direccion, setDireccion] = useState('')

  function reset() {
    setNombre('')
    setAdminNombre('')
    setAdminEmail('')
    setAdminPassword('')
    setRazonSocial('')
    setCuit('')
    setCondicionIva('')
    setEmailFacturacion('')
    setTelefonoContacto('')
    setDireccion('')
    setError(null)
    setSuccess(null)
  }

  function handleOpen() {
    reset()
    setOpen(true)
  }

  function handleClose() {
    setOpen(false)
    reset()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/superadmin/constructoras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre, adminNombre, adminEmail, adminPassword,
        razonSocial, cuit, condicionIva, emailFacturacion, telefonoContacto, direccion,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Error inesperado')
      setLoading(false)
      return
    }

    setSuccess({ email: adminEmail, password: adminPassword })
    setLoading(false)
    if (onCreated) onCreated()
    else router.refresh()
  }

  if (!open) {
    return (
      <button
        onClick={handleOpen}
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Nueva constructora
      </button>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">Nueva constructora</h2>
          <p className="text-sm text-slate-500 mt-0.5">Creá la empresa y el acceso de su administrador</p>
        </div>

        {success ? (
          <div className="p-6">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4">
              <p className="text-sm font-semibold text-emerald-800 mb-3">Constructora creada correctamente</p>
              <div className="space-y-1 font-mono text-xs text-emerald-700">
                <p>Email: <span className="font-bold">{success.email}</span></p>
                <p>Contraseña: <span className="font-bold">{success.password}</span></p>
              </div>
              <p className="text-xs text-emerald-600 mt-3">
                Compartí estas credenciales con el administrador de la constructora. Podrán acceder en /auth/login
              </p>
            </div>
            <button
              onClick={handleClose}
              className="w-full py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Nombre de la empresa <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                placeholder="Ej: Constructora García SA"
                required
                autoFocus
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                Datos de facturación <span className="normal-case font-normal text-slate-400">(opcional, se puede completar después)</span>
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Razón social</label>
                  <input
                    type="text"
                    value={razonSocial}
                    onChange={e => setRazonSocial(e.target.value)}
                    placeholder="Si difiere del nombre comercial"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">CUIT</label>
                    <input
                      type="text"
                      value={cuit}
                      onChange={e => setCuit(e.target.value)}
                      placeholder="30-12345678-9"
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Condición IVA</label>
                    <select
                      value={condicionIva}
                      onChange={e => setCondicionIva(e.target.value)}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    >
                      <option value="">Sin especificar</option>
                      <option value="responsable_inscripto">Responsable Inscripto</option>
                      <option value="monotributo">Monotributo</option>
                      <option value="exento">Exento</option>
                      <option value="consumidor_final">Consumidor Final</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Email de facturación</label>
                  <input
                    type="email"
                    value={emailFacturacion}
                    onChange={e => setEmailFacturacion(e.target.value)}
                    placeholder="administracion@constructora.com"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Teléfono de contacto</label>
                    <input
                      type="text"
                      value={telefonoContacto}
                      onChange={e => setTelefonoContacto(e.target.value)}
                      placeholder="+54 9 11 xxxx-xxxx"
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Dirección</label>
                    <input
                      type="text"
                      value={direccion}
                      onChange={e => setDireccion(e.target.value)}
                      placeholder="Domicilio fiscal"
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Usuario administrador</p>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Nombre</label>
                  <input
                    type="text"
                    value={adminNombre}
                    onChange={e => setAdminNombre(e.target.value)}
                    placeholder="Nombre completo (opcional)"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={adminEmail}
                    onChange={e => setAdminEmail(e.target.value)}
                    placeholder="admin@constructora.com"
                    required
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Contraseña inicial <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={adminPassword}
                    onChange={e => setAdminPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    required
                    minLength={8}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">Visible para que puedas compartirla con el cliente</p>
                </div>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Creando...' : 'Crear constructora'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
