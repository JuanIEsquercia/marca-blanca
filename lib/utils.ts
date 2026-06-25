import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
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
