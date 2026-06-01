/**
 * Cross-capture dedup helper for `match_events` row inserts.
 *
 * Both the action-tracker promoter and the events promoter need to ask
 * "does a row for this (match, period, type, clock, actor) already
 * exist?" before inserting. The naive answer — exact-string match on
 * `actor_gamertag_snapshot` — produces duplicate rows when OCR misreads
 * a player's name in just one or two characters (e.g. "SILKY" → "SIlKY",
 * "WILDE" → "WILOE", "TOEWS" → "fOEWS").
 *
 * This helper uses three strategies in sequence:
 *
 *   0. Positioned-vs-junk prefix guard. At action-tracker insert time the
 *      incoming row always has x=null. If an existing row in the same
 *      (match, period, type, clock) bucket already has x IS NOT NULL and
 *      its actor snapshot shares the first 4 normalised alphanumeric chars
 *      with the incoming actor, the incoming row is a junk OCR-variant
 *      of a positioned canonical event (e.g. "Silky [" vs "SILKY", or
 *      "S. Zubov (1l" vs "S. ZUBOV"). Drop it. The normalisation mirrors
 *      the SQL cleanup in docs/calibration/phase1-dedup-cleanup-2026-05-20.sql.
 *
 *      NOT triggered when:
 *        - neither (both unpositioned) or both rows are positioned — falls
 *          through so genuinely distinct same-time events survive (e.g. two
 *          different players acting at the same clock with no x/y)
 *        - actor prefixes differ after stripping non-alpha chars — the
 *          WILDE / S. ZUBOV case ("wild" ≠ "szub") is preserved correctly.
 *
 *   A. Resolved-player path. If `resolveGamertagToPlayer` succeeded
 *      (Levenshtein-1 + display alias + gamertag history cascade), both
 *      captures' typo'd actors land on the same `playerId`. Match on
 *      `actor_player_id`. This handles BGM-side typos cleanly because
 *      BGM players are in `players` / `player_display_aliases`.
 *
 *   B. Unresolved-actor fuzzy fallback. When `actor_player_id` is null
 *      (the actor is an opp the resolver can't reach — they aren't
 *      seeded into `players` because they're not BGM-rostered), load
 *      all existing same-bucket rows with null `actor_player_id` and
 *      do an in-TypeScript Levenshtein-1 case-insensitive compare on
 *      their `actor_gamertag_snapshot` strings. A match → treat as the
 *      existing row. This handles WILDE/WILOE and TOEWS/fOEWS-style
 *      opp typos by collapsing within-match-bucket near-duplicates.
 *
 * Strategy B falls through to exact case-folded match (same as the
 * prior dedup behavior) when no near-neighbor is found.
 */

import { matchEvents } from '@eanhl/db'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { DbOrTx, PromoterDb } from './index.js'
import { levenshtein, normalizeSnapshot } from './resolve-identity.js'

export interface DedupKey {
  matchId: number
  periodNumber: number
  /** Excludes 'unknown' — callers should skip those rows entirely before
   *  reaching this helper (the match_events column constraint forbids them). */
  eventType: 'shot' | 'hit' | 'goal' | 'penalty' | 'faceoff'
  clock: string
  actorPlayerId: number | null
  actorSnapshot: string
}

/**
 * Strips all non-alphabetic characters, lowercases, and returns the first
 * 4 characters. Mirrors the SQL:
 *   LEFT(LOWER(REGEXP_REPLACE(COALESCE(actor_gamertag_snapshot,''),'[^a-zA-Z]','','g')), 4)
 *
 * Used by Strategy 0 to detect "Silky [" ≈ "SILKY", "S. Zubov (1l" ≈ "S. ZUBOV".
 * Returns empty string when the snapshot is null / empty or all-punctuation.
 */
export function normalizeActorForPrefix(snap: string | null): string {
  if (!snap) return ''
  return snap
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .slice(0, 4)
}

