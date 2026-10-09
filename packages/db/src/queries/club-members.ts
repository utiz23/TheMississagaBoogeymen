import { sql } from 'drizzle-orm'
import { db } from '../client.js'

/**
 * Team members, present and past — the only players with a player page
 * (operator, 2026-10-09). A member is on EA's club-member list for any title,
 * in the historical club-member archive, pinned to the roster (e.g. Jimmy
 * Cap), or one of the worker's AI goalies. Guests who only filled in for a
 * few games are not members.
 */
const MEMBER_CONDITION = sql`(
  p.pinned_to_roster
  or p.ai_goalie_side is not null
  or exists (select 1 from ea_member_season_stats e where e.player_id = p.id)
  or exists (select 1 from historical_club_member_season_stats h where h.player_id = p.id)
)`

export async function getClubMemberIds(): Promise<number[]> {
  const rows = await db.execute<{ id: number }>(
    sql`select p.id from players p where ${MEMBER_CONDITION} order by p.id`,
  )
  return rows.map((r) => Number(r.id))
}

export async function isClubMember(playerId: number): Promise<boolean> {
  const rows = await db.execute<{ id: number }>(
    sql`select p.id from players p where p.id = ${playerId} and ${MEMBER_CONDITION}`,
  )
  return rows.length > 0
}
