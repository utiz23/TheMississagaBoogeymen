/**
 * Regression guard: the public first-visitor "Bootstrap Admin" path must stay
 * removed.
 *
 * WHAT THIS PROVES
 * ----------------
 * The original defect was that an EMPTY `users` table was treated as
 * authorization: `/login` rendered a "Bootstrap Admin" form to any anonymous
 * visitor, and the `bootstrapAdmin` server action would create an admin
 * account for whoever posted to it first. On a freshly deployed public host
 * that hands the site to the first stranger who loads it.
 *
 * The fix is structural, not conditional: the login page no longer reads the
 * user count at all, and there is no initial-admin server action to invoke.
 * These assertions are therefore made against the SOURCE, which is exactly the
 * right level — the property being defended is "this code does not exist",
 * and a behavioural test can only sample inputs, never prove absence.
 *
 * A Server Action is reachable by anyone who can guess or replay its action id
 * — it is not gated by whether a form is rendered. So removing the form alone
 * would be insufficient; the action itself must be gone. Both are asserted.
 *
 * Initial admin creation now lives in the operator CLI
 * `pnpm --filter worker init-admin`, covered by
 * apps/worker/src/__tests__/init-admin-cli.test.ts against an isolated DB.
 *
 * Run: node --test apps/web/src/lib/no-public-admin-bootstrap.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB_SRC = path.resolve(HERE, '..')
const LOGIN_PAGE = path.join(WEB_SRC, 'app/login/page.tsx')
const ACCOUNT_ACTIONS = path.join(WEB_SRC, 'app/account-actions.ts')

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

/** Every .ts/.tsx source file under apps/web/src. */
function webSourceFiles(): string[] {
  return readdirSync(WEB_SRC, { recursive: true })
    .filter((p): p is string => typeof p === 'string' && /\.tsx?$/.test(p))
    .map((p) => path.join(WEB_SRC, p))
}

void test('an empty users table cannot change what /login renders', () => {
  const src = read(LOGIN_PAGE)
  // The page must not consult the user count at all. If it never reads it, an
  // empty database is indistinguishable from a populated one at /login.
  assert.ok(
    !src.includes('hasAccountUsers'),
    '/login must not call hasAccountUsers() — an empty users table is not authorization',
  )
  assert.ok(!src.includes('hasUsers'), '/login must not branch on a user-count flag')
})

void test('/login renders no bootstrap-admin form', () => {
  const src = read(LOGIN_PAGE)
  assert.ok(
    !src.toLowerCase().includes('bootstrap'),
    '/login must contain no bootstrap markup or handler',
  )
  assert.ok(!src.includes('Create Admin'), '/login must not offer an admin-creation submit control')
  // The player picker only ever existed to seed the bootstrap form's claim.
  assert.ok(
    !src.includes('listClaimablePlayers'),
    '/login must not leak the claimable-player roster to anonymous visitors',
  )
  // The legitimate paths must still be there — this guard must not pass by
  // virtue of the page having been gutted.
  assert.ok(src.includes('signInWithPassword'), '/login must still offer sign-in')
  assert.ok(src.includes('acceptInvite'), '/login must still accept invites')
})

void test('no initial-admin server action exists to invoke directly', () => {
  const src = read(ACCOUNT_ACTIONS)
  assert.ok(
    !src.includes('export async function bootstrapAdmin'),
    'the bootstrapAdmin server action must not exist — a Server Action is callable by action id, independently of any rendered form',
  )
  assert.ok(!src.includes('createInitialAdmin'), 'no server action may call createInitialAdmin')
  // Invite-only creation survives the removal.
  assert.ok(src.includes('export async function acceptInvite'), 'invite acceptance must remain')
  assert.ok(src.includes('export async function createInvite'), 'admin invite issuing must remain')
})

void test('nothing web-reachable imports the initial-admin query', () => {
  const offenders = webSourceFiles().filter((file) => {
    if (file.endsWith('no-public-admin-bootstrap.test.ts')) return false
    const src = read(file)
    return src.includes('createInitialAdmin') || src.includes('createBootstrapAdmin')
  })
  assert.deepEqual(
    offenders.map((f) => path.relative(WEB_SRC, f)),
    [],
    'createInitialAdmin is operator-CLI-only; no file under apps/web/src may reference it',
  )
})
