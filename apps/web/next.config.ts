import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Prevent Next.js from bundling these server-side packages.
  // They require DATABASE_URL at runtime — bundling them breaks next build
  // in environments (CI, Dockerfiles) where the env var isn't set at build time.
  serverExternalPackages: ['@eanhl/db', 'postgres'],

  images: {
    remotePatterns: [
      {
        // EA Pro Clubs custom crest CDN — used for opponent logos only.
        // Our own club (Boogeymen) uses /images/bgm-logo.png instead.
        protocol: 'https',
        hostname: 'media.contentapi.ea.com',
        pathname: '/content/dam/eacom/nhl/pro-clubs/custom-crests/**',
      },
    ],
  },
}

export default nextConfig
