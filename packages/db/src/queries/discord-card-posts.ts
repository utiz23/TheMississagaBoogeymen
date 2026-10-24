import { asc, eq, sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import { MATCH_TYPE, discordCardPosts, playerCardEvents, players } from '../schema/index.js'
import type { BadgeFamilyId } from '../cards/badge-catalog.js'
import type { CardEventKind } from '../cards/progression.js'
import { MEMBER_CONDITION } from './club-members.js'
import { DISCORD_MAX_ATTEMPTS } from './discord-posts.js'

const MAX = sql.raw(String(DISCORD_MAX_ATTEMPTS))

/**
 * Every match type the worker fetches. A game post settles per type (a later
 * ingestion_log row of ITS type); a card batch waits for all of them, so a 3s
 * or private game always posts before that cycle's card changes.
 */
const TYPES = sql.raw(`array[${MATCH_TYPE.map((t) => `'${t}'`).join(', ')}]`)

/**
 * An event a card-update post shows (spec §4), alias `ce`: a new badge
 * numeral (every 5 internal steps), a card level up, a tier up, a mythic
 * award. Internal badge steps and cleared mythics never count.
 */
const COUNTED_EVENT = sql`(
  (ce.kind = 'badge_level_up' and ceil(ce.to_value / 5.0) > ceil(ce.from_value / 5.0))
  or ce.kind in ('level_up', 'tier_up', 'mythic_awarded')
)`

/**
 * Card batches the discord service may post: active title, inside the window,
 * no row or failed under the cap (pending is never re-picked), settled (the
 * worker fetched every match type again after the batch), and at least one counted event
 * for a real teammate (a member, never an AI goalie). The window is passed as
 * text: postgres.js rejects a Date param inside raw sql.
 */
export function discordCardBatchCandidatesSql(args: { since: Date; limit: number }): SQL {
  return sql`
    with batches as (
      select ev.game_title_id, ev.occurred_at, min(ev.id) as batch_event_id
      from player_card_events ev
      join game_titles g on g.id = ev.game_title_id and g.is_active
      where ev.occurred_at > ${args.since.toISOString()}::timestamptz
      group by ev.game_title_id, ev.occurred_at
    )
    select b.batch_event_id
    from batches b
    left join discord_card_posts d on d.batch_event_id = b.batch_event_id
    where (d.batch_event_id is null or (d.status = 'failed' and d.attempts < ${MAX}))
      and not exists (
        select 1 from unnest(${TYPES}::text[]) t(mt)
        where not exists (
          select 1 from ingestion_log l
          where l.game_title_id = b.game_title_id and l.match_type = t.mt and l.started_at > b.occurred_at
        )
      )
      and exists (
        select 1 from player_card_events ce
        join players p on p.id = ce.player_id
        where ce.game_title_id = b.game_title_id and ce.occurred_at = b.occurred_at
          and p.ai_goalie_side is null
          and ${MEMBER_CONDITION}
          and ${COUNTED_EVENT}
      )
    order by b.batch_event_id
    limit ${args.limit}`
}

export async function listDiscordCardBatchCandidates(args: {
  since: Date
  limit: number
}): Promise<number[]> {
  const rows = await db.execute<{ batch_event_id: string | number }>(
    discordCardBatchCandidatesSql(args),
  )
  return rows.map((r) => Number(r.batch_event_id))
}

/** Atomic claim, same rule as claimDiscordPost: new ⇒ pending; failed under the cap ⇒ pending. */
export function claimDiscordCardPostSql(batchEventId: number): SQL {
  return sql`
    insert into discord_card_posts (batch_event_id, game_title_id, occurred_at, status, attempts)
    select ev.id, ev.game_title_id, ev.occurred_at, 'pending', 1
    from player_card_events ev where ev.id = ${batchEventId}
    on conflict (batch_event_id) do update
      set status = 'pending', attempts = discord_card_posts.attempts + 1, updated_at = now()
      where discord_card_posts.status = 'failed' and discord_card_posts.attempts < ${MAX}
    returning batch_event_id`
}

export async function claimDiscordCardPost(batchEventId: number): Promise<boolean> {
  const rows = await db.execute(claimDiscordCardPostSql(batchEventId))
  return rows.length > 0
}

export async function markDiscordCardPostPosted(
  batchEventId: number,
  messageId: string | null,
): Promise<void> {
  await db
    .update(discordCardPosts)
    .set({
      status: 'posted',
      discordMessageId: messageId,
      lastError: null,
      postedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(discordCardPosts.batchEventId, batchEventId))
}

export async function markDiscordCardPostFailed(
  batchEventId: number,
  error: string,
): Promise<void> {
  await db
    .update(discordCardPosts)
    .set({ status: 'failed', lastError: error.slice(0, 500), updatedAt: sql`now()` })
    .where(eq(discordCardPosts.batchEventId, batchEventId))
}

export async function markDiscordCardPostSkipped(
  batchEventId: number,
  reason: string,
): Promise<void> {
  await db
    .update(discordCardPosts)
    .set({ status: 'skipped', lastError: reason.slice(0, 500), updatedAt: sql`now()` })
    .where(eq(discordCardPosts.batchEventId, batchEventId))
}

export interface CardEventRow {
  id: number
  playerId: number
  gamertag: string
  aiGoalie: boolean
  kind: CardEventKind
  familyId: BadgeFamilyId | null
  fromValue: number
  toValue: number
}

/**
 * Every event of the batch named by `batchEventId`, in id order. The batch is
 * matched to its head event inside SQL, so a writer whose timestamps carry
 * microseconds (e.g. `defaultNow()`) still groups correctly.
 */
export function cardEventBatchQuery(batchEventId: number) {
  return db
    .select({
      id: playerCardEvents.id,
      gameTitleId: playerCardEvents.gameTitleId,
      occurredAt: playerCardEvents.occurredAt,
      playerId: playerCardEvents.playerId,
      gamertag: players.gamertag,
      aiGoalieSide: players.aiGoalieSide,
      kind: playerCardEvents.kind,
      familyId: playerCardEvents.familyId,
      fromValue: playerCardEvents.fromValue,
      toValue: playerCardEvents.toValue,
    })
    .from(playerCardEvents)
    .innerJoin(players, eq(players.id, playerCardEvents.playerId))
    .where(
      sql`(${playerCardEvents.gameTitleId}, ${playerCardEvents.occurredAt}) = (select h.game_title_id, h.occurred_at from player_card_events h where h.id = ${batchEventId})`,
    )
    .orderBy(asc(playerCardEvents.id))
}

/** The batch named by `batchEventId`; null if no such event. */
export async function getCardEventBatch(
  batchEventId: number,
): Promise<{ gameTitleId: number; occurredAt: Date; events: CardEventRow[] } | null> {
  const rows = await cardEventBatchQuery(batchEventId)
  const head = rows[0]
  if (!head) return null
  return {
    gameTitleId: head.gameTitleId,
    occurredAt: head.occurredAt,
    events: rows.map(({ aiGoalieSide, gameTitleId: _t, occurredAt: _o, ...r }) => ({
      ...r,
      aiGoalie: aiGoalieSide !== null,
    })),
  }
}
