/**
 * STRUCTURAL guard: assertions over source text, not over behaviour.
 *
 * WHAT THIS IS, HONESTLY
 * ----------------------
 * Every assertion in this file greps source files. It proves that certain code
 * is not written anywhere under apps/web/src. It does NOT execute the app, and
 * it cannot tell you what the app does — a rename, a re-export, or a dynamic
 * import would satisfy these checks while reintroducing the hole. Read it as a
 * tripwire that makes an obvious regression noisy, not as proof of safety.
 *
 * The behavioural evidence lives in
 * ../app/login/login-page-render.test.ts, which renders the real /login Server
 * Component against an EMPTY users table and asserts on the HTML it produces.
 * That file is the primary regression test. This one covers the part rendering
 * cannot reach.
 *
 * WHAT ONLY SOURCE CAN COVER
 * --------------------------
 * A Next.js Server Action is reachable by its action id whether or not any form
 * renders it. So "no bootstrap form appears in the HTML" — which the render test
 * does prove — says nothing about whether a `bootstrapAdmin` action still exists
 * and is still invocable by a crafted POST. Absence of an action, and absence of
 * any web-reachable reference to the operator-only `createInitialAdmin` query,
 * are properties of the code rather than of any single render, and greping the
 * source is the available way to check them.
 *
 * The two page-source checks below (no user-count read, no bootstrap markup)
 * overlap with the render test on purpose. They are cheap, they name the exact
 * symbol to remove, and they fail fast; the render test is what actually
 * establishes the behaviour.
 *
 * Initial admin creation now lives in the operator CLI
 * `pnpm --filter worker init-admin`, covered end-to-end against an isolated
 * database in apps/worker/src/__tests__/init-admin-cli.test.ts.
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

/**
 * Every SHIPPED .ts/.tsx source file under apps/web/src.
 *
 * Test files are excluded: the property being defended is that no
 * WEB-REACHABLE code can invoke initial-admin creation, and a `*.test.ts` file
 * is never served, bundled, or reachable over HTTP. Including them would also
 * make the check self-defeating — this file and
 * db-queries-not-stubbed.test.ts both name the query in order to assert things
 * about it.
 */
function webSourceFiles(): string[] {
  return readdirSync(WEB_SRC, { recursive: true })
    .filter((p): p is string => typeof p === 'string' && /\.tsx?$/.test(p))
    .filter((p) => !/\.test\.tsx?$/.test(p))
    .map((p) => path.join(WEB_SRC, p))
}

void test('structural: /login source never reads the user count', () => {
  const src = read(LOGIN_PAGE)
  // Behaviourally established in login-page-render.test.ts; asserted here too
  // because this names the exact symbol whose reintroduction is the defect.
  assert.ok(
    !src.includes('hasAccountUsers'),
    '/login must not call hasAccountUsers() — an empty users table is not authorization',
  )
  assert.ok(!src.includes('hasUsers'), '/login must not branch on a user-count flag')
})

void test('structural: /login source contains no bootstrap-admin form', () => {
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

void test('structural: no initial-admin server action exists to invoke directly', () => {
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

void test('structural: nothing web-reachable imports the initial-admin query', () => {
  const offenders = webSourceFiles().filter((file) => {
    const src = read(file)
    return src.includes('createInitialAdmin') || src.includes('createBootstrapAdmin')
  })
  assert.deepEqual(
    offenders.map((f) => path.relative(WEB_SRC, f)),
    [],
    'createInitialAdmin is operator-CLI-only; no shipped file under apps/web/src may reference it',
  )
})
