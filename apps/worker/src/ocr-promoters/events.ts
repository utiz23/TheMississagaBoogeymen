/**
 * Promote post_game_events extractions into match_events + extension tables.
 *
 * Event rows from the post-game Events screen are goals and penalties only.
 * (Action Tracker covers shots/hits/faceoffs separately and shares the same
 * dedup key, so cross-screen rows for the same goal collapse to one row.)
 *
 * **Clock convention:** the Events screen renders time as REMAINING in the
 * period (counts down from 20:00 → 0:00). The Action Tracker renders time as
 * ELAPSED (counts up from 0:00 → 19:59). Both screens show the same goal but
 * with different clock strings — e.g. Silky's 2nd-period goal appears as
 * `06:19` on Events and `13:41` on Action Tracker (`20:00 − 06:19 = 13:41`).
 *
 * The DB stores ELAPSED time as canonical (matches Action Tracker, matches
 * NHL stats-API convention, makes time progression intuitive). This promoter
 * converts the Events-screen "remaining" clock to "elapsed" before dedup
 * + insert, so rows from the two screens collapse correctly.
 *
 * Dedup key (after conversion): (matchId, periodNumber, clock_elapsed,
 * eventType, teamAbbreviation, actorGamertagSnapshot). When a row already
 * exists with that key under source='ocr', we update its ocr_extraction_id
 * to point at the new extraction but leave domain fields intact.
 *
 * Skips event rows of event_type='unknown' (parse failures) and rows missing
 * a clock — they have nothing useful to persist as canonical data, but the
 * raw text is preserved in ocr_extraction_fields.
 */

import {
  matchEvents,
  matchGoalEvents,
  matchPenaltyEvents,
  type NewMatchEvent,
  type NewMatchGoalEvent,
  type NewMatchPenaltyEvent,
} from '@eanhl/db'
import { and, eq, sql as drizzleSql } from 'drizzle-orm'
import type { PromoterContext } from './index.js'
import { resolveActorForMatch } from './resolve-identity.js'
import { findExistingMatchEvent } from './match-events-dedup.js'
import { canonicalPeriodLabel, firstLabeledPeriod, resolveEventPeriod } from './resolve-period.js'
import type { OcrExtractionField } from '../ocr-cli-runner.js'

interface EventRowJson {
  raw_text: OcrExtractionField
  period_label: string
  period_number: number
  event_type: 'goal' | 'penalty' | 'unknown'
  team_abbreviation: OcrExtractionField
  clock: OcrExtractionField
  actor_snapshot: OcrExtractionField
  goal_number_in_game: OcrExtractionField
  assists_snapshot?: OcrExtractionField[]
  infraction: OcrExtractionField
  penalty_type: OcrExtractionField
}

const BGM_ABBR_ALIASES = new Set(['BM', 'BGM', 'BOOG'])

/** Period length in seconds. Standard EASHL/NHL period = 20:00. */
const PERIOD_LENGTH_SECONDS = 20 * 60

/**
 * Convert an Events-screen "time remaining" clock to the canonical "elapsed"
 * representation used by everything downstream.
 *
 * Returns null on malformed input, drops out-of-range values (MM > 19, SS >= 60).
 */
function remainingToElapsed(clock: string): string | null {
  const m = clock.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const mm = Number.parseInt(m[1]!, 10)
  const ss = Number.parseInt(m[2]!, 10)
  if (mm > 19 || ss >= 60 || mm < 0 || ss < 0) return null
  const remainingSec = mm * 60 + ss
  const elapsedSec = PERIOD_LENGTH_SECONDS - remainingSec
  const eMm = Math.floor(elapsedSec / 60)
  const eSs = elapsedSec % 60
  // Match the Action Tracker's "M:SS" / "MM:SS" rendering — single-digit minute
  // for elapsed < 10 mins (Action Tracker leaves the leading zero off; matches
  // existing dedup behavior on rows already in DB).
  return `${String(eMm)}:${String(eSs).padStart(2, '0')}`
}

