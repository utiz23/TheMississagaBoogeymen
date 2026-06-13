import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Prevent Next.js from bundling these server-side packages.
  // They require DATABASE_URL at runtime — bundling them breaks next build
  // in environments (CI, Dockerfiles) where the env var isn't set at build time.
  serverExternalPackages: ['@eanhl/db', 'postgres'],

  // Linting is a separate gate (`pnpm --filter web lint` / `pnpm smoke:quick`),
  // not part of producing the deployable artifact. `next build` otherwise runs
  // the repo's strict-type-checked ESLint config as a hard error gate, which
  // blocks deploys on purely stylistic violations even though `tsc --noEmit`
  // (the real type-correctness gate) passes. Keep build = compile, lint = lint.
  eslint: {
    ignoreDuringBuilds: true,
  },

  images: {
    remotePatterns: [
      {
        // EA Pro Clubs custom crest CDN — used for opponent logos only.
        // Our own club (Boogeymen) uses /images/bgm-logo.png instead.
        protocol: 'https',
        hostname: 'media.contentapi.ea.com',
        pathname: '/content/dam/eacom/nhl/pro-clubs/custom-crests/**',
      },
      {
        // EA Pro Clubs base crest CDN — used when customKit.useBaseAsset = "1".
        protocol: 'https',
        hostname: 'media.contentapi.ea.com',
        pathname: '/content/dam/eacom/nhl/pro-clubs/crests/**',
      },
    ],
  },
}

export default nextConfig
