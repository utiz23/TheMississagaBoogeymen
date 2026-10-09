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

  // Client-side page cache. Links to data pages carry `prefetch`, so their full
  // page is fetched in the background and kept for `static` (Next's default,
  // 300s). `dynamic` covers a page reached WITHOUT a preload, notably the one a
  // visit started on: at the default 0 it is refetched on every return, and the
  // always-visible brand/Home links never preload it again because they never
  // leave the viewport. Matching both at 300s gives one rule: anything shown
  // while clicking around is at most 5 minutes old (the worker's own poll
  // interval); a browser refresh always renders fresh.
  experimental: {
    staleTimes: {
      dynamic: 300,
      static: 300,
    },
    // Server Actions (member/admin forms) reject a POST whose Origin differs
    // from the Host. Behind the Cloudflare tunnel the public origin is listed
    // explicitly so a rewritten Host can't make every action fail.
    serverActions: {
      allowedOrigins: ['boogeymen.app'],
    },
  },

  // Unlisted launch: keep every response out of search results. The header
  // also covers non-HTML responses; the page-level meta tag is set in
  // app/layout.tsx, and app/robots.ts explains why crawling stays allowed.
  //
  // The rest is standard browser hardening (the site's only writes are member
  // sign-in and the member/admin forms): no framing by other sites (the legacy header and the CSP
  // directive), no MIME sniffing, no Referer leaking this unlisted URL to
  // other sites, no device APIs. The CSP sets ONLY frame-ancestors — it does
  // not restrict scripts or styles. HSTS is belt-and-braces: every .app domain
  // is already HTTPS-only in browsers through the TLD-wide preload list.
  // Checked over HTTP by test/auth-http.test.ts.
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
      // Player-card textures/videos and badge icons (spec Part 2: cache headers at
      // the switch). Their names are not content-hashed, so a day plus a week of
      // background revalidation rather than immutable: a re-exported file still
      // reaches browsers within a day.
      ...['/images/cards/:path*', '/images/badges/:path*'].map((source) => ({
        source,
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      })),
    ]
  },

  images: {
    // Cache optimized images (logos, opponent crests) for 7 days, in browsers
    // and in the server's own image cache, instead of Next's 60s default, which
    // re-requested every image through the tunnel after a minute and
    // re-optimized it on the server. The URL is the cache key, so if
    // public/images/bgm-logo.png is ever replaced, give the new file a new
    // name; otherwise browsers keep showing the old logo for up to a week.
    // Opponent crest URLs carry their asset id, so a changed crest is a new URL.
    minimumCacheTTL: 604800,
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
