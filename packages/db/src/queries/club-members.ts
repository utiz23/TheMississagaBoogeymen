import { sql } from 'drizzle-orm'
import { db } from '../client.js'

/**
 * Team members, present and past — the only players with a player page
 * (operator, 2026-10-09). A member is on EA's club-member list for any title,
 * in the historical club-member archive, pinned to the roster (e.g. Jimmy
 * Cap), or one of the worker's AI goalies. Guests who only filled in for a
 * few games are not members. Uses the alias `p` for `players`.
 */
export const MEMBER_CONDITION = sql`(
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

export interface MemberGamertag {
  playerId: number
  gamertag: string
  /** False for an earlier gamertag from `player_gamertag_history`. */
  current: boolean
}

/**
 * Every team member's current gamertag, then their earlier ones (most recent
 * first) — what player page URLs are resolved against (lib/player-slug.ts).
 */
export async function listMemberGamertags(): Promise<MemberGamertag[]> {
  const rows = await db.execute<{ id: number; gamertag: string; current: boolean }>(
    sql`select id, gamertag, current from (
          select p.id, p.gamertag, true as current, null::timestamptz as seen_until
          from players p
          where ${MEMBER_CONDITION}
          union all
          select p.id, gh.gamertag, false, coalesce(gh.seen_until, gh.seen_from)
          from player_gamertag_history gh
          join players p on p.id = gh.player_id
          where gh.gamertag <> p.gamertag and ${MEMBER_CONDITION}
        ) t
        order by current desc, seen_until desc nulls last, id`,
  )
  return rows.map((r) => ({ playerId: Number(r.id), gamertag: r.gamertag, current: r.current }))
}

export interface RosterMenuMember {
  id: number
  gamertag: string
  jerseyNumber: number | null
}

/**
 * The current team, for the nav's Roster menu: human players on EA's
 * club-member list for `gameTitleId` (the default title), plus anyone pinned to
 * the roster. Past members and the AI goalies are left out. A–Z by gamertag.
 */
export async function listRosterMenuMembers(gameTitleId: number): Promise<RosterMenuMember[]> {
  const rows = await db.execute<{ id: number; gamertag: string; jersey_number: number | null }>(
    sql`select p.id, p.gamertag, pp.jersey_number
        from players p
        left join player_profiles pp on pp.player_id = p.id
        where p.ai_goalie_side is null
          and (
            p.pinned_to_roster
            or exists (
              select 1 from ea_member_season_stats e
              where e.player_id = p.id and e.game_title_id = ${gameTitleId}
            )
          )
        order by lower(p.gamertag)`,
  )
  return rows.map((r) => ({
    id: Number(r.id),
    gamertag: r.gamertag,
    jerseyNumber: r.jersey_number === null ? null : Number(r.jersey_number),
  }))
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
