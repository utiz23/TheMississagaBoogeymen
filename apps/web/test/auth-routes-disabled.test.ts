/**
 * BEHAVIOURAL test: the disabled account system, exercised by importing and
 * INVOKING the real route modules the app serves.
 *
 * WHAT THIS PROVES
 * ----------------
 * Authentication is deferred until after launch. The pre-launch site is public
 * and has no login, account, invitation, session, or administration surface.
 * This file imports the actual modules under `apps/web/src/app/` — not copies,
 * not extracted helpers — and asserts:
 *
 *   1. `/api/auth/*` answers 404 on GET and POST — and on every other method
 *      the route module exports, enumerated from the module rather than
 *      hardcoded, so a newly exported verb cannot escape the check.
 *   2. Every export of `src/app/account-actions.ts` refuses. A Server Action is
 *      reachable by its action id whether or not any form renders it, so "the
 *      page is a 404" says nothing on its own about whether the action can
 *      still be POSTed to. The exported names are enumerated from the module,
 *      so a reintroduced action is a failure rather than an omission.
 *   3. None of the above runs a single database query.
 *
 * (3) is the strong one, and it is what makes this more than a smoke test.
 * `@eanhl/db/queries` is substituted with ./db-queries-stub.mjs, which RECORDS
 * every query it is asked for. An empty call log after invoking every disabled
 * route and every disabled action is positive evidence that the refusals happen
 * BEFORE any database work — not that a query happened to return nothing. The
 * stub also answers `hasAccountUsers()` false and offers a non-empty claimable
 * roster, i.e. the exact state the removed public bootstrap form keyed off, so
 * a pass here is a pass against the dangerous condition.
 *
 * THE DISABLED PAGES ARE NOT HERE
 * -------------------------------
 * `/login`, `/account`, `/me` and `/admin/accounts` have NO module at all —
 * their `page.tsx` files are gone, so those URLs are as absent as any URL the
 * site never had, and Next answers them with its own 404. There is nothing to
 * import and invoke, which is why they are not in this file.
 *
 * That was not the first attempt. Tombstone pages that called `notFound()` were
 * tried and MEASURED AT 200: this app has a root `src/app/loading.tsx`, so every
 * page renders inside a Suspense boundary, the shell is flushed before the page
 * component runs, and a `notFound()` thrown after that cannot change a status
 * that has already gone out. `export const dynamic = 'force-dynamic'` did not
 * help. Deleting the modules does, and it is the stronger answer anyway.
 * Their 404s are proved end-to-end in ./disabled-routes-http.test.ts, against a
 * real server, and structurally in ../src/lib/account-system-disabled.test.ts.
 *
 * WHAT THIS DOES NOT PROVE
 * ------------------------
 * 1. Anything about the HTTP layer. That a route handler returns a 404 Response
 *    object is not the same statement as "the server sent 404 to a socket".
 *    ./disabled-routes-http.test.ts makes that statement.
 * 2. Anything about a real database — there is none here.
 * 3. That the dormant implementations under `src/deferred/auth/` stay
 *    disconnected from the route graph. That is a property of the source, and
 *    it is asserted in ../src/lib/account-system-disabled.test.ts.
 *
 * PROCESS ISOLATION
 * -----------------
 * The module substitution is process-wide, so this file runs in its OWN process
 * (`pnpm --filter web test:auth-disabled`) and is deliberately outside the
 * `src/**\/*.test.ts` glob the normal unit suite uses. The reverse guard — that
 * the unit suite gets the REAL module — is ../src/lib/db-queries-not-stubbed.test.ts.
 *
 * Run (needs the loader that makes a .tsx Server Component importable):
 *   pnpm --filter web test:auth-disabled
 *   # or, directly:
 *   cd apps/web && node --import ./test/register-loader.mjs \
 *     --test test/auth-routes-disabled.test.ts
 */

import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// The stub the loader substitutes for `@eanhl/db/queries`. Imported here by its
// real path so TypeScript can check it; Node resolves both specifiers to the
// same file URL, so this is the SAME module instance the modules under test
// received — `calls` is their real query log.
import { calls, resetStub } from './db-queries-stub.mjs'
import * as accountActions from '../src/app/account-actions'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Server Action names that must exist and must refuse. */
const ACCOUNT_ACTIONS = [
  'signInWithPassword',
  'signOutCurrentUser',
  'acceptInvite',
  'createInvite',
  'revokeInvite',
  'setUserDisabled',
  'assignClaim',
] as const

