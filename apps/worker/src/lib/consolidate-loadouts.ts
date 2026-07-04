/**
 * Cross-frame consensus for pre-game loadout/lobby snapshots — library form.
 *
 * Extracted from `consolidate-loadouts-cli.ts` (Tier 0 WS0.1A) so the same
 * consolidation logic can run two ways:
 *   - standalone CLI (`consolidate-loadouts-cli.ts`, module-level `db`), and
 *   - INSIDE the `decoder-runs activate` transaction (passing the outer `tx`),
 *     so the activate quality gate scores the consolidated `reviewed` anchors
 *     rather than the pre-consolidation `pending_review` rows.
 *
 * `options.db` accepts the top-level `Database` or a `PgTransaction`
 * (`DbOrTx`). The per-anchor `conn.transaction(...)` opens a savepoint when
 * `conn` is already a transaction (Drizzle nested-transaction semantics), so
 * the per-anchor atomicity is preserved either way.
 *
 * Algorithm (v1 — simple majority, no CWMV weighting):
 *   1. Reset all `reviewed` rows back to `pending_review` (idempotent).
 *   2. Group by `(team_side, position)`. CPU placeholder + junk-gamertag rows
 *      are filtered so they're never anchors and never pollute votes.
 *   3. Per group: pick an anchor (prefer loadout-view source, tiebreak by the
 *      dominant gamertag + recency), vote each field, re-resolve player_id +
 *      persona, mark the anchor `reviewed`.
 *
 * NO behaviour change vs the prior inline CLI implementation. The
 * match-250 benchmark + consolidate-loadouts-cpu tests are the contract.
 */

import {
  db as defaultDb,
  playerLoadoutSnapshots,
  type Database,
  type OcrReviewStatus,
} from '@eanhl/db'
import { getActiveRunIdForMatch } from '@eanhl/db/queries'
import { and, eq, sql } from 'drizzle-orm'
import { normalizeBuildClass } from './normalize-build-class.js'
import { resolvePersona } from './normalize-persona.js'
import { resolveGamertagToPlayer } from '../ocr-promoters/resolve-identity.js'
import type { DbOrTx } from '../ocr-promoters/index.js'

export interface UnresolvedPersona {
  side: string
  position: string
  gamertag: string
  raw: string
}

export interface UnresolvedGamertag {
  side: string
  position: string
  gamertag: string
}

export interface ConsolidateLoadoutsResult {
  rawSnapshotCount: number
  groupCount: number
  junkSkipped: number
  cpuSkipped: number
  canonicalCount: number
  unresolvedPersonas: UnresolvedPersona[]
  unresolvedGamertags: UnresolvedGamertag[]
}

export interface ConsolidateLoadoutsOptions {
  db?: DbOrTx
  dryRun?: boolean
  /** Sink for progress lines. Defaults to a no-op so callers (e.g. the
   *  activate gate, whose stdout carries machine-readable JSON) stay quiet
   *  unless they opt in. The standalone CLI passes `console.log`. */
  log?: (msg: string) => void
  /**
   * Phase F: the decoder run whose `ocr_field_evidence` supplies the per-field
   * OCR confidence used to weight the cross-source vote and pick the anchor.
   * The activate path passes the run being activated (already flipped active in
   * the outer tx); the standalone CLI passes the active run id. When `undefined`,
   * the lib resolves the match's active run itself; when explicitly `null`, only
   * NULL-run (legacy) evidence is considered — matching the promoter run-scope
   * semantics in `getFieldEvidenceForLoadoutSlot`.
   */
  runId?: number | null
}

