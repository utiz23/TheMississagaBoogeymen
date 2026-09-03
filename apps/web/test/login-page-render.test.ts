/**
 * BEHAVIOURAL regression test: render the real /login Server Component and
 * inspect the HTML it actually produces.
 *
 * WHAT THIS PROVES
 * ----------------
 * The original defect treated an EMPTY `users` table as authorization: /login
 * rendered a "Bootstrap Admin" form to any anonymous visitor, and the
 * `bootstrapAdmin` Server Action behind it created the site's first admin for
 * whoever posted to it first. On a freshly deployed public host that hands the
 * site to the first stranger who loads the page.
 *
 * This file imports `apps/web/src/app/login/page.tsx` itself — the module the
 * app serves, not a copy or an extracted helper — awaits it as the async
 * component it is, and renders the returned tree to HTML. The assertions are
 * about that HTML.
 *
 * There is NO DATABASE HERE. `@eanhl/db/queries` is substituted with
 * ./db-queries-stub.mjs, which SIMULATES the dangerous answers rather than
 * creating or querying an empty database: `hasAccountUsers()` returns FALSE and
 * the claimable-player roster is non-empty. Those are precisely the answers
 * under which the old page rendered the bootstrap form and the player picker,
 * so a pass here is a pass against the vulnerable condition rather than a
 * convenient one — but it is a simulation, and this file should never be cited
 * as evidence about a real database.
 *
 * It also asserts the page never CALLS `hasAccountUsers` or
 * `listClaimablePlayers`. That is the stronger claim, and it does not depend on
 * the simulated answers at all: a page that never asks for the user count
 * cannot branch on it, whatever a real database would have said.
 *
 * WHAT THIS DOES NOT PROVE
 * ------------------------
 * 1. Anything about a real database, empty or otherwise. The host-level
 *    behavioural proof is the `curl -s localhost:3000/login` check against the
 *    deployed response in Stage C of HANDOFF.md's Next Session.
 * 2. That the `bootstrapAdmin` Server Action is gone. A Server Action is
 *    reachable by its action id whether or not any form renders it, so its
 *    absence cannot be observed from rendered HTML at all. That is a structural
 *    property, asserted over the source in
 *    ../src/lib/no-public-admin-bootstrap.test.ts.
 *
 * PROCESS ISOLATION
 * -----------------
 * The module substitution is process-wide, so this file runs in its OWN process
 * (`pnpm --filter web test:login-render`) and is deliberately outside the
 * `src/**\/*.test.ts` glob the normal unit suite uses. The reverse guard —
 * that the unit suite gets the REAL module — is
 * ../src/lib/db-queries-not-stubbed.test.ts.
 *
 * Run (needs the loader that makes a .tsx Server Component importable):
 *   pnpm --filter web test:login-render
 *   # or, directly:
 *   cd apps/web && node --import ./test/register-loader.mjs \
 *     --test test/login-page-render.test.ts
 */

import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
// The stub the loader substitutes for `@eanhl/db/queries`. Imported here by its
// real path so TypeScript can check it; Node resolves both specifiers to the
// same file URL, so this is the SAME module instance the page under test
// received — these are the exact answers it saw, and `calls` is its real log.
import { calls, resetStub, setInvite } from './db-queries-stub.mjs'
import LoginPage from '../src/app/login/page'

type SearchParams = Record<string, string | string[] | undefined>

async function renderLogin(params: SearchParams = {}): Promise<string> {
  const element = await LoginPage({ searchParams: Promise.resolve(params) })
  return renderToStaticMarkup(element)
}

beforeEach(() => {
  resetStub()
})

void test('harness integrity: this process really did get the stub', async () => {
  // If the loader silently stopped applying, every "no bootstrap UI" assertion
  // below would still pass — against the real module, which needs a database
  // and would fail differently. Prove the substitution is live before trusting
  // anything else in this file.
  const queries = (await import('@eanhl/db/queries')) as unknown as Record<string, unknown>
  assert.ok('resetStub' in queries, 'the render stub must be installed for this process')
  assert.equal(
    queries.calls,
    calls,
    'the stub the page imports must be the same module instance this file inspects',
  )
  assert.equal(
    await (queries.hasAccountUsers as () => Promise<boolean>)(),
    false,
    'the stub must simulate an empty users table — the dangerous answer',
  )
  resetStub()
})

