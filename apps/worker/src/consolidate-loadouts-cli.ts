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
 *   2. Group by `(team_side, position)`. CPU placeholder rows are filtered
 *      here so they're never anchors.
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

import { db, playerLoadoutSnapshots, sql as postgresSql, type OcrReviewStatus } from '@eanhl/db'
import { and, eq, sql } from 'drizzle-orm'
import { normalizeBuildClass } from './lib/normalize-build-class.js'
import { resolvePersona } from './lib/normalize-persona.js'
import { resolveGamertagToPlayer } from './ocr-promoters/resolve-identity.js'

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
  gameTitleId: number
  ocrExtractionId: number
  screenType: string
  reviewStatus: OcrReviewStatus
  isCpu: boolean
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
      pls.platform, pls.game_title_id AS "gameTitleId",
      pls.ocr_extraction_id AS "ocrExtractionId",
      oe.screen_type AS "screenType",
      pls.review_status AS "reviewStatus",
      pls.is_cpu AS "isCpu"
    FROM player_loadout_snapshots pls
    JOIN ocr_extractions oe ON oe.id = pls.ocr_extraction_id
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

/**
 * Junk gamertags from OCR noise. `AWAY`/`HOME` come from section headers
 * the parser sometimes misclassifies as gamertags; single-char strings like
 * `m`/`?` are letter-segmentation failures; `(unknown)` is the sentinel used
 * when no gamertag field is present at all. Rows carrying these as their
 * primary gamertag have no useful fields and only poison group consensus.
 */
const JUNK_GAMERTAGS = new Set(['away', 'home', 'cpu', '?', '(unknown)'])

function isJunkGamertag(tag: string | null | undefined): boolean {
  if (!tag) return true
  const trimmed = tag.trim()
  if (trimmed.length <= 1) return true
  return JUNK_GAMERTAGS.has(trimmed.toLowerCase())
}

/**
 * Strict whitelist for the `platform` column. The OCR has historically
 * dropped gamertag strings into `player_platform` because of a misaligned
 * ROI; the read-time renderer also enforces this list, so anything outside
 * it is rejected here too — pre-vote — to keep the DB clean going forward.
 */
const PLATFORM_WHITELIST = new Set(['xbox', 'playstation', 'ps5', 'ps4', 'pc', 'switch'])

function sanitizePlatform(raw: string | null): string | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase()
  if (!key) return null
  return PLATFORM_WHITELIST.has(key) ? raw.trim() : null
}

/**
 * Returns the most-common non-junk gamertag in the group (used both as the
 * canonical value for the row and as a tiebreaker when picking the anchor).
 * Falls back to whatever gamertag appears most often, junk or otherwise,
 * so the function is total.
 */