type AuthRouteModule = Record<string, unknown>

/** The `[...all]` segment is not a legal bare specifier, so resolve it by path. */
async function importAuthApiRoute(): Promise<AuthRouteModule> {
  const file = path.join(HERE, '../src/app/api/auth/[...all]/route.ts')
  return (await import(pathToFileURL(file).href)) as AuthRouteModule
}

beforeEach(() => {
  resetStub()
})

void test('harness integrity: this process really did get the query stub', async () => {
  // If the loader silently stopped applying, the "no query ran" assertions
  // below would still pass — against the real module, which needs a database
  // and would fail differently. Prove the substitution is live first.
  const queries = (await import('@eanhl/db/queries')) as unknown as Record<string, unknown>
  assert.ok('resetStub' in queries, 'the render stub must be installed for this process')
  assert.equal(
    queries.calls,
    calls,
    'the stub the app modules import must be the same module instance this file inspects',
  )
  assert.equal(
    await (queries.hasAccountUsers as () => Promise<boolean>)(),
    false,
    'the stub must simulate an empty users table — the dangerous answer',
  )
  resetStub()
})

void test('the auth API route answers 404 on GET and POST', async () => {
  const mod = await importAuthApiRoute()
  for (const method of ['GET', 'POST'] as const) {
    const handler = mod[method]
    assert.equal(typeof handler, 'function', `/api/auth/* must export ${method}`)
    const response = await (handler as () => Response | Promise<Response>)()
    assert.equal(response.status, 404, `${method} /api/auth/* must be 404`)
  }
  assert.deepEqual([...calls], [], '/api/auth/* must run no database query')
})

void test('every method the auth API route exports answers 404', async () => {
  const mod = await importAuthApiRoute()
  // Enumerated from the module, not hardcoded: a verb added later is covered
  // automatically instead of being quietly untested.
  const methods = Object.keys(mod).filter((key) => /^[A-Z]+$/.test(key))

  assert.ok(methods.includes('GET') && methods.includes('POST'), 'GET and POST must be exported')
  assert.ok(methods.length >= 5, `expected the handler's verbs, got ${methods.join(', ')}`)

  for (const method of methods) {
    const response = await (mod[method] as () => Response | Promise<Response>)()
    assert.equal(response.status, 404, `${method} /api/auth/* must be 404`)
  }
  assert.deepEqual([...calls], [], '/api/auth/* must run no database query on any method')
})

void test('the account-actions module exports exactly the refusing stubs', () => {
  const exported = Object.keys(accountActions as unknown as Record<string, unknown>).sort()
  assert.deepEqual(
    exported,
    [...ACCOUNT_ACTIONS].sort(),
    'a new export here is a new POST-able Server Action id — it must be accounted for',
  )
})

for (const name of ACCOUNT_ACTIONS) {
  void test(`the ${name} server action refuses before doing anything`, async () => {
    const action = (
      accountActions as unknown as Record<string, ((fd?: FormData) => Promise<never>) | undefined>
    )[name]
    assert.ok(typeof action === 'function', `${name} must still be exported`)

    const formData = new FormData()
    formData.set('email', 'attacker@example.test')
    formData.set('password', 'a-password-long-enough')
    formData.set('token', 'an-invite-token')
    formData.set('name', 'Attacker')
    formData.set('userId', 'some-user-id')
    formData.set('playerId', '1')
    formData.set('disabled', 'true')

    await assert.rejects(
      action(formData),
      (err: unknown) => {
        assert.ok(err instanceof Error, `${name} must reject with an Error`)
        assert.match(
          err.message,
          /disabled before launch/,
          `${name} must reject with the disabled-account refusal, got: ${err.message}`,
        )
        // A `redirect()` or `notFound()` would carry a digest. Neither is
        // acceptable here: bouncing the caller into auth UI is itself a
        // response from the account system.
        assert.equal(
          (err as { digest?: unknown }).digest,
          undefined,
          `${name} must not redirect — it must refuse outright`,
        )
        return true
      },
      `${name} must not succeed`,
    )

    assert.deepEqual(
      [...calls],
      [],
      `${name} must refuse before any database query — auth lookup, invite lookup, or write`,
    )
  })
}
