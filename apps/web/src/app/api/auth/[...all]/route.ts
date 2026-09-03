/**
 * TOMBSTONE — `/api/auth/*` is disabled before launch. Every method returns an
 * ordinary 404.
 *
 * Authentication is deferred until after launch. The Better Auth handler that
 * used to live here is parked, dormant and non-routable, in
 * `src/deferred/auth/auth-api-route.ts`.
 *
 * This module imports NOTHING. In particular it does not import
 * `better-auth/next-js` or `@/deferred/auth/better-auth`: a request to a
 * disabled endpoint must not construct Better Auth, read `BETTER_AUTH_SECRET`,
 * or touch the database merely to be answered with a 404.
 *
 * The catch-all segment means this covers every descendant — `/api/auth/session`,
 * `/api/auth/sign-in/email`, `/api/auth/callback/...`, everything.
 *
 * The five verbs the real handler exported (GET, POST, PATCH, PUT, DELETE) are
 * exported here so that each is answered with 404 rather than Next's 405 for an
 * unimplemented method, and HEAD/OPTIONS with them.
 */

function gone(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

export const GET = gone
export const POST = gone
export const PATCH = gone
export const PUT = gone
export const DELETE = gone
export const HEAD = gone
export const OPTIONS = gone

/** Never cache, and never prerender, a route whose whole job is to refuse. */
export const dynamic = 'force-dynamic'
