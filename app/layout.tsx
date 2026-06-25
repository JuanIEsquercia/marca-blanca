import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: { template: '%s | Panel ERP', default: 'Sistema Inmobiliario' },
  description: 'Gestión integral de desarrollos inmobiliarios',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
