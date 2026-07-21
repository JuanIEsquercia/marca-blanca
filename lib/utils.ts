import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Toda cifra monetaria del ERP se muestra con exactamente 2 decimales — sin
// truncar centavos ni dejarlos "flotantes" según el valor (antes cada
// pantalla tenía su propio formateador con minimumFractionDigits distinto).
export function formatCurrency(value: number, moneda: string = 'USD'): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda === 'ARS' ? 'ARS' : 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(redondear2(value))
}

// Redondeo "bancario" simple a 2 decimales para evitar arrastrar errores de
// punto flotante (0.1 + 0.2 = 0.30000000000000004) a través de sumas
// encadenadas de montos — aplicar en cada acumulador, no solo al mostrar.
export function redondear2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function sumarMontos(values: (number | null | undefined)[]): number {
  return redondear2(values.reduce((acc: number, v) => acc + (v ?? 0), 0))
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export const ESTADO_COLORS: Record<string, string> = {
  Disponible: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  Reservado:  'bg-amber-100 text-amber-800 border-amber-200',
  Vendido:    'bg-slate-100 text-slate-600 border-slate-200',
  Pendiente:  'bg-orange-100 text-orange-800 border-orange-200',
  Pagado:     'bg-green-100 text-green-800 border-green-200',
  Vencido:    'bg-red-100 text-red-800 border-red-200',
}
