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

export interface InvitablePlayer {
  id: number
  gamertag: string
  /** Already linked to a member account. */
  isClaimed: boolean
}

/**
 * Players an admin can invite to a member account: human team members (the
 * AI goalies are members for page purposes, but nobody signs in as them).
 */
export async function listInvitablePlayers(): Promise<InvitablePlayer[]> {
  const rows = await db.execute<{ id: number; gamertag: string; is_claimed: boolean }>(
    sql`select p.id, p.gamertag,
          exists (select 1 from user_player_claims c where c.player_id = p.id) as is_claimed
        from players p
        where p.ai_goalie_side is null and ${MEMBER_CONDITION}
        order by lower(p.gamertag)`,
  )
  return rows.map((r) => ({ id: Number(r.id), gamertag: r.gamertag, isClaimed: r.is_claimed }))
}
