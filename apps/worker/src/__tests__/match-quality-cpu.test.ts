/**
 * Commit 6a of 6 — CPU-goalie lineage fix.
 *
 * Verifies that the match-quality CLI's L3 denominator excludes CPU rows
 * from the playerLoadoutSnapshots query family (reviewedAnchors, attribute
 * join, x-factor join). Goalies (the only CPU-eligible position) have no
 * attributes or x-factors, so counting them inflates `expected` past what
 * the schema can possibly populate and makes L3 unsatisfiable.
 *
 * Test matrix:
 *   1. cpu-excluded-from-anchor-denominator —
 *      10 reviewed humans + 1 reviewed CPU goalie →
 *      anchors=10, expected_attrs=230, expected_xf=30.
 *
 * Run via:
 *   pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/match-quality-cpu.test.js
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
  playerLoadoutAttributes,
  playerLoadoutXFactors,
} from '@eanhl/db'
import { eq, inArray, like } from 'drizzle-orm'

const GAME_TITLE_ID = 1 // NHL 26
const SENTINEL_TAG = 'test-sentinel-cpu-quality'

const REPO_ROOT = path.resolve(process.cwd())
const CLI_PATH = path.resolve(REPO_ROOT, 'apps/worker/dist/match-quality-cli.js')

const sentinelMatchIds = new Set<number>()

async function cleanupMatch(matchId: number): Promise<void> {
  const snaps = await db
    .select({ id: playerLoadoutSnapshots.id })
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, matchId))
  const snapIds = snaps.map((s) => s.id)
  if (snapIds.length > 0) {
    await db
      .delete(playerLoadoutAttributes)
      .where(inArray(playerLoadoutAttributes.loadoutSnapshotId, snapIds))
    await db
      .delete(playerLoadoutXFactors)
      .where(inArray(playerLoadoutXFactors.loadoutSnapshotId, snapIds))
  }
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
      opponentName: 'CPU-quality Sentinel Opp',
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
  position: string
  teamSide: 'for' | 'against'
  isCpu: boolean
  reviewStatus?: 'pending_review' | 'reviewed' | 'rejected'
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
      position: opts.position,
      teamSide: opts.teamSide,
      isCpu: opts.isCpu,
      reviewStatus: opts.reviewStatus ?? 'reviewed',
    })
    .returning({ id: playerLoadoutSnapshots.id })
  assert.ok(row)
  return row.id
}

const ATTRIBUTE_KEYS = [
  'wrist_shot_accuracy',
  'slap_shot_accuracy',
  'speed',
  'balance',
  'agility',
  'wrist_shot_power',
  'slap_shot_power',
  'acceleration',
  'puck_control',
  'endurance',
  'passing',
  'offensive_awareness',
  'body_checking',
  'stick_checking',
  'defensive_awareness',
  'hand_eye',
  'strength',
  'durability',
  'shot_blocking',
  'deking',
  'faceoffs',
  'discipline',
  'fighting_skill',
] as const

async function seedFullLoadoutForSnapshot(snapshotId: number): Promise<void> {
  // 23 attributes
  await db.insert(playerLoadoutAttributes).values(
    ATTRIBUTE_KEYS.map((key) => ({
      loadoutSnapshotId: snapshotId,
      attributeKey: key,
      rawText: '90',
      value: 90,
      deltaValue: null,
      confidence: null,
    })),
  )
  // 3 x-factors
  await db.insert(playerLoadoutXFactors).values([
    { loadoutSnapshotId: snapshotId, slotIndex: 1, xFactorName: 'Shock & Awe', tier: 'Elite' },
    { loadoutSnapshotId: snapshotId, slotIndex: 2, xFactorName: 'Truculence', tier: 'All Star' },
    { loadoutSnapshotId: snapshotId, slotIndex: 3, xFactorName: 'Quick Pick', tier: 'Specialist' },
  ])
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
    maxBuffer: 8 * 1024 * 1024,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

interface DownstreamRow {
  table: string
  actual: number
  expected: number | null
  reviewed: number
  notes: string
}

function findRow(downstream: DownstreamRow[], table: string): DownstreamRow {
  const row = downstream.find((r) => r.table === table)
  assert.ok(row, `expected downstream row for table=${table}`)
  return row
}

// ── 1. cpu-excluded-from-anchor-denominator ──────────────────────────────
void test('10 reviewed humans + 1 reviewed CPU goalie → anchors=10, expected attrs=230, expected xf=30', async () => {
  if (!process.env['DATABASE_URL']) return
  const fx = await createSentinelMatch('anchor-denom')

  // 10 reviewed human snapshots split across both sides at varied positions.
  // The specific positions don't affect this test — what matters is that all
  // 10 are reviewed + non-CPU.
  const humanSpec: Array<{ pos: string; side: 'for' | 'against' }> = [
    { pos: 'C', side: 'for' },
    { pos: 'LW', side: 'for' },
    { pos: 'RW', side: 'for' },
    { pos: 'LD', side: 'for' },
    { pos: 'RD', side: 'for' },
    { pos: 'C', side: 'against' },
    { pos: 'LW', side: 'against' },
    { pos: 'RW', side: 'against' },
    { pos: 'LD', side: 'against' },
    { pos: 'RD', side: 'against' },
  ]
  const humanIds: number[] = []
  for (let i = 0; i < humanSpec.length; i++) {
    const s = humanSpec[i]!
    const id = await seedSnapshot({
      matchId: fx.matchId,
      extractionId: fx.loadoutExtractionId,
      gamertagSnapshot: `human-${String(i)}`,
      position: s.pos,
      teamSide: s.side,
      isCpu: false,
      reviewStatus: 'reviewed',
    })
    humanIds.push(id)
    await seedFullLoadoutForSnapshot(id)
  }

  // 1 reviewed CPU goalie — has NO attributes and NO x-factors (realistic).
  await seedSnapshot({
    matchId: fx.matchId,
    extractionId: fx.lobbyExtractionId,
    gamertagSnapshot: 'CPU',
    position: 'G',
    teamSide: 'against',
    isCpu: true,
    reviewStatus: 'reviewed',
  })

  const result = runCli(['--match', String(fx.matchId), '--json'])
  assert.equal(
    result.status,
    0,
    `CLI exit non-zero: stderr=${result.stderr} stdout=${result.stdout.slice(0, 500)}`,
  )

  const start = result.stdout.indexOf('{')
  assert.ok(start >= 0, `expected JSON object in stdout, got: ${result.stdout.slice(0, 500)}`)
  const json = JSON.parse(result.stdout.slice(start)) as { downstream: DownstreamRow[] }

  const anchorRow = findRow(json.downstream, 'player_loadout_snapshots (reviewed)')
  assert.equal(
    anchorRow.actual,
    10,
    `anchors must exclude CPU: actual=${String(anchorRow.actual)} (expected 10; CPU row should NOT count)`,
  )
  assert.equal(
    anchorRow.expected,
    10,
    `anchor expected stays at 10 literal: got ${String(anchorRow.expected)}`,
  )

  const attrRow = findRow(json.downstream, 'player_loadout_attributes')
  assert.equal(
    attrRow.expected,
    230,
    `attr expected must be 23 × 10 humans = 230, got ${String(attrRow.expected)} (would be 253 if CPU counted)`,
  )
  assert.equal(
    attrRow.actual,
    230,
    `attr actual must equal 230 (10 humans × 23 attrs, CPU has none), got ${String(attrRow.actual)}`,
  )

  const xfRow = findRow(json.downstream, 'player_loadout_x_factors')
  assert.equal(
    xfRow.expected,
    30,
    `x-factor expected must be 3 × 10 humans = 30, got ${String(xfRow.expected)} (would be 33 if CPU counted)`,
  )
  assert.equal(
    xfRow.actual,
    30,
    `x-factor actual must equal 30 (10 humans × 3 xf, CPU has none), got ${String(xfRow.actual)}`,
  )
})
