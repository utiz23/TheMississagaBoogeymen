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
 * This helper uses two strategies in sequence:
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
import { and, eq } from 'drizzle-orm'
import type { PromoterDb } from './index.js'
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
 * Returns the id of an existing match_events row that represents the
 * same event as the given key, or null if no match. Idempotent.
 */
export async function findExistingMatchEvent(
  db: PromoterDb,
  key: DedupKey,
): Promise<number | null> {
  // Strategy A — resolved-player path. Exact match on actor_player_id within
  // (match, period, type, source, clock).
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

  // Strategy B — fuzzy snapshot match against ALL same-bucket rows (resolved
  // or unresolved). Whitespace + casing variants (e.g. "M. RANTANEN" vs
  // "M.RANTANEN") collapse via normalizeSnapshot before Levenshtein. The
  // 'unknown_screen' marker is handled by the caller.
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
