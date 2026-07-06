import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Exponer SUPERADMIN_EMAIL al Edge Runtime (proxy/middleware).
  // Las vars sin NEXT_PUBLIC_ no están disponibles en Edge por defecto.
  env: {
    SUPERADMIN_EMAIL: process.env.SUPERADMIN_EMAIL ?? '',
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
