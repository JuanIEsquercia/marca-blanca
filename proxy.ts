import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

function bloquear(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  if (pathname.startsWith('/admin') || pathname.startsWith('/superadmin')) {
    const url = new URL('/auth/login', request.url)
    url.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(url)
  }
  return NextResponse.next({ request })
}

export async function proxy(request: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return bloquear(request)
  }

  try {
    let supabaseResponse = NextResponse.next({ request })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() { return request.cookies.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            supabaseResponse = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    // getClaims() y no getUser(): esto corre en CADA navegación (el matcher
    // de abajo no excluye los pedidos de RSC), y getUser() pega a Supabase
    // Auth por red — 613 ms de mediana, hasta 1340. getClaims() verifica la
    // firma del token localmente contra el JWKS del proyecto, cuya clave
    // actual es asimétrica (ECC P-256). Los tokens viejos con el secreto
    // HS256 caen solos a getUser() hasta que vencen.
    //
    // El refresh del token sigue ocurriendo: getClaims() pasa por
    // getSession(), que renueva la sesión cuando está vencida y deja las
    // cookies nuevas en supabaseResponse.
    const { data: claims } = await supabase.auth.getClaims()
    const user = claims?.claims?.sub ? { id: claims.claims.sub } : null
    const pathname = request.nextUrl.pathname

    // El proxy hace AUTENTICACIÓN (¿hay sesión?), no AUTORIZACIÓN (¿quién
    // es?). Antes también comparaba el email contra SUPERADMIN_EMAIL, y eso
    // provocaba un loop infinito de redirecciones: si el proxy no lograba
    // leer esa variable, mandaba /superadmin -> /admin, mientras que
    // app/admin/layout.tsx (que sí la lee, porque corre en Node) mandaba
    // /admin -> /superadmin. Ida y vuelta sin fin.
    //
    // La comparación vive ahora en un solo lugar por ruta:
    // app/superadmin/layout.tsx deja entrar solo al superadmin, y
    // app/admin/layout.tsx manda al superadmin a su panel. Los dos corren
    // en Node, con acceso garantizado a la variable, y son la barrera real
    // — el proxy nunca fue la que protegía esto.
    if (pathname.startsWith('/superadmin') || pathname.startsWith('/admin')) {
      if (!user) {
        const url = new URL('/auth/login', request.url)
        url.searchParams.set('redirectTo', pathname)
        return NextResponse.redirect(url)
      }
    }

    // Después de login siempre a /admin: si resulta ser el superadmin, su
    // layout lo reenvía a /superadmin en un solo salto más.
    if (pathname === '/auth/login' && user) {
      return NextResponse.redirect(new URL('/admin', request.url))
    }

    supabaseResponse.headers.set('x-pathname', pathname)
    return supabaseResponse
  } catch (err) {
    console.error('proxy: error de autenticación, bloqueando por defecto', err)
    return bloquear(request)
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
