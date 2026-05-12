/**
 * Promote a post_game_action_tracker extraction into match_events.
 *
 * Action Tracker rows include shots, hits, penalties, goals, and faceoffs —
 * a superset of what the Events screen captures. We share the same dedup key
 * with the Events promoter so that a goal seen on both screens collapses to
 * one match_events row.
 *
 * Action Tracker rows do NOT carry actor team abbreviation directly (the BM/4TH
 * indicator is on the rink map, not the list panel). We infer team_side from
 * the actor gamertag's resolved player_id when possible: BGM player → 'for',
 * else 'against'. If the actor can't be resolved, default to 'for' and flag
 * for review (the row will land at review_status='pending_review' anyway).
 */

import {
  matchEvents,
  matchGoalEvents,
  matchPenaltyEvents,
  type NewMatchEvent,
  type NewMatchPenaltyEvent,
} from '@eanhl/db'
import { and, eq, sql as drizzleSql } from 'drizzle-orm'
import type { PromoterContext } from './index.js'
import { resolveGamertagToPlayer } from './resolve-identity.js'
import type { OcrExtractionField } from '../ocr-cli-runner.js'

interface ActionTrackerEventJson {
  raw_text: OcrExtractionField
  period_label: string
  period_number: number
  event_type: 'shot' | 'hit' | 'penalty' | 'goal' | 'faceoff' | 'unknown'
  actor_snapshot: OcrExtractionField
  target_snapshot: OcrExtractionField
  relation: OcrExtractionField
  clock: OcrExtractionField
}

export async function promoteActionTracker(ctx: PromoterContext): Promise<void> {
  const { result, extractionId, matchId, db } = ctx
  if (matchId === null) {
    throw new Error('Action Tracker promoter requires --match-id at batch ingest time')
  }

  const gameTitleId = await resolveGameTitleIdFromExtraction(db, extractionId)
  const events = Array.isArray(result.events) ? (result.events as ActionTrackerEventJson[]) : []

  for (const ev of events) {
    if (ev.event_type === 'unknown') continue
    const clock = stringValue(ev.clock)
    const actor = stringValue(ev.actor_snapshot)
    if (!clock || !actor) continue
    if (ev.period_number < 1) continue

    // Resolve actor → players.id; team_side derived from whether resolution found a BGM-rostered player.
    const { playerId: actorPlayerId } = await resolveGamertagToPlayer(actor, gameTitleId, db)
    // For the for/against decision: in Action Tracker we don't have the team
    // abbreviation directly. Default 'for' if the gamertag matched a known
    // player (presumed BGM); otherwise 'against'. This is a coarse heuristic
    // that the review pass will correct.
    const teamSide: 'for' | 'against' = actorPlayerId !== null ? 'for' : 'against'

    // Cross-screen dedup. Note we use empty string for teamAbbreviation since
    // Action Tracker doesn't expose it; events.ts uses the actual abbrev which
    // means goals from both screens MAY land twice if the team_abbrev differs.
    // Trade-off: deliberately permissive — review pass cleans up.
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
          drizzleSql`coalesce(${matchEvents.actorGamertagSnapshot}, '') = ${actor}`,
        ),
      )
      .limit(1)

    if (existing.length > 0 && existing[0]) {
      await db
        .update(matchEvents)
        .set({ ocrExtractionId: extractionId })
        .where(eq(matchEvents.id, existing[0].id))
      continue
    }

    const target = stringValue(ev.target_snapshot)
    const { playerId: targetPlayerId } = target
      ? await resolveGamertagToPlayer(target, gameTitleId, db)
      : { playerId: null }

    const newEvent: NewMatchEvent = {
      matchId,
      periodNumber: ev.period_number,
      periodLabel: ev.period_label || String(ev.period_number),
      clock,
      eventType: ev.event_type,
      teamSide,
      teamAbbreviation: null,
      actorPlayerId,
      actorGamertagSnapshot: actor,
      targetPlayerId,
      targetGamertagSnapshot: target,
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
      await db.insert(matchGoalEvents).values({
        eventId: inserted.id,
        scorerPlayerId: actorPlayerId,
        scorerSnapshot: actor,
        goalNumberInGame: null,
        primaryAssistPlayerId: null,
        primaryAssistSnapshot: null,
        secondaryAssistPlayerId: null,
        secondaryAssistSnapshot: null,
      })
    } else if (ev.event_type === 'penalty') {
      const penaltyRow: NewMatchPenaltyEvent = {
        eventId: inserted.id,
        culpritPlayerId: actorPlayerId,
        culpritSnapshot: actor,
        infraction: '(unknown)',
        penaltyType: 'Minor',
        minutes: 2,
      }
      await db.insert(matchPenaltyEvents).values(penaltyRow)
    }
    // shots / hits / faceoffs: no extension table, just match_events row.
  }

  // Phase 5: spatial update. The first event in `events` is the highlighted
  // (selected) one in the Action Tracker UI; the parser's spatial extractor
  // reports the yellow marker's position as result.selected_event_*. Update
  // the corresponding match_events row's x/y/rink_zone in place. Augment-only:
  // doesn't create new rows, only fills the spatial columns on whichever row
  // already represents that event (whether inserted just now or matched via
  // cross-screen dedup).
  const selectedX = result.selected_event_x as number | null | undefined
  const selectedY = result.selected_event_y as number | null | undefined
  const selectedZone = result.selected_event_rink_zone as string | null | undefined
  // 1.0 in-hull, 0.3 out-of-hull. Convert to a 2-value label for the DB.
  const selectedConfidenceRaw = result.selected_event_confidence as number | null | undefined
  const positionConfidence: 'interpolated' | 'extrapolated' | null =
    selectedConfidenceRaw == null
      ? null
      : selectedConfidenceRaw >= 0.5
        ? 'interpolated'
        : 'extrapolated'
  // The yellow-marker pixel position corresponds to the event at
  // `selected_event_index` in the parsed events list — NOT events[0].
  // Events are emitted in display order (top → bottom of the visible list
  // in the UI); the highlighted event is the one with the red row tint,
  // detected via detect_selected_row_index. When the index is missing we
  // fall back to events[0] for safety, but this is rare (the detector is
  // reliable on real captures).
  const selectedIdx = result.selected_event_index as number | null | undefined
  const selectedEvent =
    selectedIdx != null && selectedIdx >= 0 && selectedIdx < events.length
      ? events[selectedIdx]
      : events[0]
  if (
    selectedX != null &&
    selectedY != null &&
    selectedEvent &&
    selectedEvent.event_type !== 'unknown'
  ) {
    const clock = stringValue(selectedEvent.clock)
    const actor = stringValue(selectedEvent.actor_snapshot)
    if (clock && actor && selectedEvent.period_number >= 1) {
      await db
        .update(matchEvents)
        .set({
          x: selectedX.toFixed(2),
          y: selectedY.toFixed(2),
          rinkZone: selectedZone ?? null,
          positionConfidence,
        })
        .where(
          and(
            eq(matchEvents.matchId, matchId),
            eq(matchEvents.periodNumber, selectedEvent.period_number),
            eq(matchEvents.eventType, selectedEvent.event_type),
            eq(matchEvents.source, 'ocr'),
            drizzleSql`coalesce(${matchEvents.clock}, '') = ${clock}`,
            drizzleSql`coalesce(${matchEvents.actorGamertagSnapshot}, '') = ${actor}`,
          ),
        )
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