void test('renders the sign-in form under simulated empty-database answers', async () => {
  const html = await renderLogin()

  assert.ok(html.length > 0, 'the page must render something')
  assert.ok(html.includes('Sign In'), 'the sign-in panel must be rendered')
  assert.ok(html.includes('name="email"'), 'the sign-in form must have an email field')
  assert.ok(html.includes('name="password"'), 'the sign-in form must have a password field')
  assert.ok(html.includes('Account Login'), 'the page heading must be rendered')
})

void test('renders no bootstrap-admin UI under simulated empty-database answers', async () => {
  const html = await renderLogin()

  assert.ok(!/bootstrap/i.test(html), 'no bootstrap content may appear in the rendered page')
  assert.ok(!html.includes('Create Admin'), 'no admin-creation control may be rendered')
  assert.ok(
    !html.includes('First account only'),
    'the bootstrap explainer copy may not be rendered',
  )
  // The player picker existed only to seed the bootstrap form's claim; the
  // stub roster is non-empty, so a reintroduced picker would show these.
  assert.ok(!html.includes('name="playerId"'), 'no player-selection field may be rendered')
  assert.ok(!html.includes('Linked player'), 'no player-picker label may be rendered')
  assert.ok(
    !html.includes('StubRosterGamertag'),
    'the claimable-player roster must not leak to an anonymous visitor',
  )
})

void test('never issues the user-count query at all', async () => {
  await renderLogin()

  // Sanity first: the call log is wired to the same module the page used, so a
  // negative below is a real negative rather than an empty array. The invite
  // test at the bottom asserts the positive case — the page's one query DOES
  // land in this log.
  // A copy, not `calls` itself: node's strict deepEqual is a TypeScript
  // assertion signature and would narrow `calls` to never[] for the checks
  // below.
  assert.deepEqual([...calls], [], '/login must run no account queries with no token')
  assert.ok(
    !calls.includes('hasAccountUsers'),
    'a page that never reads the user count cannot branch on it — no database state, real or simulated, can produce a bootstrap form',
  )
  assert.ok(
    !calls.includes('listClaimablePlayers'),
    '/login must not fetch the claimable-player roster',
  )
})

void test('an unknown error code renders the generic message, not a bootstrap one', async () => {
  // The removed flow redirected here with bootstrap_closed / bootstrap_invalid
  // / bootstrap_failed. Those codes must no longer produce bespoke copy.
  for (const code of ['bootstrap_closed', 'bootstrap_invalid', 'bootstrap_failed']) {
    const html = await renderLogin({ error: code })
    assert.ok(
      html.includes('Unable to complete login.'),
      `error code ${code} must fall through to the generic message`,
    )
    assert.ok(!/bootstrap/i.test(html), `error code ${code} must not render bootstrap copy`)
  }
})

void test('still renders the invite-acceptance form for a usable invite token', async () => {
  // Guards against this suite passing because the page was gutted rather than
  // narrowed: invite-only account creation must survive.
  setInvite({
    id: 'invite-1',
    email: 'invited@example.test',
    role: 'user',
    claimedPlayerId: 1,
    claimedPlayerGamertag: 'InvitedPlayerGamertag',
    invitedByUserId: 'admin-1',
    expiresAt: new Date(Date.now() + 86_400_000),
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date(),
  })

  const html = await renderLogin({ token: 'a-token' })

  // Proves the call log observes the real page: this query came from the page
  // under test, through the same stub module the assertions above read.
  assert.ok(
    calls.includes('getAccountInviteByToken'),
    'the invite lookup must be visible in the stub call log',
  )
  assert.ok(
    !calls.includes('hasAccountUsers'),
    'even the invite branch must not read the user count',
  )

  assert.ok(html.includes('Accept Invite'), 'the invite panel must render for a usable invite')
  assert.ok(html.includes('InvitedPlayerGamertag'), 'the invite must name its linked player')
  assert.ok(html.includes('name="token"'), 'the invite form must carry the token')
  // ...and still no bootstrap path, on this branch either.
  assert.ok(!/bootstrap/i.test(html), 'the invite branch must not render bootstrap content')
  assert.ok(!html.includes('Create Admin'), 'the invite branch must not offer admin creation')
})
