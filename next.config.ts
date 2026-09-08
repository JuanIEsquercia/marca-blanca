import type { NextConfig } from "next";
import path from "path";

// Headers de seguridad para todo el sitio. No se declara una CSP completa
// (script-src/img-src/connect-src) a propósito: sin una pasada de prueba
// contra Supabase/Cloudinary/inline scripts de Next, una CSP mal calibrada
// rompe el panel en silencio — frame-ancestors es la única directiva que
// no tiene ese riesgo y cubre el clickjacking, que es lo que importa en un
// panel financiero.
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  // SUPERADMIN_EMAIL se lee con process.env directo en proxy.ts — NO va en
  // `env: {}`: ese bloque inlinea el valor en el bundle del browser y
  // publicaba el email de la cuenta más privilegiada del sistema
  // (auditoría 2026-08-24). Las vars sin NEXT_PUBLIC_ sí están disponibles
  // en el proxy/Edge en Vercel y en `next dev`.
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [{ source: '/(.*)', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
