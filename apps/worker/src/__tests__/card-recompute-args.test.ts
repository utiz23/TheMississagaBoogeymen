/**
 * Pure: no database.
 *   pnpm --filter @eanhl/worker build
 *   node --test apps/worker/dist/__tests__/card-recompute-args.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCardRecomputeArgs } from '../card-recompute-args.js'

void test('known flags parse; none means a plain write', () => {
  assert.deepEqual(parseCardRecomputeArgs([]), { dryRun: false, rebase: false })
  assert.deepEqual(parseCardRecomputeArgs(['--rebase', '--dry-run']), {
    dryRun: true,
    rebase: true,
  })
})

void test('an unknown argument stops the command (a typo must not run a real rebase)', () => {
  assert.throws(
    () => parseCardRecomputeArgs(['--rebase', '--dryrun']),
    /unknown argument: --dryrun/,
  )
})