/**
 * Clock-independent identity key for WS4 orphan-identity recovery. Unlike
 * `DedupKey` it carries no `clock` (recovered orphans are clock-null by
 * definition) and adds `teamSide` — the robust identity key partitions the
 * bucket by team so two opposite-side events at the same period/type/actor
 * never merge.
 */
export interface ClocklessDedupKey {
  matchId: number
  periodNumber: number
  eventType: 'shot' | 'hit' | 'goal' | 'penalty' | 'faceoff'
  teamSide: 'for' | 'against'
  actorPlayerId: number | null
  actorSnapshot: string
}

/**
 * Three-state outcome for the clock-independent lookup:
 *   - `hit`        → exactly one existing row matches this identity; dedup to it.
 *   - `insert`     → zero matches; safe to mint a new row.
 *   - `ambiguous`  → more than one candidate matches; never guess, report only.
 */
export type ClocklessDedupResult =
  | { kind: 'hit'; id: number }
  | { kind: 'insert' }
  | { kind: 'ambiguous'; candidateIds: number[] }

/**
 * Clock-independent sibling of `findExistingMatchEvent` for the WS4 recovery
 * path. `findExistingMatchEvent`'s signature/behavior is left untouched (the
 * live promoter depends on its `number|null` contract and never passes a null
 * clock), so this is an additive second authority living in the same module.
 *
 * The bucket is `(matchId, periodNumber, eventType, teamSide, source='ocr')`
 * with NO clock filter. Within it we match the actor by resolved player id
 * first, then a normalized + Levenshtein-1 fuzzy compare — exactly the A→B
 * order of `findExistingMatchEvent`, minus the clock equality and the
 * insert-time-only Strategy-0 positioned-junk guard.
 *
 * The bucket deliberately includes POSITIONED rows (not just unpositioned):
 * a recovered orphan whose event was already promoted-and-positioned via the
 * live path must dedup to it, otherwise we'd INSERT a duplicate of a real
 * event. Searching all rows makes that a `hit`; only a genuinely absent
 * identity (zero matches anywhere in the bucket) yields `insert`.
 */
export async function findExistingMatchEventClockless(
  db: DbOrTx,
  key: ClocklessDedupKey,
): Promise<ClocklessDedupResult> {
  const bucket = await db
    .select({ id: matchEvents.id, actorPlayerId: matchEvents.actorPlayerId, snapshot: matchEvents.actorGamertagSnapshot })
    .from(matchEvents)
    .where(
      and(
        eq(matchEvents.matchId, key.matchId),
        eq(matchEvents.periodNumber, key.periodNumber),
        eq(matchEvents.eventType, key.eventType),
        eq(matchEvents.teamSide, key.teamSide),
        eq(matchEvents.source, 'ocr'),
      ),
    )

  const matched = new Set<number>()

  // ── Strategy A ── Resolved-player path ────────────────────────────────────
  // Exact match on actor_player_id within the bucket. Falls through to fuzzy
  // only when it finds nothing (mirrors findExistingMatchEvent's A→B order).
  if (key.actorPlayerId !== null) {
    for (const row of bucket) {
      if (row.actorPlayerId === key.actorPlayerId) matched.add(row.id)
    }
  }

  // ── Strategy B ── Unresolved-actor fuzzy fallback ─────────────────────────
  if (matched.size === 0) {
    const target = normalizeSnapshot(key.actorSnapshot).toLowerCase()
    if (target) {
      for (const row of bucket) {
        const snap = normalizeSnapshot(row.snapshot ?? '').toLowerCase()
        if (snap.length === 0) continue
        if (snap === target || levenshtein(snap, target, 1) <= 1) matched.add(row.id)
      }
    }
  }

  if (matched.size === 0) return { kind: 'insert' }
  if (matched.size === 1) return { kind: 'hit', id: [...matched][0]! }
  return { kind: 'ambiguous', candidateIds: [...matched] }
}

