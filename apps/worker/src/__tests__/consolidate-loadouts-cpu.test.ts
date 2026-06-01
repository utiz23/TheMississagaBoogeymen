/**
 * Commit 4 of 6 — CPU-goalie lineage fix.
 *
 * Verifies that the consolidate-loadouts CLI filters CPU placeholder rows
 * out of the grouping loop so they are never picked as anchors and never
 * marked review_status='reviewed'.
 *
 * The Step-1 reset (reviewed → pending_review) is intentionally left broad:
 * if a row was previously reviewed and is now reclassified as is_cpu=true,
 * the reset back to pending_review is the desired behavior.
 *
 * Test matrix:
 *   1. cpu+human-coexist     — CPU + human snapshots for same
 *                              (match, side, position) → only human marked
 *                              reviewed.
 *   2. cpu-only-empty-anchors — CPU-only slot produces zero anchors.
 *   3. cpu-row-unchanged     — CPU row's columns unchanged after consolidate
 *                              (no spurious UPDATE).
 *
 * Run via:
 *   pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/consolidate-loadouts-cpu.test.js
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import {
  db,
  sql as rawSql,
  matches,
  ocrCaptureBatches,
  ocrExtractions,
  playerLoadoutSnapshots,
} from '@eanhl/db'
import { eq, like } from 'drizzle-orm'

const GAME_TITLE_ID = 1 // NHL 26
const SENTINEL_TAG = 'test-sentinel-cpu-consolidate'

const REPO_ROOT = path.resolve(process.cwd())
const CLI_PATH = path.resolve(REPO_ROOT, 'apps/worker/dist/consolidate-loadouts-cli.js')

const sentinelMatchIds = new Set<number>()

async function cleanupMatch(matchId: number): Promise<void> {
  await db.delete(playerLoadoutSnapshots).where(eq(playerLoadoutSnapshots.matchId, matchId))
  await db.delete(ocrExtractions).where(eq(ocrExtractions.matchId, matchId))
  await db.delete(ocrCaptureBatches).where(eq(ocrCaptureBatches.matchId, matchId))
  await db.delete(matches).where(eq(matches.id, matchId))
}

async function cleanupAllSentinels(): Promise<void> {
  const stale = await db
    .select({ id: matches.id })
    .from(matches)
    .where(like(matches.eaMatchId, `${SENTINEL_TAG}-%`))
  for (const m of stale) {
    await cleanupMatch(m.id)
  }
  sentinelMatchIds.clear()
}

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanupAllSentinels()
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  for (const matchId of Array.from(sentinelMatchIds)) {
    try {
      await cleanupMatch(matchId)
    } catch {
      // sweep retries
    }
  }
  await cleanupAllSentinels()
  await rawSql.end({ timeout: 5 })
})

interface SentinelMatch {
  matchId: number
  loadoutExtractionId: number
  lobbyExtractionId: number
}

async function createSentinelMatch(suffix: string): Promise<SentinelMatch> {
  const [m] = await db
    .insert(matches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      eaMatchId: `${SENTINEL_TAG}-${suffix}`,
      matchType: 'gameType5',
      opponentClubId: '99999',
      opponentName: 'CPU-consolidate Sentinel Opp',
      playedAt: new Date('2026-01-01T00:00:00Z'),
      result: 'WIN',
      scoreFor: 1,
      scoreAgainst: 0,
      shotsFor: 1,
      shotsAgainst: 0,
      hitsFor: 0,
      hitsAgainst: 0,
    })
    .returning({ id: matches.id })
  assert.ok(m)
  sentinelMatchIds.add(m.id)

  const [batch] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      matchId: m.id,
      sourceDirectory: `/tmp/${SENTINEL_TAG}/${suffix}`,
      captureKind: 'manual_screenshots',
      notes: `${SENTINEL_TAG}-${suffix}`,
    })
    .returning({ id: ocrCaptureBatches.id })
  assert.ok(batch)

  // Loadout-view extraction — anchor preference picks this over lobby rows.
  const [loadoutX] = await db
    .insert(ocrExtractions)
    .values({
      batchId: batch.id,
      matchId: m.id,
      screenType: 'player_loadout_view',
      sourcePath: `/tmp/${SENTINEL_TAG}/${suffix}/loadout.png`,
      rawResultJson: {},
      transformStatus: 'success',
    })
    .returning({ id: ocrExtractions.id })
  assert.ok(loadoutX)

  // Lobby extraction — used for CPU placeholder rows.
  const [lobbyX] = await db
    .insert(ocrExtractions)
    .values({
      batchId: batch.id,
      matchId: m.id,
      screenType: 'pre_game_lobby_state_2',
      sourcePath: `/tmp/${SENTINEL_TAG}/${suffix}/lobby.png`,
      rawResultJson: {},
      transformStatus: 'success',
    })
    .returning({ id: ocrExtractions.id })
  assert.ok(lobbyX)

  return {
    matchId: m.id,
    loadoutExtractionId: loadoutX.id,
    lobbyExtractionId: lobbyX.id,
  }
}

interface SeedSnapshotOpts {
  matchId: number
  extractionId: number
  gamertagSnapshot: string
  position?: string
  teamSide?: 'for' | 'against'
  isCpu?: boolean
  reviewStatus?: 'pending_review' | 'reviewed' | 'rejected'
  heightText?: string | null
  weightLbs?: number | null
  handedness?: string | null
  buildClass?: string | null
}

async function seedSnapshot(opts: SeedSnapshotOpts): Promise<number> {
  const [row] = await db
    .insert(playerLoadoutSnapshots)
    .values({
      matchId: opts.matchId,
      ocrExtractionId: opts.extractionId,
      gameTitleId: GAME_TITLE_ID,
      playerId: null,
      gamertagSnapshot: opts.gamertagSnapshot,
      position: opts.position ?? 'G',
      teamSide: opts.teamSide ?? 'for',
      isCpu: opts.isCpu ?? false,
      reviewStatus: opts.reviewStatus ?? 'pending_review',
      heightText: opts.heightText ?? null,
      weightLbs: opts.weightLbs ?? null,
      handedness: opts.handedness ?? null,
      buildClass: opts.buildClass ?? null,
    })
    .returning({ id: playerLoadoutSnapshots.id })
  assert.ok(row)
  return row.id
}

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

function runCli(args: string[]): CliResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    encoding: 'utf8',
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

// ── 1. cpu+human-coexist ─────────────────────────────────────────────────
void test('CPU + human snapshots for same (match, side, position) → only human marked reviewed', async () => {
  if (!process.env['DATABASE_URL']) return
  const fx = await createSentinelMatch('coexist')

  // CPU placeholder row from lobby extraction.
  const cpuId = await seedSnapshot({
    matchId: fx.matchId,
    extractionId: fx.lobbyExtractionId,
    gamertagSnapshot: 'CPU',
    position: 'G',
    teamSide: 'for',
    isCpu: true,
    reviewStatus: 'pending_review',
  })

  // Human row from loadout-view extraction (preferred anchor).
  const humanId = await seedSnapshot({
    matchId: fx.matchId,
    extractionId: fx.loadoutExtractionId,
    gamertagSnapshot: 'someHuman',
    position: 'G',
    teamSide: 'for',
    isCpu: false,
    reviewStatus: 'pending_review',
  })

  const result = runCli(['--match', String(fx.matchId)])
  assert.equal(
    result.status,
    0,
    `CLI exit non-zero: stderr=${result.stderr} stdout=${result.stdout}`,
  )

  const [humanRow] = await db
    .select({ reviewStatus: playerLoadoutSnapshots.reviewStatus })
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.id, humanId))
  assert.equal(humanRow?.reviewStatus, 'reviewed', 'human anchor must be marked reviewed')

  const [cpuRow] = await db
    .select({ reviewStatus: playerLoadoutSnapshots.reviewStatus })
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.id, cpuId))
  assert.equal(
    cpuRow?.reviewStatus,
    'pending_review',
    'CPU row must NOT be marked reviewed (still pending_review)',
  )
})

// ── 2. cpu-only-empty-anchors ────────────────────────────────────────────
void test('CPU-only slot produces zero anchors', async () => {
  if (!process.env['DATABASE_URL']) return
  const fx = await createSentinelMatch('cpu-only')

  // Only CPU rows for (for, G). No human snapshot at all.
  const cpuId1 = await seedSnapshot({
    matchId: fx.matchId,
    extractionId: fx.lobbyExtractionId,
    gamertagSnapshot: 'CPU',
    position: 'G',
    teamSide: 'for',
    isCpu: true,
    reviewStatus: 'pending_review',
  })
  const cpuId2 = await seedSnapshot({
    matchId: fx.matchId,
    extractionId: fx.loadoutExtractionId,
    gamertagSnapshot: 'CPU',
    position: 'G',
    teamSide: 'for',
    isCpu: true,
    reviewStatus: 'pending_review',
  })

  const result = runCli(['--match', String(fx.matchId)])
  assert.equal(
    result.status,
    0,
    `CLI exit non-zero: stderr=${result.stderr} stdout=${result.stdout}`,
  )

  // Console output should report 0 canonical groups and 2 CPU rows skipped.
  assert.match(
    result.stdout,
    /0 canonical group\(s\) detected/,
    `expected '0 canonical group(s) detected' in stdout; got: ${result.stdout}`,
  )
  assert.match(
    result.stdout,
    /2 CPU row\(s\)/,
    `expected non-zero cpuSkipped count in stdout; got: ${result.stdout}`,
  )

  // Neither CPU row should be marked reviewed.
  const rows = await db
    .select({ id: playerLoadoutSnapshots.id, reviewStatus: playerLoadoutSnapshots.reviewStatus })
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, fx.matchId))
  for (const r of rows) {
    assert.notEqual(
      r.reviewStatus,
      'reviewed',
      `row ${r.id} should not be marked reviewed in CPU-only slot`,
    )
  }
  assert.ok(rows.some((r) => r.id === cpuId1))
  assert.ok(rows.some((r) => r.id === cpuId2))
})

// ── 3. cpu-row-unchanged ─────────────────────────────────────────────────
void test('CPU row\'s fields unchanged after consolidate (no spurious UPDATE)', async () => {
  if (!process.env['DATABASE_URL']) return
  const fx = await createSentinelMatch('unchanged')

  // Seed a CPU row with specific known values across the columns that the
  // consolidator would otherwise vote/overwrite. Also seed a human row in a
  // DIFFERENT slot so the CLI has work to do (exercise the full code path
  // including the per-group UPDATE) without touching the CPU row.
  const cpuId = await seedSnapshot({
    matchId: fx.matchId,
    extractionId: fx.lobbyExtractionId,
    gamertagSnapshot: 'CPU',
    position: 'G',
    teamSide: 'for',
    isCpu: true,
    reviewStatus: 'pending_review',
    heightText: '5\'11"',
    weightLbs: 190,
    handedness: 'Left',
    buildClass: 'Goalie',
  })

  await seedSnapshot({
    matchId: fx.matchId,
    extractionId: fx.loadoutExtractionId,
    gamertagSnapshot: 'someHuman',
    position: 'C',
    teamSide: 'for',
    isCpu: false,
    reviewStatus: 'pending_review',
  })

  // Snapshot the CPU row's full column state BEFORE the CLI runs.
  const [before] = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.id, cpuId))
  assert.ok(before, 'CPU row must exist before CLI run')

  const result = runCli(['--match', String(fx.matchId)])
  assert.equal(
    result.status,
    0,
    `CLI exit non-zero: stderr=${result.stderr} stdout=${result.stdout}`,
  )

  // Re-select and assert deep equality — every column must match.
  const [after] = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.id, cpuId))
  assert.ok(after, 'CPU row must still exist after CLI run')
  assert.deepEqual(after, before, 'CPU row columns must be byte-identical (no spurious UPDATE)')
})
