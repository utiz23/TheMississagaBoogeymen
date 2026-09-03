/**
 * DORMANT — the Better Auth catch-all API route, kept for the post-launch
 * account feature.
 *
 * Not imported by anything. `/api/auth/*` is still a route, but it resolves to
 * a tombstone handler in `src/app/api/auth/[...all]/route.ts` that imports
 * nothing and answers 404 on every method. See ./README.md.
 */

import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from './better-auth'

export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(auth)
