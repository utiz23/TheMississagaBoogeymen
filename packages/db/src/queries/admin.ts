import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../client.js'
import { players, sessions } from '../schema/index.js'

/**
 * Admin tools, release C1 (plan: docs/superpowers/plans/2026-10-09-admin-tools.md).
 * Every caller is an admin-only Server Action or page; these functions don't
 * check who is asking.
 */

export interface AdminPlayerRow {
  id: number
  gamertag: string
}

/** Players pinned to the roster (members without EA stats, e.g. Jimmy Cap). */
export async function listPinnedPlayers(): Promise<AdminPlayerRow[]> {
  return db
    .select({ id: players.id, gamertag: players.gamertag })
    .from(players)
    .where(eq(players.pinnedToRoster, true))
    .orderBy(sql`lower(${players.gamertag})`)
}

/**
 * Players an admin could pin: not AI goalies, not pinned, and not already a
 * member some other way (EA member list or member archive) — pinning those
 * would change nothing.
 */
export async function listPinCandidates(): Promise<AdminPlayerRow[]> {
  const rows = await db.execute<{ id: number; gamertag: string }>(sql`
    select p.id, p.gamertag from players p
    where p.ai_goalie_side is null
      and not p.pinned_to_roster
      and not exists (select 1 from ea_member_season_stats e where e.player_id = p.id)
      and not exists (select 1 from historical_club_member_season_stats h where h.player_id = p.id)
    order by lower(p.gamertag)`)
  return rows.map((r) => ({ id: Number(r.id), gamertag: r.gamertag }))
}

/**
 * Pin or unpin a player. Returns false when the player doesn't exist or is
 * one of the AI goalies (they are members by construction; their flag is the
 * worker's, not the admin's).
 */
export async function setPlayerPinned(playerId: number, pinned: boolean): Promise<boolean> {
  const updated = await db
    .update(players)
    .set({ pinnedToRoster: pinned })
    .where(and(eq(players.id, playerId), isNull(players.aiGoalieSide)))
    .returning({ id: players.id })
  return updated.length === 1
}

/** Sign out every session except the caller's own. Returns how many ended. */
export async function revokeAllSessionsExcept(keepSessionId: string): Promise<number> {
  const removed = await db
    .delete(sessions)
    .where(ne(sessions.id, keepSessionId))
    .returning({ id: sessions.id })
  return removed.length
}

export interface AdminTitleRow {
  id: number
  slug: string
  name: string
  isActive: boolean
  isDefault: boolean
  releaseOrder: number | null
  eaClubName: string | null
  matches: number
}

/** Every game title with its controls and match count, newest first (read-only view). */
export async function listTitlesForAdmin(): Promise<AdminTitleRow[]> {
  const rows = await db.execute<{
    id: number
    slug: string
    name: string
    is_active: boolean
    is_default: boolean
    release_order: number | null
    ea_club_name: string | null
    matches: number
  }>(sql`
    select g.id, g.slug, g.name, g.is_active, g.is_default, g.release_order, g.ea_club_name,
      (select count(*)::int from matches m where m.game_title_id = g.id) as matches
    from game_titles g
    order by g.release_order desc nulls last, g.id desc`)
  return rows.map((r) => ({
    id: Number(r.id),
    slug: r.slug,
    name: r.name,
    isActive: r.is_active,
    isDefault: r.is_default,
    releaseOrder: r.release_order === null ? null : Number(r.release_order),
    eaClubName: r.ea_club_name,
    matches: Number(r.matches),
  }))
}
