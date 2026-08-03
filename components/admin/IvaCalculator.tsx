'use client'

import { useEffect, useState } from 'react'
import { cn, redondear2 } from '@/lib/utils'

export type ModoIva = '0' | '10.5' | '21' | 'personalizado'

interface Props {
  montoNeto: string
  iva: string
  monto: string
  onChangeMontoNeto: (v: string) => void
  onChangeIva: (v: string) => void
  onChangeMonto: (v: string) => void
  // Condición de IVA configurada en el contrato (ver ClienteYFechasForm /
  // migration_055) — arranca el selector ya en ese % en vez de "Sin IVA",
  // para no tener que elegirlo a mano cada vez que se genera un cobro/gasto.
  pctInicial?: number | null
  // El neto puede venir calculado desde afuera (ej. suma de ítems de una
  // recepción de Compras) en vez de tipeado a mano — el input queda de
  // solo lectura, pero el % de IVA se sigue eligiendo/ajustando igual.
  netoReadOnly?: boolean
  labelNeto?: string
}

export function modoDePct(pct?: number | null): ModoIva {
  if (!pct) return '0'
  if (pct === 10.5) return '10.5'
  if (pct === 21) return '21'
  return 'personalizado'
}

// Calculadora de IVA para los flujos "generar cobro/gasto desde
// certificado" (y, con neto de solo lectura, "confirmar recepción de
// Compras"): cargás o recibís el neto y elegís 10.5%/21%/personalizado en
// vez de calcular el total a mano (neto × (1 + %) = total). El IVA y el
// total calculados siguen siendo editables por si hace falta ajustar un
// redondeo puntual, pero se recalculan solos cada vez que cambia el neto
// o el % elegido — un único efecto los mantiene sincronizados sin importar
// si el neto lo tipea la persona o lo recalcula el padre en cada render.
export default function IvaCalculator({
  montoNeto, iva, monto, onChangeMontoNeto, onChangeIva, onChangeMonto,
  pctInicial, netoReadOnly = false, labelNeto = 'Monto neto',
}: Props) {
  const [modo, setModo] = useState<ModoIva>(() => modoDePct(pctInicial))
  const [pctPersonalizado, setPctPersonalizado] = useState(() => modoDePct(pctInicial) === 'personalizado' ? String(pctInicial) : '')

  useEffect(() => {
    const netoNum = parseFloat(montoNeto) || 0
    const pctNum = modo === 'personalizado' ? (parseFloat(pctPersonalizado) || 0) : parseFloat(modo)
    const ivaNum = redondear2(netoNum * pctNum / 100)
    onChangeIva(String(ivaNum))
    onChangeMonto(String(redondear2(netoNum + ivaNum)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [montoNeto, modo, pctPersonalizado])

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">{labelNeto} *</label>
          <input required={!netoReadOnly} readOnly={netoReadOnly} type="number" min="0" step="0.01" value={montoNeto}
            onChange={e => onChangeMontoNeto(e.target.value)}
            className={cn('w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
              netoReadOnly && 'bg-slate-50 text-slate-500')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">IVA</label>
          <select value={modo} onChange={e => setModo(e.target.value as ModoIva)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="0">Sin IVA</option>
            <option value="10.5">10.5%</option>
            <option value="21">21%</option>
            <option value="personalizado">Personalizado</option>
          </select>
        </div>
      </div>
      {modo === 'personalizado' && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">% de IVA</label>
          <input type="number" min="0" step="0.01" value={pctPersonalizado}
            onChange={e => setPctPersonalizado(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">IVA calculado</label>
          <input type="number" min="0" step="0.01" value={iva}
            onChange={e => onChangeIva(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Total *</label>
          <input required type="number" min="0" step="0.01" value={monto}
            onChange={e => onChangeMonto(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
      </div>
    </div>
  )
}
