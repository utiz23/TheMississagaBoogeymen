/**
 * WS6 secondary-extractor robustness — Part 1.
 *
 * resolveBgmSide() now treats matches.bgm_was_home as AUTHORITATIVE (precedence
 * over the OCR team-name soft-match), falling back to the legacy OCR path only
 * when the flag is null. These are pure unit tests: the only DB interaction is a
 * single select, stubbed here so no live DB is needed.
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build && \
 *   node --test apps/worker/dist/ocr-promoters/__tests__/resolve-bgm-side.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveBgmSide } from '../resolve-bgm-side.js'
import type { PromoterDb } from '../index.js'

/** Stub the drizzle `select().from().where().limit()` chain to yield one row. */
function stubDb(row: { opponentName: string; bgmWasHome: boolean | null } | null): PromoterDb {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(row ? [row] : []),
  }
  return { select: () => chain } as unknown as PromoterDb
}

void test('bgm_was_home=false → away is BGM (for), even when OCR would resolve otherwise', async () => {
  // OCR labels deliberately name BGM as HOME ("bgm h"); the authoritative flag
  // (away) must win, proving precedence over the soft-match.
  const db = stubDb({ opponentName: 'Roc River Rats', bgmWasHome: false })
  const sides = await resolveBgmSide(2582, 'BGM', 'Roc River Rats', db)
  assert.deepEqual(sides, { awayIs: 'for', homeIs: 'against' })
})

void test('bgm_was_home=true → home is BGM (for)', async () => {
  const db = stubDb({ opponentName: 'Roc River Rats', bgmWasHome: true })
  const sides = await resolveBgmSide(123, 'PEKIUV:', 'Aalf.ara: .l c...a', db)
  assert.deepEqual(sides, { awayIs: 'against', homeIs: 'for' })
})

void test('bgm_was_home=null + clean OCR → legacy soft-match resolves', async () => {
  const db = stubDb({ opponentName: 'Roc River Rats', bgmWasHome: null })
  const sides = await resolveBgmSide(7, 'BGM (A)', 'Roc River Rats', db)
  assert.deepEqual(sides, { awayIs: 'for', homeIs: 'against' })
})

void test('bgm_was_home=null + garbled OCR → throws (fail-closed preserved)', async () => {
  const db = stubDb({ opponentName: 'Roc River Rats', bgmWasHome: null })
  await assert.rejects(
    () => resolveBgmSide(2582, 'PEKIUV:', 'Aalf.ara: .l c...a', db),
    /Cannot resolve BGM side/,
  )
})

void test('match not found → throws', async () => {
  const db = stubDb(null)
  await assert.rejects(() => resolveBgmSide(999, 'a', 'b', db), /not found in matches table/)
})
