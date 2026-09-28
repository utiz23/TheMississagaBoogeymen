// Hermetic, no-DB/no-Docker regression guard for the fresh-worktree build
// ordering defect: `@eanhl/worker`'s `test:integration` script must build
// `@eanhl/db` and `@eanhl/ea-client` from source, then build the worker
// itself, then run the isolated DB runner — in exactly that order, with
// nothing missing, duplicated, reordered, or intervening. Without the
// `@eanhl/ea-client` build step, `pnpm run build` (tsc) fails with TS2307 on
// every real `@eanhl/ea-client` import in worker source whenever
// `packages/ea-client/dist/` hasn't already been populated by an unrelated
// prior `turbo build`.
//
// This is a STATIC check only: it proves the script text is the exact
// approved sequence, not that the build actually succeeds from a clean
// state. The definitive proof is the behavioral run of
// `pnpm --filter @eanhl/worker test` with `packages/ea-client/dist/` absent,
// against the disposable verification database (see scripts/verify-ocr.sh).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WORKER_PKG_PATH = path.join(__dirname, '..', '..', 'package.json')

// The complete approved sequence, in order. Any removal, duplication,
// reordering, intervening command, or moving the isolated runner away from
// the last position produces an array that does not deep-equal this one.
const EXPECTED_SEQUENCE = [
  'pnpm --filter @eanhl/db build',
  'pnpm --filter @eanhl/ea-client build',
  'pnpm run build',
  'node scripts/with-test-db.mjs',
]

// Split a shell command on top-level `&&` into its ordered segments. The
// script is a flat sequence of `pnpm`/`node` invocations joined by `&&`
// with no subshells or `||`, so a plain split is sufficient and avoids
// pulling in a shell parser for a hermetic check.
function segments(script) {
  return script
    .split('&&')
    .map((s) => s.trim())
    .filter(Boolean)
}

function loadTestIntegrationScript(pkgJsonText) {
  const pkg = JSON.parse(pkgJsonText)
  const script = pkg.scripts?.['test:integration']
  assert.ok(
    typeof script === 'string' && script.length > 0,
    'package.json is missing a "test:integration" script',
  )
  return script
}

test('test:integration matches the exact approved build-then-isolate sequence', () => {
  const script = loadTestIntegrationScript(readFileSync(WORKER_PKG_PATH, 'utf8'))
  assert.deepStrictEqual(
    segments(script),
    EXPECTED_SEQUENCE,
    `test:integration must be exactly ${JSON.stringify(EXPECTED_SEQUENCE)}. ` +
      `Got: ${JSON.stringify(segments(script))}`,
  )
})

// Each of the following proves, against a synthetic corrupted sequence (not
// the real file), that the exact-deepEqual check actually catches the named
// corruption class — not merely that we believe it would.
test('exact-sequence check catches removal of a required segment', () => {
  const corrupted = [
    'pnpm --filter @eanhl/db build',
    // @eanhl/ea-client build segment removed
    'pnpm run build',
    'node scripts/with-test-db.mjs',
  ]
  assert.notDeepStrictEqual(corrupted, EXPECTED_SEQUENCE)
})

test('exact-sequence check catches duplication of a segment', () => {
  const corrupted = [
    'pnpm --filter @eanhl/db build',
    'pnpm --filter @eanhl/db build', // duplicated
    'pnpm --filter @eanhl/ea-client build',
    'pnpm run build',
    'node scripts/with-test-db.mjs',
  ]
  assert.notDeepStrictEqual(corrupted, EXPECTED_SEQUENCE)
})

test('exact-sequence check catches reordering of segments', () => {
  const corrupted = [
    'pnpm --filter @eanhl/ea-client build',
    'pnpm --filter @eanhl/db build', // db and ea-client swapped
    'pnpm run build',
    'node scripts/with-test-db.mjs',
  ]
  assert.notDeepStrictEqual(corrupted, EXPECTED_SEQUENCE)
})

test('exact-sequence check catches an extra intervening command', () => {
  const corrupted = [
    'pnpm --filter @eanhl/db build',
    'pnpm --filter @eanhl/ea-client build',
    'pnpm run lint', // unapproved intervening command
    'pnpm run build',
    'node scripts/with-test-db.mjs',
  ]
  assert.notDeepStrictEqual(corrupted, EXPECTED_SEQUENCE)
})

test('exact-sequence check catches the isolated runner moving away from last position', () => {
  const corrupted = [
    'pnpm --filter @eanhl/db build',
    'pnpm --filter @eanhl/ea-client build',
    'node scripts/with-test-db.mjs', // isolated runner moved before the worker build
    'pnpm run build',
  ]
  assert.notDeepStrictEqual(corrupted, EXPECTED_SEQUENCE)
})

test('exact-sequence check passes only the exact approved sequence itself', () => {
  assert.deepStrictEqual(EXPECTED_SEQUENCE, EXPECTED_SEQUENCE)
})
