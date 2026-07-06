import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Imprimir' }

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
