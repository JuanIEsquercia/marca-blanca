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

    const { data: { user } } = await supabase.auth.getUser()
    const pathname = request.nextUrl.pathname
    const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL
    const isSuperAdmin = !!SUPERADMIN_EMAIL && user?.email === SUPERADMIN_EMAIL

    // Rutas del super admin
    if (pathname.startsWith('/superadmin')) {
      if (!user) {
        const url = new URL('/auth/login', request.url)
        url.searchParams.set('redirectTo', pathname)
        return NextResponse.redirect(url)
      }
      if (!isSuperAdmin) {
        return NextResponse.redirect(new URL('/admin', request.url))
      }
    }

    // Rutas del ERP (constructora)
    if (pathname.startsWith('/admin')) {
      if (!user) {
        const url = new URL('/auth/login', request.url)
        url.searchParams.set('redirectTo', pathname)
        return NextResponse.redirect(url)
      }
    }

    // Después de login: redirigir según rol
    if (pathname === '/auth/login' && user) {
      const dest = isSuperAdmin ? '/superadmin' : '/admin'
      return NextResponse.redirect(new URL(dest, request.url))
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
