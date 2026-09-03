'use server'

/**
 * TOMBSTONE — every account Server Action is disabled before launch.
 *
 * Authentication is deferred until after launch. The real implementations are
 * parked, dormant and non-routable, in `src/deferred/auth/account-actions.ts`,
 * with their `'use server'` directive removed so they mint no action ids.
 *
 * WHY THESE STUBS EXIST AT ALL
 * ----------------------------
 * A Next.js Server Action is reachable by its action id whether or not any form
 * renders it, so "the login page is a 404" says nothing on its own about
 * whether `signInWithPassword` can still be POSTed to. These exports keep the
 * names and hard-refuse: each throws on its first statement, before any auth
 * call, database query, password hash, redirect into auth UI, or write.
 *
 * This module imports NOTHING — not `@/deferred/auth/better-auth`, not
 * `@eanhl/db/queries`, not `better-auth/crypto`, not `next/navigation`. There
 * is therefore no auth or account implementation loaded on this path to reach,
 * and no `redirect()` that could bounce a caller into disabled auth UI.
 *
 * A thrown Error (not `notFound()`, not `redirect()`) is deliberate: a Server
 * Action that throws is a server error to the caller and a no-op to the
 * database, which is the correct answer to an invocation that should not be
 * possible.
 *
 * Covered by ../lib/account-system-disabled.test.ts and
 * ../../test/auth-routes-disabled.test.ts.
 */

const DISABLED =
  'The account system is disabled before launch. Authentication is deferred ' +
  'until after launch and no account action is available.'

/**
 * The refusal itself. `await`ed by each action below rather than thrown inline
 * so that these stay honest `async` functions under `require-await` — the
 * rejection is the point, the await is only how it is delivered.
 *
 * The actions are declared `Promise<void>`, not `Promise<never>`: TypeScript
 * does not treat `await` of a `Promise<never>` as an unreachable end point
 * (TS2534), and `void` is what a Server Action returns anyway.
 */
function refuse(action: string): Promise<never> {
  return Promise.reject(new Error(`${action}: ${DISABLED}`))
}

export async function signInWithPassword(_formData?: FormData): Promise<void> {
  await refuse('signInWithPassword')
}

export async function signOutCurrentUser(): Promise<void> {
  await refuse('signOutCurrentUser')
}

export async function acceptInvite(_formData?: FormData): Promise<void> {
  await refuse('acceptInvite')
}

export async function createInvite(_formData?: FormData): Promise<void> {
  await refuse('createInvite')
}

export async function revokeInvite(_formData?: FormData): Promise<void> {
  await refuse('revokeInvite')
}

export async function setUserDisabled(_formData?: FormData): Promise<void> {
  await refuse('setUserDisabled')
}

export async function assignClaim(_formData?: FormData): Promise<void> {
  await refuse('assignClaim')
}
