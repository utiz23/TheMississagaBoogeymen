import { and, asc, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { db } from '../client.js'
import {
  matchEvents,
  matchGoalEvents,
  matchPenaltyEvents,
  matchPeriodSummaries,
  matches,
  ocrExtractions,
  players,
} from '../schema/index.js'
import type { GameMode, MatchResult } from '../schema/index.js'
import { normalizePosition, periodKey, resolvePeriodDirections } from '../action-map/directions.js'

/**
 * Goal/penalty/shot/hit/faceoff event log for a match, with extension-table
 * detail joined for goals and penalties.
 *
 * EA-source rows always pass; OCR-source rows pass only when reviewed. Ordered
 * by period_number then clock (descending — clock counts down within a period).
 *
 * Resolved actor / target identities are included as nested player objects;
 * unresolved snapshots fall through with raw text only.
 */
export async function getMatchEvents(matchId: number) {
  // Drizzle's relational join helpers don't compose well across two extension
  // tables, so use a left join for each. Identity joins for actor + target +
  // scorer + assists + culprit hit `players` via FK.
  const actor = sql<{ id: number; gamertag: string } | null>`
    CASE WHEN ${matchEvents.actorPlayerId} IS NULL THEN NULL ELSE
      jsonb_build_object('id', ${matchEvents.actorPlayerId}, 'gamertag', actor_p.gamertag)
    END
  `.as('actor')
  const target = sql<{ id: number; gamertag: string } | null>`
    CASE WHEN ${matchEvents.targetPlayerId} IS NULL THEN NULL ELSE
      jsonb_build_object('id', ${matchEvents.targetPlayerId}, 'gamertag', target_p.gamertag)
    END
  `.as('target')
  const scorer = sql<{ id: number; gamertag: string } | null>`
    CASE WHEN ${matchGoalEvents.scorerPlayerId} IS NULL THEN NULL ELSE
      jsonb_build_object('id', ${matchGoalEvents.scorerPlayerId}, 'gamertag', scorer_p.gamertag)
    END
  `.as('scorer')
  const primaryAssist = sql<{ id: number; gamertag: string } | null>`
    CASE WHEN ${matchGoalEvents.primaryAssistPlayerId} IS NULL THEN NULL ELSE
      jsonb_build_object('id', ${matchGoalEvents.primaryAssistPlayerId}, 'gamertag', pa_p.gamertag)
    END
  `.as('primary_assist')
  const secondaryAssist = sql<{ id: number; gamertag: string } | null>`
    CASE WHEN ${matchGoalEvents.secondaryAssistPlayerId} IS NULL THEN NULL ELSE
      jsonb_build_object('id', ${matchGoalEvents.secondaryAssistPlayerId}, 'gamertag', sa_p.gamertag)
    END
  `.as('secondary_assist')
  const culprit = sql<{ id: number; gamertag: string } | null>`
    CASE WHEN ${matchPenaltyEvents.culpritPlayerId} IS NULL THEN NULL ELSE
      jsonb_build_object('id', ${matchPenaltyEvents.culpritPlayerId}, 'gamertag', culprit_p.gamertag)
    END
  `.as('culprit')

  const rows = await db
    .select({
      id: matchEvents.id,
      periodNumber: matchEvents.periodNumber,
      periodLabel: matchEvents.periodLabel,
      clock: matchEvents.clock,
      eventType: matchEvents.eventType,
      teamSide: matchEvents.teamSide,
      teamAbbreviation: matchEvents.teamAbbreviation,
      actorPlayerId: matchEvents.actorPlayerId,
      actorGamertagSnapshot: matchEvents.actorGamertagSnapshot,
      targetPlayerId: matchEvents.targetPlayerId,
      targetGamertagSnapshot: matchEvents.targetGamertagSnapshot,
      eventDetail: matchEvents.eventDetail,
      x: matchEvents.x,
      y: matchEvents.y,
      rinkZone: matchEvents.rinkZone,
      positionConfidence: matchEvents.positionConfidence,
      source: matchEvents.source,
      reviewStatus: matchEvents.reviewStatus,
      actor,
      target,
      // Goal extension fields (null when event_type != 'goal').
      goalNumberInGame: matchGoalEvents.goalNumberInGame,
      scorerSnapshot: matchGoalEvents.scorerSnapshot,
      primaryAssistSnapshot: matchGoalEvents.primaryAssistSnapshot,
      secondaryAssistSnapshot: matchGoalEvents.secondaryAssistSnapshot,
      scorer,
      primaryAssist,
      secondaryAssist,
      // Penalty extension fields.
      infraction: matchPenaltyEvents.infraction,
      penaltyType: matchPenaltyEvents.penaltyType,
      penaltyMinutes: matchPenaltyEvents.minutes,
      culpritSnapshot: matchPenaltyEvents.culpritSnapshot,
      culprit,
    })
    .from(matchEvents)
    .leftJoin(matchGoalEvents, eq(matchGoalEvents.eventId, matchEvents.id))
    .leftJoin(matchPenaltyEvents, eq(matchPenaltyEvents.eventId, matchEvents.id))
    .leftJoin(sql`${players} AS actor_p`, sql`actor_p.id = ${matchEvents.actorPlayerId}`)
    .leftJoin(sql`${players} AS target_p`, sql`target_p.id = ${matchEvents.targetPlayerId}`)
    .leftJoin(sql`${players} AS scorer_p`, sql`scorer_p.id = ${matchGoalEvents.scorerPlayerId}`)
    .leftJoin(sql`${players} AS pa_p`, sql`pa_p.id = ${matchGoalEvents.primaryAssistPlayerId}`)
    .leftJoin(sql`${players} AS sa_p`, sql`sa_p.id = ${matchGoalEvents.secondaryAssistPlayerId}`)
    .leftJoin(
      sql`${players} AS culprit_p`,
      sql`culprit_p.id = ${matchPenaltyEvents.culpritPlayerId}`,
    )
    .where(
      and(
        eq(matchEvents.matchId, matchId),
        or(
          eq(matchEvents.source, 'ea'),
          and(eq(matchEvents.source, 'ocr'), eq(matchEvents.reviewStatus, 'reviewed')),
          and(eq(matchEvents.source, 'manual'), eq(matchEvents.reviewStatus, 'reviewed')),
        ),
      ),
    )
    .orderBy(
      asc(matchEvents.periodNumber),
      // clock is text "MM:SS" remaining (in-game countdown from 20:00) — sort
      // DESC by parsed seconds so events come back chronologically (oldest
      // first) within each period.
      sql`(split_part(${matchEvents.clock}, ':', 1)::int * 60
           + split_part(${matchEvents.clock}, ':', 2)::int) DESC NULLS LAST`,
    )

  return rows
}

export type MatchEventRow = Awaited<ReturnType<typeof getMatchEvents>>[number]

/**
 * All positioned events (x/y populated) for a single player across all matches.
 * Used by the career shot map on /roster/[id].
 *
 * Filters:
 *   - actor_player_id = playerId (the player did the shot/hit/etc.)
 *   - x and y are non-null (Phase 5 spatial extraction populated them)
 *   - reviewed only (review_status='reviewed')
 *
 * Sorted by match_id descending (most recent matches first), capped at `limit`.
 */
export async function getPlayerCareerShots(playerId: number, limit = 500) {
  return db
    .select({
      eventId: matchEvents.id,
      matchId: matchEvents.matchId,
      periodNumber: matchEvents.periodNumber,
      periodLabel: matchEvents.periodLabel,
      clock: matchEvents.clock,
      eventType: matchEvents.eventType,
      teamSide: matchEvents.teamSide,
      x: matchEvents.x,
      y: matchEvents.y,
      rinkZone: matchEvents.rinkZone,
      positionConfidence: matchEvents.positionConfidence,
      opponentName: matches.opponentName,
      playedAt: matches.playedAt,
    })
    .from(matchEvents)
    .innerJoin(matches, eq(matches.id, matchEvents.matchId))
    .where(
      and(
        eq(matchEvents.actorPlayerId, playerId),
        sql`${matchEvents.x} IS NOT NULL AND ${matchEvents.y} IS NOT NULL`,
        eq(matchEvents.reviewStatus, 'reviewed'),
      ),
    )
    .orderBy(desc(matchEvents.matchId))
    .limit(limit)
}

export type PlayerCareerShotRow = Awaited<ReturnType<typeof getPlayerCareerShots>>[number]

/**
 * OCR provenance for the Action Tracker section of a match — drives the
 * `Extracted / Sources / Confidence` footer.
 *
 * Restricts to reviewed OCR-sourced events (source='ocr') — the subset of
 * getMatchEvents' visibility rule that actually has OCR provenance. (`ea` rows
 * carry no extraction; `manual` rows are hand-attributed with a null
 * ocr_extraction_id, so the inner join below drops them regardless — they are
 * not OCR-derived and must not contribute to an OCR provenance footer.) The
 * only time signal on event rows is `ocr_extractions.extracted_at` (OCR-run
 * time, NOT a capture time), so the footer labels this range "Extracted"; it
 * can span reprocess runs.
 */
export interface MatchActionTrackerProvenance {
  extractedAt: { earliest: Date; latest: Date } | null
  sources: Array<{ screenType: string; eventCount: number }>
}

export async function getMatchActionTrackerProvenance(
  matchId: number,
): Promise<MatchActionTrackerProvenance> {
  const rows = await db
    .select({
      screenType: ocrExtractions.screenType,
      extractedAt: ocrExtractions.extractedAt,
    })
    .from(matchEvents)
    // inner join is intentional: ocr_extraction_id is a nullable FK, but
    // source='ocr' events always have it populated — null-FK rows are dropped.
    .innerJoin(ocrExtractions, eq(ocrExtractions.id, matchEvents.ocrExtractionId))
    .where(
      and(
        eq(matchEvents.matchId, matchId),
        eq(matchEvents.source, 'ocr'),
        eq(matchEvents.reviewStatus, 'reviewed'),
      ),
    )

  if (rows.length === 0) {
    return { extractedAt: null, sources: [] }
  }

  let earliest = rows[0]!.extractedAt
  let latest = rows[0]!.extractedAt
  const counts = new Map<string, number>()
  for (const r of rows) {
    if (r.extractedAt < earliest) earliest = r.extractedAt
    if (r.extractedAt > latest) latest = r.extractedAt
    counts.set(r.screenType, (counts.get(r.screenType) ?? 0) + 1)
  }

  return {
    extractedAt: { earliest, latest },
    sources: [...counts.entries()]
      .map(([screenType, eventCount]) => ({ screenType, eventCount }))
      .sort((a, b) => b.eventCount - a.eventCount),
  }
}

/** One event on the Career Action Map (spec Part 5). */
export interface CareerActionRow {
  eventId: number
  matchId: number
  periodNumber: number
  clock: string | null
  eventType: string
  /** 'by' = the player is the actor; 'on' = the player is the target. */
  role: 'by' | 'on'
  actorName: string | null
  targetName: string | null
  infraction: string | null
  /** Normalised so BGM attacks right (hockey units); null = not plotted. */
  x: number | null
  y: number | null
  /** The event had a raw rink position (the < 5 hide rule counts these). */
  hasPosition: boolean
  positionConfidence: string | null
  opponent: string
  gameMode: GameMode | null
  result: MatchResult
  scoreFor: number
  scoreAgainst: number
  playedAt: Date
}

/**
 * Reviewed events where the player is the actor (By) or the target (On), newest
 * game first, with positions turned so BGM attacks right (see
 * action-map/directions.ts). Events in periods whose direction is unknown keep
 * x/y = null and are listed but not plotted.
 */
export async function getPlayerCareerActions(
  playerId: number,
  limit = 1000,
): Promise<CareerActionRow[]> {
  const rows = await db
    .select({
      eventId: matchEvents.id,
      matchId: matchEvents.matchId,
      periodNumber: matchEvents.periodNumber,
      clock: matchEvents.clock,
      eventType: matchEvents.eventType,
      actorPlayerId: matchEvents.actorPlayerId,
      actorName: sql<
        string | null
      >`coalesce(actor_p.gamertag, ${matchEvents.actorGamertagSnapshot})`,
      targetName: sql<
        string | null
      >`coalesce(target_p.gamertag, ${matchEvents.targetGamertagSnapshot})`,
      infraction: matchPenaltyEvents.infraction,
      x: matchEvents.x,
      y: matchEvents.y,
      positionConfidence: matchEvents.positionConfidence,
      oppTeamAbbr: matches.oppTeamAbbr,
      opponentName: matches.opponentName,
      gameMode: matches.gameMode,
      result: matches.result,
      scoreFor: matches.scoreFor,
      scoreAgainst: matches.scoreAgainst,
      playedAt: matches.playedAt,
    })
    .from(matchEvents)
    .innerJoin(matches, eq(matches.id, matchEvents.matchId))
    .leftJoin(matchPenaltyEvents, eq(matchPenaltyEvents.eventId, matchEvents.id))
    .leftJoin(sql`${players} AS actor_p`, sql`actor_p.id = ${matchEvents.actorPlayerId}`)
    .leftJoin(sql`${players} AS target_p`, sql`target_p.id = ${matchEvents.targetPlayerId}`)
    .where(
      and(
        eq(matchEvents.reviewStatus, 'reviewed'),
        or(eq(matchEvents.actorPlayerId, playerId), eq(matchEvents.targetPlayerId, playerId)),
      ),
    )
    .orderBy(
      desc(matches.playedAt),
      asc(matchEvents.periodNumber),
      sql`(split_part(${matchEvents.clock}, ':', 1)::int * 60
           + split_part(${matchEvents.clock}, ':', 2)::int) DESC NULLS LAST`,
    )
    .limit(limit)
  if (rows.length === 0) return []

  const matchIds = [...new Set(rows.map((r) => r.matchId))]
  const [recorded, shotSides] = await Promise.all([
    db
      .select({
        matchId: matchPeriodSummaries.matchId,
        periodNumber: matchPeriodSummaries.periodNumber,
        direction: matchPeriodSummaries.bgmAttackDirection,
      })
      .from(matchPeriodSummaries)
      .where(
        and(
          inArray(matchPeriodSummaries.matchId, matchIds),
          isNotNull(matchPeriodSummaries.bgmAttackDirection),
        ),
      ),
    db
      .select({
        matchId: matchEvents.matchId,
        periodNumber: matchEvents.periodNumber,
        total: sql<number>`count(*)::int`,
        right: sql<number>`(count(*) FILTER (WHERE ${matchEvents.x} > 0))::int`,
      })
      .from(matchEvents)
      .where(
        and(
          inArray(matchEvents.matchId, matchIds),
          eq(matchEvents.reviewStatus, 'reviewed'),
          eq(matchEvents.teamSide, 'for'),
          inArray(matchEvents.eventType, ['shot', 'goal']),
          isNotNull(matchEvents.x),
        ),
      )
      .groupBy(matchEvents.matchId, matchEvents.periodNumber),
  ])
  const directions = resolvePeriodDirections(recorded, shotSides)

  return rows.map((r) => {
    const hasPosition = r.x !== null && r.y !== null
    const dir = directions.get(periodKey(r.matchId, r.periodNumber))
    const pos =
      hasPosition && dir !== undefined ? normalizePosition(Number(r.x), Number(r.y), dir) : null
    return {
      eventId: r.eventId,
      matchId: r.matchId,
      periodNumber: r.periodNumber,
      clock: r.clock,
      eventType: r.eventType,
      role: r.actorPlayerId === playerId ? 'by' : 'on',
      actorName: r.actorName,
      targetName: r.targetName,
      infraction: r.infraction,
      x: pos?.x ?? null,
      y: pos?.y ?? null,
      hasPosition,
      positionConfidence: r.positionConfidence,
      opponent: r.oppTeamAbbr ?? r.opponentName,
      gameMode: r.gameMode,
      result: r.result,
      scoreFor: r.scoreFor,
      scoreAgainst: r.scoreAgainst,
      playedAt: r.playedAt,
    }
  })
}
