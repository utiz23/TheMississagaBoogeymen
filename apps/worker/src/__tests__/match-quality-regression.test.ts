/**
 * Match-quality regression gate. Runs the `match-quality --json` CLI against
 * the matches that the calibration work has already optimised (250 and 463),
 * parses the result, and asserts each layer score is at or above the floor
 * captured in `docs/calibration/regression-floor-match-{id}.json`.
 *
 * The floors are point-in-time snapshots: any code or data change that drops
 * a layer score below its captured floor will trip this test. Improvements
 * are fine (current ≥ floor passes). To intentionally rebaseline after a
 * green improvement, overwrite the regression-floor JSON files with fresh
 * `--json` output and commit the new floors.
 *
 * The test is integration-style — it requires DATABASE_URL pointing at a
 * Postgres with the calibration data present. Skips gracefully when the env
 * is unset (CI without DB runs the unit tests only).
 */

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const MATCHES_TO_GATE = [250, 463] as const
const REPO_ROOT = path.resolve(import.meta.dirname ?? '.', '../../../..')

interface LayerScore {
  score: number | null
  pass: boolean | null
}

interface QualitySnapshot {
  layers: {
    l1: LayerScore
    l2: LayerScore
    l2_lineup?: LayerScore
    l3: LayerScore
  }
}

after(async () => {
  // Best-effort sql connection cleanup; the CLI we spawned manages its own.
  if (process.env['DATABASE_URL']) {
    const { sql } = await import('@eanhl/db')
    await sql.end({ timeout: 1 }).catch(() => undefined)
  }
})

function skipIfNoDb(t: { skip: (msg: string) => void }): boolean {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — integration regression gate requires DB.')
    return true
  }
  return false
}

async function loadFloor(matchId: number): Promise<QualitySnapshot> {
  const filePath = path.join(
    REPO_ROOT,
    `docs/calibration/regression-floor-match-${String(matchId)}.json`,
  )
  const text = await readFile(filePath, 'utf8')
  // Tolerate the pnpm preamble lines that prefix the JSON when captured via shell.
  const start = text.indexOf('{')
  return JSON.parse(text.slice(start)) as QualitySnapshot
}

function runQualityCli(matchId: number): QualitySnapshot {
  const result = spawnSync(
    'node',
    [
      path.join(REPO_ROOT, 'apps/worker/dist/match-quality-cli.js'),
      '--match',
      String(matchId),
      '--json',
    ],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  )
  if (result.status !== 0) {
    throw new Error(`match-quality CLI failed for match ${String(matchId)}: ${result.stderr}`)
  }
  const start = result.stdout.indexOf('{')
  return JSON.parse(result.stdout.slice(start)) as QualitySnapshot
}

function compareLayer(
  name: string,
  current: LayerScore | undefined,
  floor: LayerScore | undefined,
): void {
  if (!floor || floor.score === null) return // floor has no signal — skip
  if (!current || current.score === null) {
    assert.fail(`${name}: current score is null but floor was ${(floor.score * 100).toFixed(1)}%`)
  }
  // Allow a sub-percent tolerance (0.5pp) for cosmetic floating-point drift.
  const tolerance = 0.005
  assert.ok(
    current.score + tolerance >= floor.score,
    `${name} regressed: current=${(current.score * 100).toFixed(2)}% floor=${(floor.score * 100).toFixed(2)}%`,
  )
}

for (const matchId of MATCHES_TO_GATE) {
  void test(`match ${String(matchId)} — layer scores at or above floor`, async (t) => {
    if (skipIfNoDb(t)) return
    const [floor, current] = await Promise.all([
      loadFloor(matchId),
      Promise.resolve(runQualityCli(matchId)),
    ])
    compareLayer(`match ${String(matchId)} L2 actor`, current.layers.l2, floor.layers.l2)
    compareLayer(
      `match ${String(matchId)} L2 lineup`,
      current.layers.l2_lineup,
      floor.layers.l2_lineup,
    )
    compareLayer(`match ${String(matchId)} L3 downstream`, current.layers.l3, floor.layers.l3)
  })
}
