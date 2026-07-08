import { headers } from 'next/headers'

// Evita open redirect: solo rutas internas (empiezan con "/", no "//").
export function sanitizarRedirect(path: string | null): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return '/admin'
  return path
}

// Rate limiter en memoria por instancia del proceso — mismo patrón que
// usaba loginAction. Limitación conocida: no persiste entre instancias
// si se escala horizontalmente (ver memoria del proyecto).
export function crearRateLimiter(maxIntentos: number, ventanaMs: number) {
  const intentos = new Map<string, { count: number; resetAt: number }>()

  return {
    chequear(key: string): boolean {
      const ahora = Date.now()
      const registro = intentos.get(key)

      if (!registro || ahora > registro.resetAt) {
        intentos.set(key, { count: 1, resetAt: ahora + ventanaMs })
        return true
      }

      if (registro.count >= maxIntentos) return false

      registro.count += 1
      return true
    },
    limpiar(key: string) {
      intentos.delete(key)
    },
  }
}

// Origen (protocolo + host) del request actual, derivado de headers ya
// que las Server Actions no tienen acceso a `request.url` como un Route Handler.
export async function getOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
