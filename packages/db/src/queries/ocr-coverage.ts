import { and, eq, inArray, isNotNull, or } from 'drizzle-orm'
import { db } from '../client.js'
import { matchEvents, matchPeriodSummaries, playerLoadoutSnapshots } from '../schema/index.js'

/**
 * Which of a match's three independent OCR streams landed. See the web-side
 * `ocr-coverage.ts` for how these collapse into the games-list pill tier.
 */
export interface MatchOcrCoverage {
  /** Pre-game loadout snapshots exist — what gates the LOADOUTS tab. */
  loadouts: boolean
  /** Reviewed OCR per-period box score rows exist. */
  periods: boolean
  /** Reviewed OCR action-tracker events exist. */
  events: boolean
}

const NO_COVERAGE: MatchOcrCoverage = { loadouts: false, periods: false, events: false }

/**
 * Batched OCR-stream presence for a page of matches.
 *
 * Three index-backed DISTINCT scans, one per stream, rather than a per-match
 * fan-out — the games list renders 20 cards, which would otherwise be 60
 * round trips.
 *
 * `periods`, `events`, and `loadouts` each mirror a different admission rule
 * from their respective query authority, because migration 0056 split
 * `match_period_summaries` into independently-reviewed stat families while
 * `match_events` stayed whole-row:
 *
 * - `periods` mirrors {@link getMatchPeriodSummaries}'s row-retention rule —
 *   an OCR row counts once AT LEAST ONE of its three family columns
 *   (`goals_review_status` / `shots_review_status` / `faceoffs_review_status`)
 *   is `'reviewed'`. The legacy whole-row `review_status` is transitional
 *   metadata, not an authorization signal (migration 0056) — a row whose
 *   family statuses are all still `pending_review` publishes nothing on the
 *   match page even if the legacy column says `reviewed`, so counting it here
 *   would promise coverage the page then withholds.
 * - `events` mirrors {@link getMatchEvents} exactly: OCR rows count only once
 *   the whole-row `review_status` is `'reviewed'`, because `match_events` was
 *   never split into families — one status covers the whole row.
 *
 * `loadouts` deliberately has NO review gate — `getMatchLineups` treats
 * `reviewed` as row-selection precedence, not admission, and falls back to any
 * snapshot, so any snapshot at all means the LOADOUTS tab renders.
 *
 * Matches with no OCR at all are absent from the returned map; callers should
 * treat a miss as all-false.
 */
export async function getOcrCoverageForMatches(
  matchIds: number[],
): Promise<Map<number, MatchOcrCoverage>> {
  const coverage = new Map<number, MatchOcrCoverage>()
  if (matchIds.length === 0) return coverage

  const [loadoutRows, periodRows, eventRows] = await Promise.all([
    db
      .selectDistinct({ matchId: playerLoadoutSnapshots.matchId })
      .from(playerLoadoutSnapshots)
      .where(
        and(
          inArray(playerLoadoutSnapshots.matchId, matchIds),
          isNotNull(playerLoadoutSnapshots.matchId),
        ),
      ),
    db
      .selectDistinct({ matchId: matchPeriodSummaries.matchId })
      .from(matchPeriodSummaries)
      .where(
        and(
          inArray(matchPeriodSummaries.matchId, matchIds),
          eq(matchPeriodSummaries.source, 'ocr'),
          or(
            eq(matchPeriodSummaries.goalsReviewStatus, 'reviewed'),
            eq(matchPeriodSummaries.shotsReviewStatus, 'reviewed'),
            eq(matchPeriodSummaries.faceoffsReviewStatus, 'reviewed'),
          ),
        ),
      ),
    db
      .selectDistinct({ matchId: matchEvents.matchId })
      .from(matchEvents)
      .where(
        and(
          inArray(matchEvents.matchId, matchIds),
          eq(matchEvents.source, 'ocr'),
          eq(matchEvents.reviewStatus, 'reviewed'),
        ),
      ),
  ])

  const mark = (matchId: number | null, stream: keyof MatchOcrCoverage) => {
    if (matchId === null) return
    const existing = coverage.get(matchId) ?? { ...NO_COVERAGE }
    existing[stream] = true
    coverage.set(matchId, existing)
  }

  for (const row of loadoutRows) mark(row.matchId, 'loadouts')
  for (const row of periodRows) mark(row.matchId, 'periods')
  for (const row of eventRows) mark(row.matchId, 'events')

  return coverage
}
