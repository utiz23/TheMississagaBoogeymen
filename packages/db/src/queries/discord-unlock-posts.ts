import { eq, sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import { MATCH_TYPE, discordUnlockPosts } from '../schema/index.js'
import type { BadgeFamilyId, MythicThemeKey } from '../cards/badge-catalog.js'
import type { CardEventKind } from '../cards/progression.js'
import { MEMBER_CONDITION } from './club-members.js'
import { DISCORD_MAX_ATTEMPTS } from './discord-posts.js'

const MAX = sql.raw(String(DISCORD_MAX_ATTEMPTS))
const TYPES = sql.raw(`array[${MATCH_TYPE.map((t) => `'${t}'`).join(', ')}]`)

/**
 * Card events the discord service may post, one message each (spec §5.2):
 * active title, inside the window, no row or failed under the cap (pending
 * never re-picked), settled on every match type, a counted kind (every badge
 * level up, new card tier, mythic award; card level-ups are not posted since
 * 2026-10-26), a member who is not an AI goalie.
 * Ordered so a batch reads player by player, badge → level → tier → mythic.
 */
export function discordUnlockCandidatesSql(args: { since: Date; limit: number }): SQL {
  return sql`
    select ev.id
    from player_card_events ev
    join game_titles g on g.id = ev.game_title_id and g.is_active
    join players p on p.id = ev.player_id
    left join discord_unlock_posts d on d.event_id = ev.id
    where ev.occurred_at > ${args.since.toISOString()}::timestamptz
      and (d.event_id is null or (d.status = 'failed' and d.attempts < ${MAX}))
      and p.ai_goalie_side is null
      and ${MEMBER_CONDITION}
      and ((ev.kind = 'badge_level_up' and ev.to_value > ev.from_value)
           or ev.kind in ('tier_up', 'mythic_awarded'))
      and not exists (
        select 1 from unnest(${TYPES}::text[]) t(mt)
        where not exists (
          select 1 from ingestion_log l
          where l.game_title_id = ev.game_title_id and l.match_type = t.mt and l.started_at > ev.occurred_at
        )
      )
    order by ev.occurred_at,
      (select min(x.id) from player_card_events x
        where x.game_title_id = ev.game_title_id and x.occurred_at = ev.occurred_at and x.player_id = ev.player_id),
      case ev.kind when 'badge_level_up' then 0 when 'level_up' then 1 when 'tier_up' then 2 else 3 end,
      ev.id
    limit ${args.limit}`
}

export async function listDiscordUnlockCandidates(args: {
  since: Date
  limit: number
}): Promise<number[]> {
  const rows = await db.execute<{ id: string | number }>(discordUnlockCandidatesSql(args))
  return rows.map((r) => Number(r.id))
}

export function claimDiscordUnlockSql(eventId: number): SQL {
  return sql`
    insert into discord_unlock_posts (event_id, status, attempts)
    select ev.id, 'pending', 1 from player_card_events ev where ev.id = ${eventId}
    on conflict (event_id) do update
      set status = 'pending', attempts = discord_unlock_posts.attempts + 1, updated_at = now()
      where discord_unlock_posts.status = 'failed' and discord_unlock_posts.attempts < ${MAX}
    returning event_id`
}

export async function claimDiscordUnlock(eventId: number): Promise<boolean> {
  const rows = await db.execute(claimDiscordUnlockSql(eventId))
  return rows.length > 0
}

export async function markDiscordUnlockPosted(
  eventId: number,
  messageId: string | null,
): Promise<void> {
  await db
    .update(discordUnlockPosts)
    .set({
      status: 'posted',
      discordMessageId: messageId,
      lastError: null,
      postedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(discordUnlockPosts.eventId, eventId))
}

export async function markDiscordUnlockFailed(eventId: number, error: string): Promise<void> {
  await db
    .update(discordUnlockPosts)
    .set({ status: 'failed', lastError: error.slice(0, 500), updatedAt: sql`now()` })
    .where(eq(discordUnlockPosts.eventId, eventId))
}

export async function markDiscordUnlockSkipped(eventId: number, reason: string): Promise<void> {
  await db
    .update(discordUnlockPosts)
    .set({ status: 'skipped', lastError: reason.slice(0, 500), updatedAt: sql`now()` })
    .where(eq(discordUnlockPosts.eventId, eventId))
}

export interface UnlockEventRow {
  id: number
  playerId: number
  gameTitleId: number
  gamertag: string
  aiGoalie: boolean
  kind: CardEventKind
  familyId: BadgeFamilyId | null
  fromValue: number
  toValue: number
  /** The card's current mythic theme for that title (null when none / cleared). */
  mythicTheme: MythicThemeKey | null
}

/** One card event with what its post needs; null if no such event. */
export async function getUnlockEvent(eventId: number): Promise<UnlockEventRow | null> {
  const rows = await db.execute<{
    id: string | number
    player_id: number
    game_title_id: number
    gamertag: string
    ai_goalie_side: string | null
    kind: CardEventKind
    family_id: BadgeFamilyId | null
    from_value: number
    to_value: number
    mythic_theme: MythicThemeKey | null
  }>(sql`
    select ev.id, ev.player_id, ev.game_title_id, p.gamertag, p.ai_goalie_side, ev.kind,
      ev.family_id, ev.from_value, ev.to_value, cp.mythic_theme
    from player_card_events ev
    join players p on p.id = ev.player_id
    left join player_card_progress cp on cp.player_id = ev.player_id and cp.game_title_id = ev.game_title_id
    where ev.id = ${eventId}`)
  const r = rows[0]
  if (!r) return null
  return {
    id: Number(r.id),
    playerId: Number(r.player_id),
    gameTitleId: Number(r.game_title_id),
    gamertag: r.gamertag,
    aiGoalie: r.ai_goalie_side !== null,
    kind: r.kind,
    familyId: r.family_id,
    fromValue: Number(r.from_value),
    toValue: Number(r.to_value),
    mythicTheme: r.mythic_theme,
  }
}
