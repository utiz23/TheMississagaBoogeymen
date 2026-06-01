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
 * else 'against'. If both actor AND target are unresolved we default to
 * 'against' and log a warning; the row stays at review_status='pending_review'
 * (which hides it from the UI) until the Events-screen promoter merges in the
 * authoritative team_abbreviation and overwrites team_side on dedup hit.
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
import { deriveTeamSide, resolveActorForMatch } from './resolve-identity.js'
import { findExistingMatchEvent } from './match-events-dedup.js'
import { resolvePeriod } from './resolve-period.js'
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

/**
 * Recover event_type from the raw OCR text when the parser failed to classify it.
 *
 * The Action Tracker's right-column event tag ("SHOT", "GOAL", "HIT", "PENALTY",
 * "FACEOFF") regularly OCR-corrupts to forms like "SHDT", "GDAL", "10HS", or
 * "LOHS" where digit-letter confusion ate the original glyphs. The Python
 * parser leaves these as `event_type='unknown'`, which blocks both the
 * cross-screen dedup and the spatial UPDATE. Pattern-match the corrupted forms
 * here so the row can still be positioned and counted.
 */
function inferEventTypeFromRawText(
  rawText: string,
): 'shot' | 'hit' | 'goal' | 'penalty' | 'faceoff' | null {
  const t = rawText.toUpperCase()
  // GOAL — check before SHOT so "GOAL"/"GDAL" doesn't slip into shot-only patterns.
  if (/\bG[\dDO0OQ]AL\b|\bGAOL\b|\bGAUL\b|\bGOA[1IL]\b/.test(t)) return 'goal'
  // SHOT — direct & OCR variants (digit/letter swaps around S, H, O, T).
  if (/\bSH[D0OQ]T\b|\bSH[O0]T\b/.test(t)) return 'shot'
  // Also the plural form "SHOTS" that the parser sometimes mis-splits.
  if (/\b[1IL][O0]HS\b|\bL[O0]HS\b|\b10HS\b/.test(t)) return 'shot'
  if (/\bHIT\b|\bH[1I]T\b/.test(t)) return 'hit'
  if (/\bPEN(ALTY)?\b/.test(t)) return 'penalty'
  if (/\bFACE(O[FT]F)?\b|\bFO\b/.test(t)) return 'faceoff'
  return null
}

function resolveEventType(
  parsed: ActionTrackerEventJson['event_type'],
  rawText: string,
): ActionTrackerEventJson['event_type'] {
  if (parsed !== 'unknown') return parsed
  return inferEventTypeFromRawText(rawText) ?? 'unknown'
}

