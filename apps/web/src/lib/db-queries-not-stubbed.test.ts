/**
 * Test-harness integrity guard: the normal web unit suite must talk to the
 * REAL `@eanhl/db/queries`, never the render harness's stub.
 *
 * WHY THIS EXISTS
 * ---------------
 * `apps/web/test/login-page-render.test.ts` needs a Node module-resolution hook
 * that substitutes `@eanhl/db/queries` with `test/db-queries-stub.mjs`, so the
 * /login Server Component can be rendered under chosen query answers. That hook
 * is process-wide: anything imported in the same process gets the stub.
 *
 * It was briefly installed for the whole `src/**` suite. That is dangerous in a
 * quiet way — a future test importing `@eanhl/db/queries` would have silently
 * received a stub whose `hasAccountUsers()` always answers false, and would have
 * passed while asserting nothing about real behaviour. The suites are now split
 * into separate processes (`test:unit` and `test:login-render`), and this test
 * fails if they are ever recombined.
 *
 * HOW IT DETECTS THE STUB
 * -----------------------
 * The real module and the stub are distinguishable without a database:
 *
 *   - The real module transitively imports `@eanhl/db`'s client, which THROWS at
 *     import time when DATABASE_URL is unset. A rejection naming DATABASE_URL is
 *     therefore positive proof the real module was reached.
 *   - With DATABASE_URL set (postgres.js connects lazily, so no connection is
 *     opened), the real module exports `createInitialAdmin` and has no
 *     `resetStub`. The stub is the exact opposite.
 *
 * Both outcomes are accepted; only "the stub was loaded" fails.
 *
 * Run: node --test apps/web/src/lib/db-queries-not-stubbed.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

/** Exports that exist ONLY on apps/web/test/db-queries-stub.mjs. */
const STUB_ONLY_EXPORTS = ['resetStub', 'setInvite', 'calls']

void test('the unit suite resolves the real @eanhl/db/queries, not the render stub', async () => {
  let queries: Record<string, unknown>
  try {
    queries = (await import('@eanhl/db/queries')) as unknown as Record<string, unknown>
  } catch (err) {
    // The real module refuses to load without DATABASE_URL. That refusal is
    // itself the proof we wanted: the stub has no such requirement and would
    // have imported cleanly.
    const message = err instanceof Error ? err.message : String(err)
    assert.match(
      message,
      /DATABASE_URL/,
      `@eanhl/db/queries failed to import for an unexpected reason: ${message}`,
    )
    return
  }

  // It imported, so DATABASE_URL was set. Check which module we actually got.
  for (const name of STUB_ONLY_EXPORTS) {
    assert.ok(
      !(name in queries),
      `@eanhl/db/queries exported "${name}" — the login-render stub is installed for this ` +
        'process. The render harness must stay in its own process (pnpm run test:login-render); ' +
        'see apps/web/test/server-component-loader.mjs.',
    )
  }

  assert.ok(
    'createInitialAdmin' in queries,
    'the real @eanhl/db/queries must export createInitialAdmin — build it with ' +
      '`pnpm --filter @eanhl/db build`',
  )
  assert.ok(
    typeof queries.hasAccountUsers === 'function',
    'the real @eanhl/db/queries must export hasAccountUsers',
  )
})
