/**
 * Promote post_game_events extractions into match_events + extension tables.
 *
 * Event rows from the post-game Events screen are goals and penalties only.
 * (Action Tracker covers shots/hits/faceoffs separately and shares the same
 * dedup key, so cross-screen rows for the same goal collapse to one row.)
 *
 * Dedup key: (matchId, periodNumber, clock, eventType, teamAbbreviation,
 * actorGamertagSnapshot). When a row already exists with that key under
 * source='ocr', we update its ocr_extraction_id to point at the new extraction
 * but leave domain fields intact — the original capture wins on conflict.
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
import { resolveGamertagToPlayer } from './resolve-identity.js'
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

export async function promoteEvents(ctx: PromoterContext): Promise<void> {
  const { result, extractionId, matchId, db } = ctx
  if (matchId === null) {
    throw new Error('Events promoter requires --match-id at batch ingest time')
  }

  const gameTitleId = await resolveGameTitleIdFromExtraction(db, extractionId)
  const events = Array.isArray(result.events) ? (result.events as EventRowJson[]) : []

  for (const ev of events) {
    if (ev.event_type === 'unknown') continue
    const clock = stringValue(ev.clock)
    const actor = stringValue(ev.actor_snapshot)
    const teamAbbr = stringValue(ev.team_abbreviation)
    if (!clock || !actor) continue
    if (ev.period_number < 1) continue

    const teamSide: 'for' | 'against' =
      teamAbbr && BGM_ABBR_ALIASES.has(teamAbbr.toUpperCase()) ? 'for' : 'against'

    // Cross-capture dedup: do we already have this event from a prior OCR run?
    const existing = await db
      .select({ id: matchEvents.id })
      .from(matchEvents)
      .where(
        and(
          eq(matchEvents.matchId, matchId),
          eq(matchEvents.periodNumber, ev.period_number),
          eq(matchEvents.eventType, ev.event_type),
          eq(matchEvents.source, 'ocr'),
          drizzleSql`coalesce(${matchEvents.clock}, '') = ${clock}`,
          drizzleSql`coalesce(${matchEvents.teamAbbreviation}, '') = ${teamAbbr ?? ''}`,
          drizzleSql`coalesce(${matchEvents.actorGamertagSnapshot}, '') = ${actor}`,
        ),
      )
      .limit(1)

    if (existing.length > 0 && existing[0]) {
      // Already have it — refresh the extraction pointer to the latest source.
      await db
        .update(matchEvents)
        .set({ ocrExtractionId: extractionId })
        .where(eq(matchEvents.id, existing[0].id))
      continue
    }

    const { playerId: actorPlayerId } = await resolveGamertagToPlayer(actor, gameTitleId, db)

    const newEvent: NewMatchEvent = {
      matchId,
      periodNumber: ev.period_number,
      periodLabel: ev.period_label || String(ev.period_number),
      clock,
      eventType: ev.event_type,
      teamSide,
      teamAbbreviation: teamAbbr,
      actorPlayerId,
      actorGamertagSnapshot: actor,
      targetPlayerId: null,
      targetGamertagSnapshot: null,
      eventDetail: stringValue(ev.raw_text) ?? null,
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

    if (ev.event_type === 'goal') {
      // Resolve assists. assists_snapshot is a list; we take up to 2.
      const assists = Array.isArray(ev.assists_snapshot) ? ev.assists_snapshot : []
      const primary = assists[0] ? stringValue(assists[0]) : null
      const secondary = assists[1] ? stringValue(assists[1]) : null
      const primaryPlayerId = primary
        ? (await resolveGamertagToPlayer(primary, gameTitleId, db)).playerId
        : null
      const secondaryPlayerId = secondary
        ? (await resolveGamertagToPlayer(secondary, gameTitleId, db)).playerId
        : null

      const goalRow: NewMatchGoalEvent = {
        eventId: inserted.id,
        scorerPlayerId: actorPlayerId,
        scorerSnapshot: actor,
        goalNumberInGame: numericValue(ev.goal_number_in_game),
        primaryAssistPlayerId: primaryPlayerId,
        primaryAssistSnapshot: primary,
        secondaryAssistPlayerId: secondaryPlayerId,
        secondaryAssistSnapshot: secondary,
      }
      await db.insert(matchGoalEvents).values(goalRow)
    } else if (ev.event_type === 'penalty') {
      const infraction = stringValue(ev.infraction) ?? '(unknown)'
      const penaltyType = (stringValue(ev.penalty_type) ?? 'Minor') as 'Minor' | 'Major'
      const minutes = penaltyType === 'Major' ? 5 : 2
      const penaltyRow: NewMatchPenaltyEvent = {
        eventId: inserted.id,
        culpritPlayerId: actorPlayerId,
        culpritSnapshot: actor,
        infraction,
        penaltyType,
        minutes,
      }
      await db.insert(matchPenaltyEvents).values(penaltyRow)
    }
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
