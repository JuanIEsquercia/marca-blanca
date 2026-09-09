import type { Metadata } from 'next'
import { Inter, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'

// Antes se cargaban con un <link> a fonts.googleapis.com en el <head> — eso
// bloquea el render en TODAS las páginas autenticadas (todo /admin vive bajo
// este layout raíz). next/font/google las descarga/self-hostea en build time
// y expone cada una como variable CSS, sin request externo ni bloqueo.
const inter = Inter({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-inter',
  display: 'swap',
})
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-jakarta',
  display: 'swap',
})
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { template: '%s | Panel ERP', default: 'Sistema Inmobiliario' },
  description: 'Gestión integral de desarrollos inmobiliarios',
}

import { ThemeProvider } from '@/components/ThemeProvider'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} ${plusJakartaSans.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className="antialiased bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-200">
        {/* Anti-flash del tema oscuro: aplica la clase antes de pintar nada.
            Va como PRIMER hijo de <body>, no dentro de un <head> propio — la
            documentación de Next 16 (docs/01-app/.../layout.md) dice que el
            layout raíz no debe declarar <head> a mano porque rompe el
            streaming y la de-duplicación de esos tags. Con <head> manual, la
            página de login (que envuelve LoginForm en <Suspense>, o sea
            streaming) fallaba con "An unexpected response was received from
            the server". Un <script> inline acá se ejecuta igual durante el
            parseo, antes de que se pinte el contenido de abajo. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const stored = localStorage.getItem('theme-preference');
                const isDark = stored === 'dark' || ((!stored || stored === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
                document.documentElement.classList.toggle('dark', isDark);
              } catch (e) {}
            `,
          }}
        />
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
