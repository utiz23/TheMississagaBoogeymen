/**
 * Extraction-regression gate for `lib/quality-layers.ts`.
 *
 * `computeLayers` was extracted verbatim from `match-quality-cli.ts` in Phase 2
 * of the Run-Level Quality Reporting workstream (plan
 * `/home/michal/.claude/plans/ok-plan-this-run-level-nifty-comet.md`). The
 * regression-floor JSONs at `docs/calibration/regression-floor-match-*.json`
 * are the byte-identical contract: any change to `computeLayers`'s arithmetic
 * or DB queries must reproduce the same `layers` object exactly.
 *
 * The test calls `computeLayers(matchId, downstream, flags)` in-process —
 * reusing the regression-floor's `downstream` + `flags` as inputs — and
 * deep-equals the result to the floor's `layers` object.
 *
 * Requires DATABASE_URL pointing at a Postgres with the calibration data
 * present (matches 250 + 463 ingested + reviewed). Skips when unset.
 *
 * Build + run:
 *   pnpm --filter @eanhl/db build
 *   pnpm --filter @eanhl/worker build
 *   set -a && source .env && set +a
 *   node --test apps/worker/dist/__tests__/quality-layers.test.js
 */

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  computeLayers,
  type DownstreamRow,
  type LayerScores,
  type QualityFlag,
} from '../lib/quality-layers.js'

const REPO_ROOT = path.resolve(import.meta.dirname ?? '.', '../../../..')
const MATCHES_TO_GATE = [250, 463] as const

interface RegressionFloor {
  layers: LayerScores
  downstream: DownstreamRow[]
  flags: QualityFlag[]
}

async function loadFloor(matchId: number): Promise<RegressionFloor> {
  const filePath = path.join(
    REPO_ROOT,
    `docs/calibration/regression-floor-match-${String(matchId)}.json`,
  )
  const text = await readFile(filePath, 'utf8')
  const start = text.indexOf('{')
  return JSON.parse(text.slice(start)) as RegressionFloor
}

after(async () => {
  if (process.env['DATABASE_URL']) {
    const { sql } = await import('@eanhl/db')
    await sql.end({ timeout: 1 }).catch(() => undefined)
  }
})

for (const matchId of MATCHES_TO_GATE) {
  void test(`computeLayers reproduces regression-floor layers for match ${String(matchId)}`, async (t) => {
    if (!process.env['DATABASE_URL']) {
      t.skip('DATABASE_URL not set — extraction-regression gate requires DB.')
      return
    }
    const floor = await loadFloor(matchId)
    const actual = await computeLayers(matchId, floor.downstream, floor.flags)
    assert.deepEqual(
      actual,
      floor.layers,
      `computeLayers output for match ${String(matchId)} diverged from regression-floor layers`,
    )
  })
}
