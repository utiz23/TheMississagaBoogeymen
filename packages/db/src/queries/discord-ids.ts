import { eq, sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import { players } from '../schema/index.js'

/** A Discord user ID (snowflake): 17–20 digits. Same rule as the 0070 CHECK. */
export const DISCORD_USER_ID_RE = /^[0-9]{17,20}$/

/** The player's Discord user ID: their Discord sign-in wins, else the manual ID. */
export function playerDiscordUserIdSql(playerId: number): SQL {
  return sql`
    select coalesce(
      (select a.account_id from user_player_claims c
        join accounts a on a.user_id = c.user_id and a.provider_id = 'discord'
        where c.player_id = p.id limit 1),
      p.discord_user_id
    ) as discord_user_id
    from players p where p.id = ${playerId}`
}

export async function getPlayerDiscordUserId(playerId: number): Promise<string | null> {
  const rows = await db.execute<{ discord_user_id: string | null }>(
    playerDiscordUserIdSql(playerId),
  )
  const id = rows[0]?.discord_user_id ?? null
  return id !== null && DISCORD_USER_ID_RE.test(id) ? id : null
}

export interface DiscordPingRow {
  playerId: number
  gamertag: string
  /** From the player's Discord sign-in; read-only on the admin page. */
  signInId: string | null
  /** Entered on the admin page; used only without a sign-in ID. */
  manualId: string | null
}

/** The team for `gameTitleId` (as the roster menu) plus anyone with a manual ID, A–Z. */
export async function listDiscordPingRows(gameTitleId: number): Promise<DiscordPingRow[]> {
  const rows = await db.execute<{
    id: number
    gamertag: string
    sign_in_id: string | null
    manual_id: string | null
  }>(sql`
    select p.id, p.gamertag,
      (select a.account_id from user_player_claims c
        join accounts a on a.user_id = c.user_id and a.provider_id = 'discord'
        where c.player_id = p.id limit 1) as sign_in_id,
      p.discord_user_id as manual_id
    from players p
    where p.ai_goalie_side is null
      and (
        p.discord_user_id is not null
        or p.pinned_to_roster
        or exists (select 1 from ea_member_season_stats e where e.player_id = p.id and e.game_title_id = ${gameTitleId})
      )
    order by lower(p.gamertag)`)
  return rows.map((r) => ({
    playerId: Number(r.id),
    gamertag: r.gamertag,
    signInId: r.sign_in_id,
    manualId: r.manual_id,
  }))
}

export async function setPlayerDiscordUserId(playerId: number, id: string | null): Promise<void> {
  if (id !== null && !DISCORD_USER_ID_RE.test(id)) throw new Error('invalid Discord user ID')
  await db.update(players).set({ discordUserId: id }).where(eq(players.id, playerId))
}