export interface Snapshot {
  id: number
  playerId: number | null
  gamertagSnapshot: string
  playerNameSnapshot: string | null
  playerNamePersona: string | null
  playerNumber: number | null
  isCaptain: boolean | null
  /** Phase D: visual gold-★ score (numeric(5,4) → string from pg). NULL on
   *  snapshots predating Phase D or scored without a frame. */
  isCaptainConfidence: string | null
  /** Phase F: the extractor slot key this snapshot was promoted from
   *  (`lobby_{side}_{POS}` or `loadout_slot_seg{NNNN}_subject{NN}`). Keys the
   *  join to `ocr_field_evidence` for confidence weighting. NULL on snapshots
   *  predating Phase F or from the legacy per-extraction promoter. */
  subjectSlotKey: string | null
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

async function readSnapshots(conn: DbOrTx, matchId: number): Promise<Snapshot[]> {
  const rows = await conn.execute(sql`
    SELECT
      pls.id, pls.player_id AS "playerId", pls.gamertag_snapshot AS "gamertagSnapshot",
      pls.player_name_snapshot AS "playerNameSnapshot",
      pls.player_name_persona AS "playerNamePersona",
      pls.player_number AS "playerNumber", pls.is_captain AS "isCaptain",
      pls.is_captain_confidence AS "isCaptainConfidence",
      pls.subject_slot_key AS "subjectSlotKey",
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

/**
 * Phase F confidence map: `subjectSlotKey → (evidence field_key → calibrated
 * confidence)`. Built once per consolidation from `ocr_field_evidence`
 * (candidate_rank = 0, MAX over segments) so the cross-source vote can weight
 * each observation by how confident the extractor was.
 */
export type FieldConfidenceMap = Map<string, Map<string, number>>

/**
 * Fetch the top-candidate (rank 0) calibrated confidence per (slot, field) for
 * this run, aggregated by MAX across segments. Keyed by `subject_slot_key`
 * (lobby and loadout keys are disjoint by prefix, so no collision) and the RAW
 * evidence `field_key` — which the source-aware map below normalizes back into
 * the snapshot-column space.
 *
 * Run scope mirrors `getFieldEvidenceForLoadoutSlot`: a concrete `runId` scopes
 * to that run; `null` scopes to NULL-run (legacy) evidence; `undefined` uses the
 * live filter (NULL-run OR the active run).
 */
async function readFieldConfidence(
  conn: DbOrTx,
  matchId: number,
  runId: number | null | undefined,
): Promise<FieldConfidenceMap> {
  const runScope =
    runId === undefined
      ? sql`(fe.run_id IS NULL OR fe.run_id IN (SELECT id FROM ocr_decoder_runs WHERE is_active = true))`
      : runId === null
        ? sql`fe.run_id IS NULL`
        : sql`fe.run_id = ${runId}`
  const rows = await conn.execute(sql`
    SELECT fe.subject_slot_key AS "slotKey", fe.field_key AS "fieldKey",
           MAX(fe.calibrated_confidence) AS "conf"
    FROM ocr_field_evidence fe
    WHERE fe.match_id = ${matchId}
      AND fe.candidate_rank = 0
      AND fe.subject_slot_key IS NOT NULL
      AND ${runScope}
    GROUP BY fe.subject_slot_key, fe.field_key
  `)
  const map: FieldConfidenceMap = new Map()
  for (const r of rows as unknown as {
    slotKey: string
    fieldKey: string
    conf: string | number | null
  }[]) {
    if (r.conf === null) continue
    const c = Number(r.conf)
    if (Number.isNaN(c)) continue
    let slotMap = map.get(r.slotKey)
    if (!slotMap) {
      slotMap = new Map()
      map.set(r.slotKey, slotMap)
    }
    slotMap.set(r.fieldKey, c)
  }
  return map
}

/**
 * The voted scalar snapshot columns that Phase F weights by confidence.
 * gamertag (dominantGamertag) and is_captain (resolveSideCaptains) are resolved
 * separately and are intentionally excluded. Exported as a runtime array so the
 * field-map coverage test can assert every voted column resolves a confidence
 * (the finding-2 guard against silent weight-misses on height/weight/platform).
 */
export const VOTED_COLUMNS = [
  'buildClass',
  'playerNameSnapshot',
  'playerNamePersona',
  'playerNumber',
  'heightText',
  'weightLbs',
  'handedness',
  'playerLevelRaw',
  'playerLevelNumber',
  'platform',
] as const
export type VotedColumn = (typeof VOTED_COLUMNS)[number]

/**
 * Source-aware map from a snapshot column to its RAW `ocr_field_evidence`
 * field_key. The SAME column is keyed differently by source — the lobby
 * extractor emits `player_number`/`height_text`/`weight_lbs`/`platform`, while
 * the loadout extractor emits `jersey_number`/`height`/`weight`/`player_platform`
 * (and `persona_raw`/`player_name_full`). Consolidation owns this map explicitly
 * rather than borrowing the loadout promoter's `FIELD_KEY_ALIASES` (which covers
 * only jersey_number/persona_raw and would silently drop height/weight/platform).
 * Verified against lobby-v2.ts:473-490 and loadout-v2.ts:659-727.
 */
export const EVIDENCE_KEY_BY_SOURCE: Record<
  'lobby' | 'loadout',
  Partial<Record<VotedColumn, string>>
> = {
  lobby: {
    buildClass: 'build_class',
    playerNamePersona: 'player_name_persona',
    playerNumber: 'player_number',
    heightText: 'height_text',
    weightLbs: 'weight_lbs',
    handedness: 'handedness',
    playerLevelRaw: 'player_level_raw',
    playerLevelNumber: 'player_level_number',
    platform: 'platform',
    // playerNameSnapshot: lobby writes null → no evidence key.
  },
  loadout: {
    buildClass: 'build_class',
    playerNameSnapshot: 'player_name_full',
    playerNamePersona: 'persona_raw',
    playerNumber: 'jersey_number',
    heightText: 'height',
    weightLbs: 'weight',
    handedness: 'handedness',
    playerLevelRaw: 'player_level_raw',
    playerLevelNumber: 'player_level_number',
    platform: 'player_platform',
  },
}

/** Classify a snapshot's source by its slot-key prefix, falling back to screenType. */
export function snapshotSource(s: Snapshot): 'lobby' | 'loadout' {
  const k = s.subjectSlotKey
  if (k?.startsWith('lobby_')) return 'lobby'
  if (k?.startsWith('loadout_slot')) return 'loadout'
  return s.screenType === 'player_loadout_view' ? 'loadout' : 'lobby'
}

/**
 * Per-observation confidence for one voted column, or `null` when this slot has
 * no evidence for it (→ weight-1 fallback, never a silent zero-weight drop).
 */
export function fieldConfidence(
  s: Snapshot,
  column: VotedColumn,
  confBySlot: FieldConfidenceMap,
): number | null {
  if (!s.subjectSlotKey) return null
  const slotMap = confBySlot.get(s.subjectSlotKey)
  if (!slotMap) return null
  const key = EVIDENCE_KEY_BY_SOURCE[snapshotSource(s)][column]
  if (!key) return null
  return slotMap.get(key) ?? null
}

/**
 * Aggregate (mean) confidence over a slot's anchor-only evidence — the X-Factor
 * and attribute fields that ride the chosen anchor and are never voted. These
 * keys (`x_factor_name_{n}`, `x_factor_tier_{n}`, `attribute_{name}_value`) are
 * loadout-only, so lobby slots return null and are never confidence-preferred as
 * the anchor. Returns null when the slot carries none of them.
 */
export function anchorFieldConfidence(s: Snapshot, confBySlot: FieldConfidenceMap): number | null {
  if (!s.subjectSlotKey) return null
  const slotMap = confBySlot.get(s.subjectSlotKey)
  if (!slotMap) return null
  let sum = 0
  let n = 0
  for (const [k, c] of slotMap) {
    if (
      k.startsWith('x_factor_name_') ||
      k.startsWith('x_factor_tier_') ||
      (k.startsWith('attribute_') && k.endsWith('_value'))
    ) {
      sum += c
      n++
    }
  }
  return n > 0 ? sum / n : null
}

/**
 * Pick the highest-weight non-null value, falling back to the anchor's value.
 *
 * `confidences`, when supplied, is aligned with `[anchor, ...others]` and holds
 * each observation's per-field OCR confidence; a `null`/`undefined`/`NaN` entry
 * (no evidence for that slot+field) falls back to weight 1. With no confidences
 * — or all-equal weights — this reduces EXACTLY to the prior unweighted vote:
 * weight becomes the plain count and, on a tie, the earliest-inserted value wins
 * (the anchor is first in `[anchor, ...others]`, preserving "anchor wins ties").
 */
export function vote<T>(
  anchor: T | null,
  others: (T | null)[],
  confidences?: (number | null)[],
): T | null {
  const values = [anchor, ...others]
  const counts = new Map<string, { weight: number; value: T }>()
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v === null || v === undefined) continue
    const raw = confidences?.[i]
    const w = raw === null || raw === undefined || Number.isNaN(raw) ? 1 : raw
    const key = JSON.stringify(v)
    const prev = counts.get(key)
    if (prev) prev.weight += w
    else counts.set(key, { weight: w, value: v })
  }
  if (counts.size === 0) return null
  // Highest accumulated weight; on tie the earliest-inserted value wins (Map
  // preserves insertion order, and the `>` keeps the first max) — identical to
  // the prior count-based tiebreak because insertion order = [anchor, ...others].
  let best: { weight: number; value: T } | null = null
  for (const entry of counts.values()) {
    if (!best || entry.weight > best.weight) best = entry
  }
  return best?.value ?? null
}

/**
 * Vote a scalar with LOADOUT-SOURCE PRIORITY.
 *
 * The loadout card renders the jersey number large and clear; the lobby table's
 * small number column is prone to single/double-digit misreads and row-group
 * bleed. Match 463 for_LD (HenryTheBobJr): the loadout card reads 7 (correct,
 * ×2 @ ~0.97) but the lobby row reads 77 (wrong, ×2 @ ~0.97), and the two lobby
 * reads slightly outweigh the two loadout reads in the plain confidence vote
 * (Σ77 = 1.9536 > Σ7 = 1.9473), so the number regresses to 77.
 *
 * When any loadout-source observation in the (already identity-scoped) group
 * carries a non-null value, vote ONLY among the loadout observations; otherwise
 * fall back to the full cross-source {@link vote} (lobby-only slots — goalies,
 * away subjects without a loadout card, legacy snapshots). The anchor is kept
 * first when it survives the source filter so `vote`'s earliest-wins tiebreak
 * still favours it. Single-source groups reduce exactly to `vote`.
 */
export function voteLoadoutPreferred<T>(
  anchor: Snapshot,
  others: Snapshot[],
  get: (s: Snapshot) => T | null,
  column: VotedColumn,
  confBySlot: FieldConfidenceMap,
): T | null {
  const all = [anchor, ...others]
  const loadout = all.filter((s) => snapshotSource(s) === 'loadout' && get(s) != null)
  const pool = loadout.length > 0 ? loadout : all
  // Keep the anchor first when it's in the pool (loadout anchor is the common
  // case, since pickAnchor prefers loadout) so vote()'s tiebreak favours it.
  const ordered = pool.includes(anchor) ? [anchor, ...pool.filter((s) => s !== anchor)] : pool
  // `ordered` is always non-empty (its `all` branch always contains the anchor).
  const [first, ...rest] = ordered
  return vote(
    first ? get(first) : null,
    rest.map((s) => get(s)),
    ordered.map((s) => fieldConfidence(s, column, confBySlot)),
  )
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

/**
 * Phase G (for_RW bleed): do two snapshots read the SAME player identity?
 *
 * A mid-scroll lobby transition frame can bind a neighbouring player's row into
 * the wrong position slot (geometric row-grouping in `row_grouping.py`), so the
 * bled snapshot's gamertag — and its whole identity (number, persona, build, …)
 * — is a DIFFERENT player (e.g. the LD player `HenryTheBobJr` landing in the RW
 * slot alongside the real `silkyjoker85` loadout card). Such an observation must
 * not vote its fields into this slot; `consolidateLoadouts` filters each group's
 * vote pool through this predicate against the chosen anchor before `consensus`.
 *
 * Gamertags are normalized (`normTag`) so spacing/casing variants of one player
 * (`Stick Menace` vs `StickMenace`) count as the same identity. When either side
 * has no establishable identity (empty/junk → normalizes to ''), returns true so
 * no observation is silently dropped — identity can't discriminate there.
 */
export function sameGamertagIdentity(a: Snapshot, b: Snapshot): boolean {
  const na = normTag(a.gamertagSnapshot)
  const nb = normTag(b.gamertagSnapshot)
  if (!na || !nb) return true
  return na === nb
}

export function pickAnchor(group: Snapshot[], confBySlot: FieldConfidenceMap): Snapshot {
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
  // Phase F: when evidence-confidence is present, prefer the candidate whose
  // anchor-only fields (X-Factor + attribute evidence) read most confidently —
  // those child rows ride the anchor and are never voted, so anchor choice is
  // the only lever for them. Gate strictly on confidence presence so no-evidence
  // groups (bare-snapshot fixtures, pre-Phase-F data) keep today's ordering
  // byte-for-byte. Recency (highest id) is the tiebreak, matching the legacy
  // dominant-gamertag branch. With a single loadout candidate per (side,
  // position) group — the normal case — this picks the same row recency would.
  const scored = candidates.map((s) => ({ s, conf: anchorFieldConfidence(s, confBySlot) }))
  if (scored.some((x) => x.conf !== null)) {
    return scored.reduce((best, x) => {
      const bc = best.conf ?? -Infinity
      const xc = x.conf ?? -Infinity
      // Higher confidence wins; recency (highest id) breaks ties, matching the
      // legacy dominant-gamertag branch below.
      return xc > bc || (xc === bc && Number(x.s.id) > Number(best.s.id)) ? x : best
    }).s
  }
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
  isCaptainConfidence: string | null
  buildClass: string | null
  buildClassCanonical: string | null
  heightText: string | null
  weightLbs: number | null
  handedness: string | null
  playerLevelRaw: string | null
  playerLevelNumber: number | null
  platform: string | null
}

function consensus(
  anchor: Snapshot,
  group: Snapshot[],
  captain: { isCaptain: boolean | null; isCaptainConfidence: string | null },
  confBySlot: FieldConfidenceMap,
): ConsensusValues {
  // `group` is the identity-scoped voting pool the caller built (every member
  // reads the same player as the anchor — see the for_RW-bleed filter in
  // consolidateLoadouts). Because that scoping happens at the call site, EVERY
  // vote below — including the dominantGamertag(group) gamertag vote — is already
  // confined to same-player observations; consensus does no identity filtering.
  const others = group.filter((s) => s.id !== anchor.id)
  // Phase F: per-column confidence array aligned with vote's [anchor, ...others]
  // observation order, so each scalar vote is weighted by how confident the
  // extractor was on that slot's field. A missing entry → weight-1 fallback.
  const conf = (col: VotedColumn): (number | null)[] => [
    fieldConfidence(anchor, col, confBySlot),
    ...others.map((s) => fieldConfidence(s, col, confBySlot)),
  ]
  // Gamertag: majority across the group (dominantGamertag also skips junk),
  // so an anchor whose own gamertag is a stale OCR misread doesn't poison
  // the canonical row.
  const gamertagSnapshot = dominantGamertag(group)
  const buildClass = vote(
    anchor.buildClass,
    others.map((s) => s.buildClass),
    conf('buildClass'),
  )
  return {
    gamertagSnapshot,
    buildClass,
    buildClassCanonical: normalizeBuildClass(buildClass),
    playerNameSnapshot: vote(
      anchor.playerNameSnapshot,
      others.map((s) => s.playerNameSnapshot),
      conf('playerNameSnapshot'),
    ),
    // Persona is voted raw here; alias-table canonicalization happens inside
    // the per-anchor transaction below (resolvePersona) so the raw vote can
    // be preserved alongside the cleaned value.
    playerNamePersona: vote(
      anchor.playerNamePersona,
      others.map((s) => s.playerNamePersona),
      conf('playerNamePersona'),
    ),
    playerNamePersonaRaw: vote(
      anchor.playerNamePersona,
      others.map((s) => s.playerNamePersona),
      conf('playerNamePersona'),
    ),
    // Jersey number: prefer the loadout card (authoritative, large clear render)
    // over the lobby table's misread-prone number column when both are present
    // for the same player. Fixes the 463 for_LD regression where two ~0.97 lobby
    // reads of 77 outweighed the loadout card's correct 7 in the plain vote.
    playerNumber: voteLoadoutPreferred(
      anchor,
      others,
      (s) => s.playerNumber,
      'playerNumber',
      confBySlot,
    ),
    // is_captain: Phase D — resolved by per-side argmax over the visual ★
    // score (see resolveSideCaptains), NOT an OR-fold. The OR-fold could not
    // discriminate a real captain from an OCR/glyph false positive and allowed
    // >1 captain per side; argmax over the discriminating star score fixes both.
    isCaptain: captain.isCaptain,
    isCaptainConfidence: captain.isCaptainConfidence,
    heightText: vote(
      anchor.heightText,
      others.map((s) => s.heightText),
      conf('heightText'),
    ),
    weightLbs: vote(
      anchor.weightLbs,
      others.map((s) => s.weightLbs),
      conf('weightLbs'),
    ),
    handedness: vote(
      anchor.handedness,
      others.map((s) => s.handedness),
      conf('handedness'),
    ),
    playerLevelRaw: vote(
      anchor.playerLevelRaw,
      others.map((s) => s.playerLevelRaw),
      conf('playerLevelRaw'),
    ),
    playerLevelNumber: vote(
      anchor.playerLevelNumber,
      others.map((s) => s.playerLevelNumber),
      conf('playerLevelNumber'),
    ),
    // Platform: reject anything outside the strict whitelist before voting
    // so old OCR garbage (gamertags landing in this column) never wins. The
    // confidence array aligns by index with [anchor, ...others] regardless of
    // sanitization (null values are skipped inside vote()).
    platform: vote(
      sanitizePlatform(anchor.platform),
      others.map((s) => sanitizePlatform(s.platform)),
      conf('platform'),
    ),
  }
}

/**
 * CALIBRATE (Phase G): minimum visual ★ score for a slot to count as a captain
 * candidate. Below this the gold cluster is treated as noise. Principled
 * default, untuned against real star-bearing frames.
 */
export const CAPTAIN_MIN_CONFIDENCE = 0.5

/**
 * Phase D one-captain-per-side resolution. EASHL has exactly one room-leader
 * per team_side, so among all slots on a side the one with the highest visual
 * gold-★ score (captain_star_matcher, persisted as is_captain_confidence) wins;
 * every other slot on that side resolves to not-captain (null). This replaces
 * the old OR-fold, which could not discriminate a real captain from an OCR/glyph
 * false positive and permitted >1 captain per side (e.g. match 463).
 *
 * Backward-compat: when a side carries NO visual confidence signal at all
 * (every is_captain_confidence NULL, e.g. snapshots predating Phase D), the
 * legacy OR-fold applies for that side so re-consolidating old data is unchanged.
 *
 * Keys are `${teamSide}|${position}` — the consolidation groups-map keys.
 */
export function resolveSideCaptains(
  groups: Map<string, Snapshot[]>,
): Map<string, { isCaptain: boolean | null; isCaptainConfidence: string | null }> {
  const sideOf = (key: string): string => key.slice(0, key.indexOf('|'))
  // Per group: best ★ confidence among is_captain=true observations.
  const groupConf = new Map<string, number>()
  // Sides that carry ANY visual confidence signal at all.
  const sideHasSignal = new Set<string>()
  for (const [key, group] of groups) {
    let best: number | null = null
    for (const s of group) {
      if (s.isCaptainConfidence == null) continue
      sideHasSignal.add(sideOf(key))
      if (s.isCaptain === true) {
        const c = Number(s.isCaptainConfidence)
        if (!Number.isNaN(c) && (best === null || c > best)) best = c
      }
    }
    if (best !== null) groupConf.set(key, best)
  }
  // Per side: the group with the highest confidence above the floor wins.
  const winnerBySide = new Map<string, string>()
  for (const [key, conf] of groupConf) {
    if (conf < CAPTAIN_MIN_CONFIDENCE) continue
    const side = sideOf(key)
    const prev = winnerBySide.get(side)
    if (!prev || conf > (groupConf.get(prev) ?? -Infinity)) winnerBySide.set(side, key)
  }
  const out = new Map<string, { isCaptain: boolean | null; isCaptainConfidence: string | null }>()
  for (const [key, group] of groups) {
    const side = sideOf(key)
    const conf = groupConf.get(key)
    const isCaptainConfidence = conf !== undefined ? conf.toFixed(4) : null
    let isCaptain: boolean | null
    if (sideHasSignal.has(side)) {
      // Phase D visual signal present → argmax winner wins, everyone else null.
      isCaptain = winnerBySide.get(side) === key ? true : null
    } else {
      // Legacy fallback for un-scored (pre-Phase-D) data.
      isCaptain = group.some((s) => s.isCaptain === true) ? true : null
    }
    out.set(key, { isCaptain, isCaptainConfidence })
  }
  return out
}

/**
 * Run cross-frame loadout/lobby consensus for one match, marking the per-group
 * anchor rows `review_status = 'reviewed'`. Returns the per-group counts +
 * unresolved-persona/gamertag lists for the caller to report.
 */
export async function consolidateLoadouts(
  matchId: number,
  options: ConsolidateLoadoutsOptions = {},
): Promise<ConsolidateLoadoutsResult> {
  const conn = options.db ?? defaultDb
  const dryRun = options.dryRun ?? false
  const log = options.log ?? (() => {})

  // Step 1: reset prior canonical rows back to pending_review (idempotent).
  if (!dryRun) {
    await conn
      .update(playerLoadoutSnapshots)
      .set({ reviewStatus: 'pending_review' })
      .where(
        and(
          eq(playerLoadoutSnapshots.matchId, matchId),
          eq(playerLoadoutSnapshots.reviewStatus, 'reviewed'),
        ),
      )
  }

  const snapshots = await readSnapshots(conn, matchId)
  log(`[consolidate] read ${snapshots.length} raw snapshot(s)`)

  // Phase F: fetch per-(slot, field) OCR confidence for the run whose evidence
  // built these snapshots. `undefined` → resolve the match's active run (the
  // standalone CLI / any caller that didn't pass one); the activate path passes
  // the run it just flipped active. An empty map (no evidence, or bare-snapshot
  // fixtures) degrades every vote to weight-1 = today's unweighted behavior.
  const runId =
    options.runId !== undefined
      ? options.runId
      : await getActiveRunIdForMatch(matchId, conn as unknown as Database)
  const confBySlot = await readFieldConfidence(conn, matchId, runId)
  log(`[consolidate] loaded field confidence for ${confBySlot.size} slot(s)`)

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
  log(
    `[consolidate] ${groups.size} canonical group(s) detected (skipped ${junkSkipped} junk-gamertag row(s), ${cpuSkipped} CPU row(s))`,
  )

  // Step 2b: Phase D — resolve exactly one captain per team_side by argmax over
  // the visual ★ score across all groups (cross-group, so it can't live inside
  // the per-group consensus below).
  const captainDecisions = resolveSideCaptains(groups)

  // Step 3: per-group consensus.
  let canonicalCount = 0
  const unresolvedPersonas: UnresolvedPersona[] = []
  const unresolvedGamertags: UnresolvedGamertag[] = []
  for (const [key, group] of groups) {
    const anchor = pickAnchor(group, confBySlot)
    // Phase G (for_RW bleed): scope the vote to observations reading the SAME
    // player as the anchor. A mid-scroll lobby transition frame can bind a
    // neighbour's ENTIRE row — gamertag + number + persona + build — into this
    // slot's y-band (geometric row-grouping in row_grouping.py: the LD player
    // HenryTheBobJr / #7 landing in the RW slot alongside silkyjoker85's card). A
    // gamertag mismatch is a reliable "different player" tell, so such a row must
    // not vote ANY field — the gamertag vote included — into this slot. The
    // anchor is the loadout-preferred, dominant-gamertag row (pickAnchor), so its
    // identity is the trusted slot identity; drop observations that disagree.
    // Invariants: when every observation matches (the common case) votingGroup
    // === group → the vote is byte-for-byte identical to before (goalies,
    // roster-only, lobby-only away slots included); an empty/junk anchor gamertag
    // keeps the whole group (sameGamertagIdentity is total) → today's behaviour,
    // never an empty vote pool; the filter is confidence-independent → applied
    // identically in the weighted and unweighted paths, preserving the
    // weighted==unweighted oracle.
    const votingGroup = group.filter((s) => sameGamertagIdentity(s, anchor))
    const merged = consensus(
      anchor,
      votingGroup,
      captainDecisions.get(key) ?? { isCaptain: null, isCaptainConfidence: null },
      confBySlot,
    )
    // Re-resolve player_id from the voted gamertag — old loadout-view rows
    // were sometimes misattributed (e.g. snap 142 had player_id=11 but is
    // actually Stick Menace), and the voted gamertag is now correct.
    // resolveGamertagToPlayer expects a PromoterDb (transaction handle), so
    // we run the resolve + the update inside one short tx per anchor. When
    // `conn` is itself a transaction, this opens a savepoint.
    await conn.transaction(async (tx) => {
      const resolved = await resolveGamertagToPlayer(
        merged.gamertagSnapshot,
        anchor.gameTitleId,
        tx,
      )
      // Canonicalize the voted persona against the alias table. Raw vote is
      // preserved in playerNamePersonaRaw (already set in consensus()).
      const personaResolved = await resolvePersona(merged.playerNamePersona, tx)
      if (personaResolved && personaResolved.via !== 'raw') {
        log(
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
      log(
        `  ${key}: ${group.length} obs → anchor#${anchor.id} (${anchor.screenType}, gamertag="${anchor.gamertagSnapshot}")`,
      )
      for (const [k, v] of Object.entries(merged)) {
        const anchorVal = (anchor as unknown as Record<string, unknown>)[k]
        if (JSON.stringify(anchorVal) !== JSON.stringify(v)) {
          log(`    fix ${k}: ${JSON.stringify(anchorVal)} → ${JSON.stringify(v)}`)
        }
      }
      if (resolved.playerId !== anchor.playerId) {
        log(
          `    fix playerId: ${JSON.stringify(anchor.playerId)} → ${JSON.stringify(resolved.playerId)} (via ${resolved.via})`,
        )
      }
      if (!dryRun) {
        await tx
          .update(playerLoadoutSnapshots)
          .set({ ...merged, playerId: resolved.playerId, reviewStatus: 'reviewed' })
          .where(eq(playerLoadoutSnapshots.id, anchor.id))
      }
    })
  }
  log(
    `[consolidate] ${canonicalCount} canonical row(s) ${dryRun ? 'would be' : ''} marked reviewed`,
  )

  return {
    rawSnapshotCount: snapshots.length,
    groupCount: groups.size,
    junkSkipped,
    cpuSkipped,
    canonicalCount,
    unresolvedPersonas,
    unresolvedGamertags,
  }
}
