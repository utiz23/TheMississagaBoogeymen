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
 * The database state it renders under is the dangerous one, chosen on purpose
 * (see test/db-queries-stub.mjs): `hasAccountUsers()` answers FALSE, and the
 * claimable-player roster is non-empty. Under exactly these answers the old
 * page rendered the bootstrap form and the player picker. So a pass here is a
 * pass against the vulnerable condition, not against a convenient one.
 *
 * It also asserts the page never CALLS `hasAccountUsers` or
 * `listClaimablePlayers`. That is the stronger claim: a page that never asks
 * for the user count cannot branch on it, whatever the answer would have been,
 * so no database state can make a bootstrap form appear.
 *
 * WHAT THIS DOES NOT PROVE
 * ------------------------
 * That the `bootstrapAdmin` Server Action is gone. A Server Action is reachable
 * by its action id whether or not any form renders it, so its absence cannot be
 * observed from rendered HTML at all. That is a structural property, asserted
 * over the source in ../../lib/no-public-admin-bootstrap.test.ts.
 *
 * Run (needs the loader that makes a .tsx Server Component importable):
 *   pnpm --filter web test
 *   # or, this file alone:
 *   cd apps/web && node --import ./test/register-loader.mjs \
 *     --test src/app/login/login-page-render.test.ts
 */

import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
// The stub the loader substitutes for `@eanhl/db/queries`. Imported here by its
// real path so TypeScript can check it; Node resolves both specifiers to the
// same file URL, so this is the SAME module instance the page under test
// received — these are the exact answers it saw, and `calls` is its real log.
import { calls, resetStub, setInvite } from '../../../test/db-queries-stub.mjs'
import LoginPage from './page'

type SearchParams = Record<string, string | string[] | undefined>

async function renderLogin(params: SearchParams = {}): Promise<string> {
  const element = await LoginPage({ searchParams: Promise.resolve(params) })
  return renderToStaticMarkup(element)
}

beforeEach(() => {
  resetStub()
})

void test('renders the sign-in form against an EMPTY users table', async () => {
  const html = await renderLogin()

  assert.ok(html.length > 0, 'the page must render something')
  assert.ok(html.includes('Sign In'), 'the sign-in panel must be rendered')
  assert.ok(html.includes('name="email"'), 'the sign-in form must have an email field')
  assert.ok(html.includes('name="password"'), 'the sign-in form must have a password field')
  assert.ok(html.includes('Account Login'), 'the page heading must be rendered')
})

void test('renders no bootstrap-admin UI against an EMPTY users table', async () => {
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

void test('never asks the database whether any user exists', async () => {
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
    'a page that never reads the user count cannot branch on it — no database state can produce a bootstrap form',
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
