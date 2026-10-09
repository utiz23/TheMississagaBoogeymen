/**
 * Better Auth's endpoints (`/api/auth/*`): Discord sign-in and callback,
 * session, sign-out. Endpoints this site doesn't offer are closed in
 * `DISABLED_AUTH_PATHS` (src/lib/auth-config.ts) and answer 404.
 *
 * The handler is resolved per request so the auth instance (and its env check)
 * is built on first use, never at build time.
 */
import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '@/lib/auth'

type Handler = (request: Request) => Promise<Response>

function handle(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'): Handler {
  return (request) => toNextJsHandler(getAuth())[method](request)
}

export const GET = handle('GET')
export const POST = handle('POST')
export const PATCH = handle('PATCH')
export const PUT = handle('PUT')
export const DELETE = handle('DELETE')

export const dynamic = 'force-dynamic'
