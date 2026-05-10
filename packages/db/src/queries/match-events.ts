import { and, asc, eq, or, sql } from 'drizzle-orm'
import { db } from '../client.js'
import {
  matchEvents,
  matchGoalEvents,
  matchPenaltyEvents,
  players,
} from '../schema/index.js'

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
    .leftJoin(sql`${players} AS culprit_p`, sql`culprit_p.id = ${matchPenaltyEvents.culpritPlayerId}`)
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
    .orderBy(asc(matchEvents.periodNumber), asc(matchEvents.clock))

  return rows
}

export type MatchEventRow = Awaited<ReturnType<typeof getMatchEvents>>[number]