export async function promoteActionTracker(ctx: PromoterContext): Promise<void> {
  const { result, extractionId, matchId, sourcePath, db } = ctx
  if (matchId === null) {
    throw new Error('Action Tracker promoter requires --match-id at batch ingest time')
  }

  const gameTitleId = await resolveGameTitleIdFromExtraction(db, extractionId)
  const events = Array.isArray(result.events) ? (result.events as ActionTrackerEventJson[]) : []

  const stats = {
    inserted: 0,
    dedup_refreshed: 0,
    skipped_unknown_type: 0,
    skipped_missing_clock: 0,
    skipped_missing_actor: 0,
    skipped_bad_period: 0,
    team_side_defaulted: 0,
    penalty_placeholder: 0,
  }

  for (const ev of events) {
    const eventType = resolveEventType(ev.event_type, stringValue(ev.raw_text) ?? '')
    if (eventType === 'unknown') {
      stats.skipped_unknown_type++
      continue
    }
    const clock = stringValue(ev.clock)
    const actor = stringValue(ev.actor_snapshot)
    if (!clock) {
      stats.skipped_missing_clock++
      continue
    }
    if (!actor) {
      stats.skipped_missing_actor++
      continue
    }
    const periodNumber = resolvePeriod(ev.period_number, sourcePath)
    if (periodNumber < 1) {
      stats.skipped_bad_period++
      continue
    }

    // Resolve actor + target → players.id. team_side prefers actor → BGM,
    // and falls back to target → BGM (meaning opp did something to a BGM
    // player, so the event is 'against'). The Action Tracker screen
    // doesn't show team abbreviations, so we infer team identity through
    // the rostered-player check on both ends of the event.
    const target = stringValue(ev.target_snapshot)
    const { playerId: actorPlayerId } = await resolveActorForMatch(actor, matchId, gameTitleId, db)
    const { playerId: targetPlayerId } = target
      ? await resolveActorForMatch(target, matchId, gameTitleId, db)
      : { playerId: null }
    const teamSide = deriveTeamSide(actorPlayerId, targetPlayerId)

    // Both ends unresolved → team_side defaults to 'against' arbitrarily.
    // The Events promoter (when it later runs) will overwrite team_side from
    // the authoritative team_abbreviation chip; until then, log so the
    // brittle default is observable in worker output.
    if (actorPlayerId === null && targetPlayerId === null) {
      stats.team_side_defaulted++
      console.warn(
        `[action-tracker] team_side defaulted to 'against' — both actor (${actor}) and target (${target ?? '<none>'}) unresolved (match=${String(matchId)}, period=${String(periodNumber)}, clock=${clock})`,
      )
    }

    const eventDetail = stringValue(ev.raw_text) ?? null

    // Cross-screen dedup via findExistingMatchEvent: prefers resolved
    // player_id when available; falls back to Levenshtein-1 against
    // same-bucket unresolved peers so OCR typos (SIlKY/SILKY, WILOE/WILDE,
    // fOEWS/TOEWS) collapse instead of duplicating. Note we leave
    // teamAbbreviation out of the key — Action Tracker doesn't expose it
    // (BM/4TH chip is on the rink map, not the list panel) while events.ts
    // writes the actual abbrev.
    const existingId = await findExistingMatchEvent(db, {
      matchId,
      periodNumber,
      eventType,
      clock,
      actorPlayerId,
      actorSnapshot: actor,
    })

    if (existingId !== null) {
      // Cross-screen dedup hit. Action Tracker is the only source of
      // target_* (Events screen doesn't carry it), so backfill those when
      // present. Do NOT clobber team_abbreviation (Events screen owns it)
      // or team_side (Events screen has the authoritative chip), and do
      // NOT touch spatial — that's the Phase 5 update block below.
      await db
        .update(matchEvents)
        .set({
          ocrExtractionId: extractionId,
          ...(targetPlayerId !== null ? { targetPlayerId } : {}),
          ...(target !== null ? { targetGamertagSnapshot: target } : {}),
        })
        .where(eq(matchEvents.id, existingId))
      stats.dedup_refreshed++
      continue
    }

    const newEvent: NewMatchEvent = {
      matchId,
      periodNumber,
      periodLabel: ev.period_label || String(periodNumber),
      clock,
      eventType,
      teamSide,
      teamAbbreviation: null,
      actorPlayerId,
      actorGamertagSnapshot: actor,
      targetPlayerId,
      targetGamertagSnapshot: target,
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
    stats.inserted++

    if (eventType === 'goal') {
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
    } else if (eventType === 'penalty') {
      // Action Tracker doesn't carry infraction text — the Events screen is
      // the only source. Insert with placeholders and log so the row's need
      // for an Events-screen merge is observable; the existing review_status
      // ('pending_review') already hides it from the UI until merged.
      stats.penalty_placeholder++
      console.warn(
        `[action-tracker] penalty inserted with placeholder infraction='(unknown)' — awaits Events-screen merge (match=${String(matchId)}, period=${String(periodNumber)}, clock=${clock}, actor=${actor})`,
      )
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
  // in the UI); the highlighted event is the one with the white panel
  // underline, detected via detect_selected_row_index. When that detector
  // fails (typically because the selected row is scrolled partially off
  // the panel edge — the underline isn't fully visible), we must NOT
  // fall back to events[0]: the yellow rink position belongs to whichever
  // row is highlighted, and that's almost never events[0] when the
  // detector failed. The prior fallback silently wrote yellow positions
  // to wrong events, corrupting their attribution on /games/[id].
  const selectedIdx = result.selected_event_index as number | null | undefined
  const selectedEvent =
    selectedIdx != null && selectedIdx >= 0 && selectedIdx < events.length
      ? events[selectedIdx]
      : null
  const selectedEventType = selectedEvent
    ? resolveEventType(selectedEvent.event_type, stringValue(selectedEvent.raw_text) ?? '')
    : 'unknown'
  if (selectedX != null && selectedY != null && selectedEvent && selectedEventType !== 'unknown') {
    const clock = stringValue(selectedEvent.clock)
    const actor = stringValue(selectedEvent.actor_snapshot)
    const selectedPeriod = resolvePeriod(selectedEvent.period_number, sourcePath)
    if (clock && actor && selectedPeriod >= 1) {
      // Use the same dedup-aware lookup as the insert loop so the spatial
      // UPDATE lands on the canonical row even when this capture's actor
      // string is a Levenshtein-1 typo of an existing row's actor.
      const { playerId: selectedActorPlayerId } = await resolveActorForMatch(
        actor,
        matchId,
        gameTitleId,
        db,
      )
      const targetId = await findExistingMatchEvent(db, {
        matchId,
        periodNumber: selectedPeriod,
        eventType: selectedEventType,
        clock,
        actorPlayerId: selectedActorPlayerId,
        actorSnapshot: actor,
      })
      if (targetId !== null) {
        await db
          .update(matchEvents)
          .set({
            x: selectedX.toFixed(2),
            y: selectedY.toFixed(2),
            rinkZone: selectedZone ?? null,
            positionConfidence,
          })
          .where(eq(matchEvents.id, targetId))
      }
    }
  }

  console.log('[action-tracker] stats:', JSON.stringify(stats))
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
