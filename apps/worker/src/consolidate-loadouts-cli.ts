/**
 * Cross-frame consensus for pre-game loadout/lobby snapshots.
 *
 * After ingesting all pre-game captures for a match, every player typically has
 * 3-5 raw snapshot rows from different captures (3 lobby captures + 1 loadout
 * capture per player). This CLI collapses them into ONE canonical row per
 * `(match_id, team_side, position)` by voting per field.
 *
 * Algorithm (v1 — simple majority, no CWMV weighting):
 *
 *   1. Reset all `reviewed` rows back to `pending_review` (idempotent).
 *   2. Group by `(team_side, position)`. Goalies (CPU) are skipped at ingest.
 *   3. Per group:
 *      a. Pick an anchor row — prefer loadout-view-sourced rows (they have
 *         X-Factors + attributes attached), tiebreak by gamertag confidence.
 *      b. For each field on the anchor, if its value is null, fill from the
 *         most-common non-null value across other rows in the group.
 *      c. For string fields where the anchor has a value, override with the
 *         most-common value if the anchor differs from the majority.
 *      d. Boolean fields (is_captain): true if ANY observation has true.
 *      e. Mark the anchor row `review_status = 'reviewed'`. Other rows stay
 *         at `pending_review` for audit.
 *
 * Usage:
 *   pnpm --filter worker consolidate-loadouts --match 250
 *   pnpm --filter worker consolidate-loadouts --match 250 --dry-run
 */

import {
  db,
  playerLoadoutSnapshots,
  sql as postgresSql,
  type OcrReviewStatus,
} from '@eanhl/db'
import { and, eq, sql } from 'drizzle-orm'

interface CliArgs {
  matchId: number
  dryRun: boolean
}

function parseArgs(): CliArgs {
  const matchIdStr = getFlag('match')
  if (!matchIdStr) throw new Error('Missing required --match <id>')
  const matchId = Number.parseInt(matchIdStr, 10)
  if (!Number.isFinite(matchId)) throw new Error(`Invalid --match: ${matchIdStr}`)
  return { matchId, dryRun: process.argv.includes('--dry-run') }
}

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

interface Snapshot {
  id: number
  playerId: number | null
  gamertagSnapshot: string
  playerNameSnapshot: string | null
  playerNamePersona: string | null
  playerNumber: number | null
  isCaptain: boolean | null
  teamSide: 'for' | 'against' | null
  position: string | null
  buildClass: string | null
  heightText: string | null
  weightLbs: number | null
  handedness: string | null
  playerLevelRaw: string | null
  playerLevelNumber: number | null
  platform: string | null
  sourceExtractionId: number
  screenType: string
  reviewStatus: OcrReviewStatus
}

async function readSnapshots(matchId: number): Promise<Snapshot[]> {
  const rows = await db.execute(sql`
    SELECT
      pls.id, pls.player_id AS "playerId", pls.gamertag_snapshot AS "gamertagSnapshot",
      pls.player_name_snapshot AS "playerNameSnapshot",
      pls.player_name_persona AS "playerNamePersona",
      pls.player_number AS "playerNumber", pls.is_captain AS "isCaptain",
      pls.team_side AS "teamSide", pls.position,
      pls.build_class AS "buildClass", pls.height_text AS "heightText",
      pls.weight_lbs AS "weightLbs", pls.handedness,
      pls.player_level_raw AS "playerLevelRaw", pls.player_level_number AS "playerLevelNumber",
      pls.platform, pls.source_extraction_id AS "sourceExtractionId",
      oe.screen_type AS "screenType",
      pls.review_status AS "reviewStatus"
    FROM player_loadout_snapshots pls
    JOIN ocr_extractions oe ON oe.id = pls.source_extraction_id
    WHERE pls.match_id = ${matchId}
    ORDER BY pls.id
  `)
  return rows as unknown as Snapshot[]
}

/** Pick the most-common non-null value, falling back to the anchor's value. */
function vote<T>(anchor: T | null, others: (T | null)[]): T | null {
  const counts = new Map<string, { count: number; value: T }>()
  const consider = [anchor, ...others].filter((v): v is T => v !== null && v !== undefined)
  for (const v of consider) {
    const key = JSON.stringify(v)
    const prev = counts.get(key)
    counts.set(key, { count: (prev?.count ?? 0) + 1, value: v })
  }
  if (counts.size === 0) return null
  // Sort by descending count; on tie, anchor wins (anchor is first in `consider`).
  let best: { count: number; value: T } | null = null
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry
  }
  return best?.value ?? null
}

