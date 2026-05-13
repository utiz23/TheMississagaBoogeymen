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
import { findExistingMatchEvent } from './match-events-dedup.js'
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
 * Derive period number from the capture's parent folder name.
 *
 * The recordings are organised on disk as `…/1st-Period-Events/`,
 * `…/2nd-Period-Events/`, `…/3rd-Period-Events/`, `…/OT-Events/`. When OCR
 * mis-parses the period_label (e.g. picks up extra garbage like "11.1" at the
 * end and the regex bails out, leaving period_number = -1), the folder name
 * is the authoritative fallback. Mirrors the same fallback used in
 * `tools/game_ocr/scripts/inventory_consensus_match.py:period_from_path`.
 */
function periodFromPath(sourcePath: string): number | null {
  const parts = sourcePath.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  const folder = (parts.length >= 2 ? parts[parts.length - 2] ?? '' : '').toLowerCase()
  if (folder.includes('1st')) return 1
  if (folder.includes('2nd')) return 2
  if (folder.includes('3rd')) return 3
  if (folder.includes('ot')) return 4
  return null
}

function resolvePeriod(eventPeriod: number, sourcePath: string): number {
  if (eventPeriod >= 1) return eventPeriod
  return periodFromPath(sourcePath) ?? eventPeriod
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

  for (const ev of events) {
    const eventType = resolveEventType(ev.event_type, stringValue(ev.raw_text) ?? '')
    if (eventType === 'unknown') continue
    const clock = stringValue(ev.clock)
    const actor = stringValue(ev.actor_snapshot)
    if (!clock || !actor) continue
    const periodNumber = resolvePeriod(ev.period_number, sourcePath)
    if (periodNumber < 1) continue

    // Resolve actor → players.id; team_side derived from whether resolution found a BGM-rostered player.
    const { playerId: actorPlayerId } = await resolveGamertagToPlayer(actor, gameTitleId, db)
    // For the for/against decision: in Action Tracker we don't have the team
    // abbreviation directly. Default 'for' if the gamertag matched a known
    // player (presumed BGM); otherwise 'against'. This is a coarse heuristic
    // that the review pass will correct.
    const teamSide: 'for' | 'against' = actorPlayerId !== null ? 'for' : 'against'

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
      await db
        .update(matchEvents)
        .set({ ocrExtractionId: extractionId })
        .where(eq(matchEvents.id, existingId))
      continue
    }

    const target = stringValue(ev.target_snapshot)
    const { playerId: targetPlayerId } = target
      ? await resolveGamertagToPlayer(target, gameTitleId, db)
      : { playerId: null }

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
  if (
    selectedX != null &&
    selectedY != null &&
    selectedEvent &&
    selectedEventType !== 'unknown'
  ) {
    const clock = stringValue(selectedEvent.clock)
    const actor = stringValue(selectedEvent.actor_snapshot)
    const selectedPeriod = resolvePeriod(selectedEvent.period_number, sourcePath)
    if (clock && actor && selectedPeriod >= 1) {
      // Use the same dedup-aware lookup as the insert loop so the spatial
      // UPDATE lands on the canonical row even when this capture's actor
      // string is a Levenshtein-1 typo of an existing row's actor.
      const { playerId: selectedActorPlayerId } = await resolveGamertagToPlayer(
        actor,
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