export async function promoteEvents(ctx: PromoterContext): Promise<void> {
  const { result, extractionId, matchId, sourcePath, db } = ctx
  if (matchId === null) {
    throw new Error('Events promoter requires --match-id at batch ingest time')
  }

  const gameTitleId = await resolveGameTitleIdFromExtraction(db, extractionId)
  const events = Array.isArray(result.events) ? (result.events as EventRowJson[]) : []

  const stats = {
    inserted: 0,
    dedup_refreshed: 0,
    skipped_unknown_type: 0,
    skipped_missing_clock: 0,
    skipped_missing_actor: 0,
    skipped_bad_period: 0,
    skipped_bad_clock_format: 0,
    /** Rows whose period came from the frame's first header (see resolve-period). */
    period_from_preceding_header: 0,
    /** Rows whose period came from the legacy per-period folder name. */
    period_from_path: 0,
  }

  // The Events screen scrolls, so rows rendered above the frame's first visible
  // period header arrive unlabelled (period_number 0 / period_label '?'). The
  // first labelled row bounds them — computed once per frame, used per row.
  const firstLabeled = firstLabeledPeriod(events)

  /** Rows dropped for an unresolvable period, kept for the warning below. */
  const unresolvedPeriodRows: string[] = []

  for (const ev of events) {
    if (ev.event_type === 'unknown') {
      stats.skipped_unknown_type++
      continue
    }
    const rawClock = stringValue(ev.clock)
    const actor = stringValue(ev.actor_snapshot)
    const teamAbbr = stringValue(ev.team_abbreviation)
    if (!rawClock) {
      stats.skipped_missing_clock++
      continue
    }
    if (!actor) {
      stats.skipped_missing_actor++
      continue
    }
    const resolved = resolveEventPeriod(ev.period_number, sourcePath, firstLabeled)
    const periodNumber = resolved.period
    if (periodNumber < 1) {
      // Nothing in the frame or the path could justify a period. Skip, but keep
      // the row visible: a silent drop here is what hid match 2661's penalty.
      stats.skipped_bad_period++
      unresolvedPeriodRows.push(stringValue(ev.raw_text) ?? `(${ev.event_type}, no raw text)`)
      continue
    }
    if (resolved.basis === 'preceding-header') stats.period_from_preceding_header++
    if (resolved.basis === 'path') stats.period_from_path++

    // Convert Events-screen "remaining" clock to canonical "elapsed" before
    // dedup so rows from Events screen and Action Tracker for the same goal
    // collapse correctly. Drop the row if conversion fails (malformed clock).
    const clock = remainingToElapsed(rawClock)
    if (!clock) {
      stats.skipped_bad_clock_format++
      continue
    }

    const teamSide: 'for' | 'against' =
      teamAbbr && BGM_ABBR_ALIASES.has(teamAbbr.toUpperCase()) ? 'for' : 'against'
    const eventDetail = stringValue(ev.raw_text) ?? null

    // Cross-capture dedup: do we already have this event from a prior OCR run?
    // - team_abbreviation is intentionally LEFT OUT of the dedup key — Action
    //   Tracker writes null for it (the BM/4TH chip lives on the rink map,
    //   not the list panel) while Events writes 'BM'/'4TH'.
    // - actor matching uses findExistingMatchEvent: prefer resolved player_id
    //   when available; fall back to Levenshtein-1 against same-bucket
    //   unresolved peers (handles OCR typos like fOEWS→TOEWS).
    const { playerId: actorPlayerId } = await resolveActorForMatch(actor, matchId, gameTitleId, db)

    const existingId = await findExistingMatchEvent(db, {
      matchId,
      periodNumber,
      eventType: ev.event_type,
      clock,
      actorPlayerId,
      actorSnapshot: actor,
    })

    let eventId: number
    if (existingId !== null) {
      // Cross-screen dedup hit. Events screen has the authoritative
      // team_abbreviation ('BM' / '4TH') and a derived team_side, plus often
      // a cleaner raw_text. Refresh those fields in addition to the
      // extraction pointer. Leave target_*, spatial (x/y/rink_zone/
      // position_confidence) untouched — those are written by Action Tracker.
      eventId = existingId
      await db
        .update(matchEvents)
        .set({
          ocrExtractionId: extractionId,
          teamSide,
          ...(teamAbbr !== null ? { teamAbbreviation: teamAbbr } : {}),
          ...(eventDetail !== null ? { eventDetail } : {}),
          ...(actorPlayerId !== null ? { actorPlayerId } : {}),
        })
        .where(eq(matchEvents.id, eventId))
      stats.dedup_refreshed++
    } else {
      const newEvent: NewMatchEvent = {
        matchId,
        periodNumber,
        // A recovered row's own label is the parser's '?' placeholder, which
        // would be misleading next to a real period number — store the
        // canonical screen label instead.
        periodLabel:
          resolved.basis === 'payload'
            ? ev.period_label || String(periodNumber)
            : (canonicalPeriodLabel(periodNumber) ?? (ev.period_label || String(periodNumber))),
        clock,
        eventType: ev.event_type,
        teamSide,
        teamAbbreviation: teamAbbr,
        actorPlayerId,
        actorGamertagSnapshot: actor,
        targetPlayerId: null,
        targetGamertagSnapshot: null,
        eventDetail,
        x: null,
        y: null,
        rinkZone: null,
        source: 'ocr',
        ocrExtractionId: extractionId,
        reviewStatus: 'pending_review',
      }

      const [inserted] = await db.insert(matchEvents).values(newEvent).returning({
        id: matchEvents.id,
      })
      if (!inserted) throw new Error('Failed to insert match_events row')
      eventId = inserted.id
      stats.inserted++
    }

    // Always upsert the extension table — Events screen is the only source of
    // assist + infraction detail, so even when match_events already exists
    // from an Action-Tracker insert (which leaves these NULL), we still want
    // to fill them in.
    if (ev.event_type === 'goal') {
      // Resolve assists. assists_snapshot is a list; we take up to 2.
      const assists = Array.isArray(ev.assists_snapshot) ? ev.assists_snapshot : []
      const primary = assists[0] ? stringValue(assists[0]) : null
      const secondary = assists[1] ? stringValue(assists[1]) : null
      const primaryPlayerId = primary
        ? (await resolveActorForMatch(primary, matchId, gameTitleId, db)).playerId
        : null
      const secondaryPlayerId = secondary
        ? (await resolveActorForMatch(secondary, matchId, gameTitleId, db)).playerId
        : null

      const goalRow: NewMatchGoalEvent = {
        eventId,
        scorerPlayerId: actorPlayerId,
        scorerSnapshot: actor,
        goalNumberInGame: numericValue(ev.goal_number_in_game),
        primaryAssistPlayerId: primaryPlayerId,
        primaryAssistSnapshot: primary,
        secondaryAssistPlayerId: secondaryPlayerId,
        secondaryAssistSnapshot: secondary,
      }
      await db
        .insert(matchGoalEvents)
        .values(goalRow)
        .onConflictDoUpdate({
          target: matchGoalEvents.eventId,
          set: {
            scorerPlayerId: actorPlayerId,
            scorerSnapshot: actor,
            goalNumberInGame: goalRow.goalNumberInGame,
            primaryAssistPlayerId: primaryPlayerId,
            primaryAssistSnapshot: primary,
            secondaryAssistPlayerId: secondaryPlayerId,
            secondaryAssistSnapshot: secondary,
          },
        })
    } else if (ev.event_type === 'penalty') {
      const infraction = stringValue(ev.infraction) ?? '(unknown)'
      const penaltyType = (stringValue(ev.penalty_type) ?? 'Minor') as 'Minor' | 'Major'
      const minutes = penaltyType === 'Major' ? 5 : 2
      const penaltyRow: NewMatchPenaltyEvent = {
        eventId,
        culpritPlayerId: actorPlayerId,
        culpritSnapshot: actor,
        infraction,
        penaltyType,
        minutes,
      }
      await db
        .insert(matchPenaltyEvents)
        .values(penaltyRow)
        .onConflictDoUpdate({
          target: matchPenaltyEvents.eventId,
          set: {
            culpritPlayerId: actorPlayerId,
            culpritSnapshot: actor,
            infraction,
            penaltyType,
            minutes,
          },
        })
    }
  }

  console.log('[events] stats:', JSON.stringify(stats))
  if (unresolvedPeriodRows.length > 0) {
    console.warn(
      `[events] WARN extraction ${String(extractionId)}: dropped ${String(
        unresolvedPeriodRows.length,
      )} row(s) with an unresolvable period (no labelled row in the frame to bound them): ` +
        unresolvedPeriodRows.map((r) => JSON.stringify(r)).join(', '),
    )
  }
}

async function resolveGameTitleIdFromExtraction(
  db: PromoterContext['db'],
  extractionId: number,
): Promise<number> {
  const result = await db.execute<{ game_title_id: number }>(
    drizzleSql`
      SELECT b.game_title_id
      FROM ocr_extractions e
      JOIN ocr_capture_batches b ON b.id = e.batch_id
      WHERE e.id = ${extractionId}
      LIMIT 1
    `,
  )
  const arr = result as unknown as Array<{ game_title_id: number }>
  if (!arr[0]) throw new Error(`Extraction ${String(extractionId)} not linked to a batch`)
  return arr[0].game_title_id
}

function stringValue(f: OcrExtractionField | undefined): string | null {
  if (!f) return null
  if (typeof f.value === 'string' && f.value) return f.value
  if (f.raw_text) return f.raw_text
  return null
}

function numericValue(f: OcrExtractionField | undefined): number | null {
  if (!f) return null
  if (typeof f.value === 'number' && Number.isFinite(f.value)) return Math.round(f.value)
  if (typeof f.value === 'string') {
    const n = Number.parseInt(f.value, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}