function pickAnchor(group: Snapshot[]): Snapshot {
  // Prefer loadout_view source (has X-Factors + attributes).
  const loadoutRows = group.filter((s) => s.screenType === 'player_loadout_view')
  if (loadoutRows.length > 0) {
    // Tiebreak: most fields populated.
    return loadoutRows.reduce((best, r) =>
      countNonNull(r) > countNonNull(best) ? r : best,
    )
  }
  // No loadout — pick the lobby row with the most fields populated.
  return group.reduce((best, r) =>
    countNonNull(r) > countNonNull(best) ? r : best,
  )
}

function countNonNull(s: Snapshot): number {
  let n = 0
  for (const k of [
    'playerNameSnapshot', 'playerNamePersona', 'playerNumber', 'isCaptain',
    'buildClass', 'heightText', 'weightLbs', 'handedness', 'playerLevelNumber',
  ] as const) {
    if (s[k] !== null && s[k] !== undefined) n++
  }
  return n
}

interface ConsensusValues {
  playerNameSnapshot: string | null
  playerNamePersona: string | null
  playerNumber: number | null
  isCaptain: boolean | null
  buildClass: string | null
  heightText: string | null
  weightLbs: number | null
  handedness: string | null
  playerLevelRaw: string | null
  playerLevelNumber: number | null
  platform: string | null
}

function consensus(anchor: Snapshot, group: Snapshot[]): ConsensusValues {
  const others = group.filter((s) => s.id !== anchor.id)
  return {
    playerNameSnapshot: vote(anchor.playerNameSnapshot, others.map((s) => s.playerNameSnapshot)),
    playerNamePersona: vote(anchor.playerNamePersona, others.map((s) => s.playerNamePersona)),
    playerNumber: vote(anchor.playerNumber, others.map((s) => s.playerNumber)),
    // is_captain: OR across observations.
    isCaptain: [anchor, ...others].some((s) => s.isCaptain === true) ? true : null,
    buildClass: vote(anchor.buildClass, others.map((s) => s.buildClass)),
    heightText: vote(anchor.heightText, others.map((s) => s.heightText)),
    weightLbs: vote(anchor.weightLbs, others.map((s) => s.weightLbs)),
    handedness: vote(anchor.handedness, others.map((s) => s.handedness)),
    playerLevelRaw: vote(anchor.playerLevelRaw, others.map((s) => s.playerLevelRaw)),
    playerLevelNumber: vote(anchor.playerLevelNumber, others.map((s) => s.playerLevelNumber)),
    platform: vote(anchor.platform, others.map((s) => s.platform)),
  }
}

async function main(): Promise<void> {
  const args = parseArgs()
  console.log(`[consolidate] match=${args.matchId} dryRun=${args.dryRun ? 'yes' : 'no'}`)

  // Step 1: reset prior canonical rows back to pending_review (idempotent).
  if (!args.dryRun) {
    await db
      .update(playerLoadoutSnapshots)
      .set({ reviewStatus: 'pending_review' })
      .where(
        and(
          eq(playerLoadoutSnapshots.matchId, args.matchId),
          eq(playerLoadoutSnapshots.reviewStatus, 'reviewed'),
        ),
      )
  }

  const snapshots = await readSnapshots(args.matchId)
  console.log(`[consolidate] read ${snapshots.length} raw snapshot(s)`)

  // Step 2: group by (team_side, position).
  const groups = new Map<string, Snapshot[]>()
  for (const s of snapshots) {
    if (!s.position || !s.teamSide) continue  // skip unclassified rows
    const key = `${s.teamSide}|${s.position}`
    const arr = groups.get(key) ?? []
    arr.push(s)
    groups.set(key, arr)
  }
  console.log(`[consolidate] ${groups.size} canonical group(s) detected`)

  // Step 3: per-group consensus.
  let canonicalCount = 0
  for (const [key, group] of groups) {
    const anchor = pickAnchor(group)
    const merged = consensus(anchor, group)
    canonicalCount++
    console.log(
      `  ${key}: ${group.length} obs → anchor#${anchor.id} (${anchor.screenType}, gamertag="${anchor.gamertagSnapshot}")`,
    )
    for (const [k, v] of Object.entries(merged)) {
      const anchorVal = (anchor as unknown as Record<string, unknown>)[k]
      if (JSON.stringify(anchorVal) !== JSON.stringify(v)) {
        console.log(`    fix ${k}: ${JSON.stringify(anchorVal)} → ${JSON.stringify(v)}`)
      }
    }
    if (!args.dryRun) {
      await db
        .update(playerLoadoutSnapshots)
        .set({ ...merged, reviewStatus: 'reviewed' })
        .where(eq(playerLoadoutSnapshots.id, anchor.id))
    }
  }
  console.log(`[consolidate] ${canonicalCount} canonical row(s) ${args.dryRun ? 'would be' : ''} marked reviewed`)
  await postgresSql.end()
}

main().catch((err: unknown) => {
  console.error(err)
  void postgresSql.end()
  process.exitCode = 1
})