/**
 * Returns the id of an existing match_events row that represents the
 * same event as the given key, or null if no match. Idempotent.
 */
export async function findExistingMatchEvent(
  db: PromoterDb,
  key: DedupKey,
): Promise<number | null> {
  // ── Strategy 0 ── Positioned-vs-junk prefix guard ─────────────────────────
  // At action-tracker insert time the incoming row has x=null. If there is
  // already a positioned row (x IS NOT NULL) in the same bucket whose actor
  // shares the first 4 normalised alphanumeric chars with the incoming actor,
  // the incoming row is an OCR-junk variant that should be suppressed.
  //
  // This fires before the resolver / Levenshtein strategies so a junk row
  // whose actor string is too corrupted for Levenshtein-1 to catch (e.g.
  // "Silky [" has edit distance 2 from "SILKY" after normalisation) is still
  // blocked here based on the weaker but sufficient prefix signal.
  {
    const incomingPrefix = normalizeActorForPrefix(key.actorSnapshot)
    if (incomingPrefix.length >= 4) {
      const positionedRows = await db
        .select({ id: matchEvents.id, snapshot: matchEvents.actorGamertagSnapshot })
        .from(matchEvents)
        .where(
          and(
            eq(matchEvents.matchId, key.matchId),
            eq(matchEvents.periodNumber, key.periodNumber),
            eq(matchEvents.eventType, key.eventType),
            eq(matchEvents.source, 'ocr'),
            eq(matchEvents.clock, key.clock),
            isNotNull(matchEvents.x),
          ),
        )
      for (const row of positionedRows) {
        const existingPrefix = normalizeActorForPrefix(row.snapshot ?? null)
        if (existingPrefix.length >= 4 && existingPrefix === incomingPrefix) {
          return row.id
        }
      }
    }
  }

  // ── Strategy A ── Resolved-player path ────────────────────────────────────
  // Exact match on actor_player_id within (match, period, type, source, clock).
  if (key.actorPlayerId !== null) {
    const rows = await db
      .select({ id: matchEvents.id })
      .from(matchEvents)
      .where(
        and(
          eq(matchEvents.matchId, key.matchId),
          eq(matchEvents.periodNumber, key.periodNumber),
          eq(matchEvents.eventType, key.eventType),
          eq(matchEvents.source, 'ocr'),
          eq(matchEvents.clock, key.clock),
          eq(matchEvents.actorPlayerId, key.actorPlayerId),
        ),
      )
      .limit(1)
    if (rows[0]?.id) return rows[0].id
    // Fall through to Strategy B: a prior insert may have happened before
    // the alias table seeded this player (actor_player_id was null at the
    // time but the OCR snapshot matches this event).
  }

  // ── Strategy B ── Unresolved-actor fuzzy fallback ─────────────────────────
  // Whitespace + casing variants (e.g. "M. RANTANEN" vs "M.RANTANEN") collapse
  // via normalizeSnapshot before Levenshtein. The 'unknown_screen' marker is
  // handled by the caller.
  const candidates = await db
    .select({ id: matchEvents.id, snapshot: matchEvents.actorGamertagSnapshot })
    .from(matchEvents)
    .where(
      and(
        eq(matchEvents.matchId, key.matchId),
        eq(matchEvents.periodNumber, key.periodNumber),
        eq(matchEvents.eventType, key.eventType),
        eq(matchEvents.source, 'ocr'),
        eq(matchEvents.clock, key.clock),
      ),
    )

  const target = normalizeSnapshot(key.actorSnapshot).toLowerCase()
  if (!target) return null
  for (const c of candidates) {
    const snap = normalizeSnapshot(c.snapshot ?? '').toLowerCase()
    if (snap.length === 0) continue
    if (snap === target) return c.id
    if (levenshtein(snap, target, 1) <= 1) return c.id
  }
  return null
}