function dominantGamertag(group: Snapshot[]): string {
  const counts = new Map<string, number>()
  for (const s of group) {
    const tag = s.gamertagSnapshot
    if (!tag || isJunkGamertag(tag)) continue
    counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  let best: { tag: string; count: number } | null = null
  for (const [tag, count] of counts) {
    if (!best || count > best.count) best = { tag, count }
  }
  if (best) return best.tag
  // No non-junk gamertag in the group; return the anchor's existing value
  // by falling back to the first snapshot's gamertag.
  return group[0]?.gamertagSnapshot ?? ''
}

/**
 * Normalize a gamertag for comparison: strip every non-alphanumeric char and
 * lowercase. This tolerates spacing/casing drift like `Stick Menace` vs
 * `StickMenace` while still rejecting OCR garbage variants like
 * `MrHomiecide Evoeni Wan` (which normalize to a different string).
 */
function normTag(tag: string | null | undefined): string {
  return (tag ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function pickAnchor(group: Snapshot[]): Snapshot {
  const dominantNorm = normTag(dominantGamertag(group))
  // Prefer loadout_view source (has X-Factors + attributes).
  const loadoutRows = group.filter((s) => s.screenType === 'player_loadout_view')
  const pool = loadoutRows.length > 0 ? loadoutRows : group
  // Within the pool, prefer rows whose normalized gamertag matches the
  // dominant value in the group — this rejects stale anchors whose gamertag
  // is a misattributed OCR variant (e.g. a `player_loadout_view` capture
  // where the title bar text bled in from a different player's screen).
  // Normalize on both sides so `Stick Menace` and `StickMenace` are
  // treated as the same identity.
  const matching = dominantNorm
    ? pool.filter((r) => normTag(r.gamertagSnapshot) === dominantNorm)
    : []
  const candidates = matching.length > 0 ? matching : pool
  // Among candidates matching the dominant gamertag, prefer the most recent
  // extraction (highest snapshot id). Older snapshots accumulate field
  // values written by prior consolidator runs (voted `player_name_persona`,
  // `is_captain`, etc.) which artificially inflate their non-null count.
  // A fresh extraction with fewer scalar fields populated is still a better
  // anchor than a stale one with consolidator-injected fields, because the
  // fresh row's parser output matches today's tuning. ID-ordering proxies
  // recency since ids are bigserial in insertion order.
  //
  // Field-count is used only when the dominant-gamertag filter found no
  // matches and we fell back to the whole loadout-view pool (no clear
  // identity signal — pick the meatiest row).
  if (matching.length > 0) {
    // `id` comes through node-postgres as a string for `bigint` columns,
    // so cast to Number before comparison — string ordering would put
    // "1446" before "509" and pick the older snapshot.
    return candidates.reduce((best, r) => (Number(r.id) > Number(best.id) ? r : best))
  }
  return candidates.reduce((best, r) => (countNonNull(r) > countNonNull(best) ? r : best))
}

function countNonNull(s: Snapshot): number {
  let n = 0
  for (const k of [
    'playerNameSnapshot',
    'playerNamePersona',
    'playerNumber',
    'isCaptain',
    'buildClass',
    'heightText',
    'weightLbs',
    'handedness',
    'playerLevelNumber',
  ] as const) {
    if (s[k] !== null && s[k] !== undefined) n++
  }
  return n
}

interface ConsensusValues {
  gamertagSnapshot: string
  playerNameSnapshot: string | null
  playerNamePersona: string | null
  /** Pre-alias-resolution OCR vote, written to player_name_persona_raw for audit. */
  playerNamePersonaRaw: string | null
  playerNumber: number | null
  isCaptain: boolean | null
  buildClass: string | null
  buildClassCanonical: string | null
  heightText: string | null
  weightLbs: number | null
  handedness: string | null
  playerLevelRaw: string | null
  playerLevelNumber: number | null
  platform: string | null
}

function consensus(anchor: Snapshot, group: Snapshot[]): ConsensusValues {
  const others = group.filter((s) => s.id !== anchor.id)
  // Gamertag: majority across the group (dominantGamertag also skips junk),
  // so an anchor whose own gamertag is a stale OCR misread doesn't poison
  // the canonical row.
  const gamertagSnapshot = dominantGamertag(group)
  const buildClass = vote(
    anchor.buildClass,
    others.map((s) => s.buildClass),
  )
  return {
    gamertagSnapshot,
    buildClass,
    buildClassCanonical: normalizeBuildClass(buildClass),
    playerNameSnapshot: vote(
      anchor.playerNameSnapshot,
      others.map((s) => s.playerNameSnapshot),
    ),
    // Persona is voted raw here; alias-table canonicalization happens inside
    // the per-anchor transaction below (resolvePersona) so the raw vote can
    // be preserved alongside the cleaned value.
    playerNamePersona: vote(
      anchor.playerNamePersona,
      others.map((s) => s.playerNamePersona),
    ),
    playerNamePersonaRaw: vote(
      anchor.playerNamePersona,
      others.map((s) => s.playerNamePersona),
    ),
    playerNumber: vote(
      anchor.playerNumber,
      others.map((s) => s.playerNumber),
    ),
    // is_captain: OR across observations.
    isCaptain: [anchor, ...others].some((s) => s.isCaptain === true) ? true : null,
    heightText: vote(
      anchor.heightText,
      others.map((s) => s.heightText),
    ),
    weightLbs: vote(
      anchor.weightLbs,
      others.map((s) => s.weightLbs),
    ),
    handedness: vote(
      anchor.handedness,
      others.map((s) => s.handedness),
    ),
    playerLevelRaw: vote(
      anchor.playerLevelRaw,
      others.map((s) => s.playerLevelRaw),
    ),
    playerLevelNumber: vote(
      anchor.playerLevelNumber,
      others.map((s) => s.playerLevelNumber),
    ),
    // Platform: reject anything outside the strict whitelist before voting
    // so old OCR garbage (gamertags landing in this column) never wins.
    platform: vote(
      sanitizePlatform(anchor.platform),
      others.map((s) => sanitizePlatform(s.platform)),
    ),
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

  // Step 2: group by (team_side, position). Junk-gamertag rows and CPU
  // placeholder rows are dropped here so they can't be picked as anchors
  // and can't pollute the gamertag/field votes within a group.
  const groups = new Map<string, Snapshot[]>()
  let junkSkipped = 0
  let cpuSkipped = 0
  for (const s of snapshots) {
    if (!s.position || !s.teamSide) continue // skip unclassified rows
    if (s.isCpu) {
      cpuSkipped++
      continue
    }
    if (isJunkGamertag(s.gamertagSnapshot)) {
      junkSkipped++
      continue
    }
    const key = `${s.teamSide}|${s.position}`
    const arr = groups.get(key) ?? []
    arr.push(s)
    groups.set(key, arr)
  }
  console.log(
    `[consolidate] ${groups.size} canonical group(s) detected (skipped ${junkSkipped} junk-gamertag row(s), ${cpuSkipped} CPU row(s))`,
  )

  // Step 3: per-group consensus.
  let canonicalCount = 0
  const unresolvedPersonas: {
    side: string
    position: string
    gamertag: string
    raw: string
  }[] = []
  const unresolvedGamertags: { side: string; position: string; gamertag: string }[] = []
  for (const [key, group] of groups) {
    const anchor = pickAnchor(group)
    const merged = consensus(anchor, group)
    // Re-resolve player_id from the voted gamertag — old loadout-view rows
    // were sometimes misattributed (e.g. snap 142 had player_id=11 but is
    // actually Stick Menace), and the voted gamertag is now correct.
    // resolveGamertagToPlayer expects a PromoterDb (transaction handle), so
    // we run the resolve + the update inside one short tx per anchor.
    await db.transaction(async (tx) => {
      const resolved = await resolveGamertagToPlayer(
        merged.gamertagSnapshot,
        anchor.gameTitleId,
        tx,
      )
      // Canonicalize the voted persona against the alias table. Raw vote is
      // preserved in playerNamePersonaRaw (already set in consensus()).
      const personaResolved = await resolvePersona(merged.playerNamePersona, tx)
      if (personaResolved && personaResolved.via !== 'raw') {
        console.log(
          `  ${key}: persona alias hit: "${merged.playerNamePersona}" → "${personaResolved.canonical}" (via ${personaResolved.via})`,
        )
        merged.playerNamePersona = personaResolved.canonical
      } else if (personaResolved && personaResolved.canonical !== merged.playerNamePersona) {
        // 'raw' path still strips ornaments; reflect the cleaned value.
        merged.playerNamePersona = personaResolved.canonical
      }
      if (personaResolved && personaResolved.via === 'raw') {
        unresolvedPersonas.push({
          side: anchor.teamSide ?? '?',
          position: anchor.position ?? '?',
          gamertag: merged.gamertagSnapshot,
          raw: personaResolved.canonical,
        })
      }
      // Only flag unresolved gamertags on the BGM (for) side — opp gamertags
      // live in opponent_player_match_stats and never get a players.id by design.
      if (resolved.playerId === null && merged.gamertagSnapshot && anchor.teamSide === 'for') {
        unresolvedGamertags.push({
          side: anchor.teamSide,
          position: anchor.position ?? '?',
          gamertag: merged.gamertagSnapshot,
        })
      }
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
      if (resolved.playerId !== anchor.playerId) {
        console.log(
          `    fix playerId: ${JSON.stringify(anchor.playerId)} → ${JSON.stringify(resolved.playerId)} (via ${resolved.via})`,
        )
      }
      if (!args.dryRun) {
        await tx
          .update(playerLoadoutSnapshots)
          .set({ ...merged, playerId: resolved.playerId, reviewStatus: 'reviewed' })
          .where(eq(playerLoadoutSnapshots.id, anchor.id))
      }
    })
  }
  console.log(
    `[consolidate] ${canonicalCount} canonical row(s) ${args.dryRun ? 'would be' : ''} marked reviewed`,
  )

  emitUnresolvedReport(unresolvedPersonas, unresolvedGamertags)

  await postgresSql.end()
}

function emitUnresolvedReport(
  personas: { side: string; position: string; gamertag: string; raw: string }[],
  gamertags: { side: string; position: string; gamertag: string }[],
): void {
  if (personas.length === 0 && gamertags.length === 0) return

  const pad = (s: string, n: number): string => s.padEnd(n).slice(0, n)

  if (personas.length > 0) {
    console.log('')
    console.log('--- UNRESOLVED PERSONAS (need player_persona_aliases seed) ---')
    for (const p of personas) {
      console.log(`  ${pad(p.side, 7)} ${pad(p.position, 4)} ${pad(p.gamertag, 24)} → ${p.raw}`)
    }
    const mapPairs = personas
      .map(
        (p) => `${p.raw}=>${p.raw.toUpperCase().replace(/\./g, '. ').replace(/\s+/g, ' ').trim()}`,
      )
      .join(',')
    console.log('Suggested:')
    console.log(`  pnpm --filter worker promote-persona-alias --map "${mapPairs}"`)
  }

  if (gamertags.length > 0) {
    console.log('')
    console.log('--- UNRESOLVED GAMERTAGS (no players row) ---')
    for (const g of gamertags) {
      console.log(`  ${pad(g.side, 7)} ${pad(g.position, 4)} ${g.gamertag}`)
    }
    console.log('Suggested:')
    for (const g of gamertags) {
      console.log(
        `  pnpm --filter worker create-player --gamertag "${g.gamertag}" --position ${g.position}`,
      )
    }
  }
}

main().catch((err: unknown) => {
  console.error(err)
  void postgresSql.end()
  process.exitCode = 1
})
