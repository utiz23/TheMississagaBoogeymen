import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Prevent Next.js from bundling these server-side packages.
  // They require DATABASE_URL at runtime — bundling them breaks next build
  // in environments (CI, Dockerfiles) where the env var isn't set at build time.
  serverExternalPackages: ['@eanhl/db', 'postgres'],
}

export default nextConfig
