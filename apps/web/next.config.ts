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

  // Don't advertise the framework in every response.
  poweredByHeader: false,

  // Unlisted launch: keep every response out of search results. The header
  // also covers non-HTML responses; the page-level meta tag is set in
  // app/layout.tsx, and app/robots.ts explains why crawling stays allowed.
  //
  // The rest is standard browser hardening for a read-only site with no
  // logins: no framing by other sites (the legacy header and the CSP
  // directive), no MIME sniffing, no Referer leaking this unlisted URL to
  // other sites, no device APIs. The CSP sets ONLY frame-ancestors — it does
  // not restrict scripts or styles. HSTS is belt-and-braces: every .app domain
  // is already HTTPS-only in browsers through the TLD-wide preload list.
  // Checked over HTTP by test/disabled-routes-http.test.ts.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Referrer-Policy', value: 'same-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
        ],
      },
    ]
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
