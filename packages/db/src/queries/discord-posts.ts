import { and, asc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../client.js'
import {
  discordPosts,
  gameTitles,
  ingestionLog,
  matches,
  rawMatchPayloads,
} from '../schema/index.js'

/** A failed post is retried until it has been attempted this many times. */
export const DISCORD_MAX_ATTEMPTS = 3

/** A match whose raw payload has no ingestion_log row waits this long instead. */
export const DISCORD_UNLOGGED_SETTLE_MS = 15 * 60_000

/**
 * Games the discord service may post: active title, ended after `since`, and
 * either never touched or failed under the attempt cap. `pending`, `posted`
 * and `skipped` rows are never returned. Joined select, so Drizzle qualifies
 * every column (see feedback: unqualified columns in single-table selects).
 *
 * Settled only: the worker commits a match mid-cycle and then still adds AI
 * goalies, resolves members and recomputes cards. Its loop never overlaps, so
 * once the same title + match type has a later ingestion_log row, the cycle
 * that ingested this match has finished. A payload with no log row (manual
 * insert) waits until `unloggedBefore` instead.
 */
export function discordPostCandidatesQuery(args: {
  since: Date
  limit: number
  unloggedBefore: Date
}) {
  const settled = sql`exists (
    select 1 from ${rawMatchPayloads} r
    left join ${ingestionLog} l1 on l1.id = r.ingestion_log_id
    where r.game_title_id = ${matches.gameTitleId} and r.ea_match_id = ${matches.eaMatchId}
      and (
        (l1.id is not null and exists (
          select 1 from ${ingestionLog} l2
          where l2.id > l1.id and l2.game_title_id = l1.game_title_id and l2.match_type = l1.match_type
        ))
        or (l1.id is null and r.ingested_at < ${args.unloggedBefore.toISOString()}::timestamptz)
      )
  )`
  return db
    .select({ matchId: matches.id })
    .from(matches)
    .innerJoin(gameTitles, eq(gameTitles.id, matches.gameTitleId))
    .leftJoin(discordPosts, eq(discordPosts.matchId, matches.id))
    .where(
      and(
        eq(gameTitles.isActive, true),
        gt(matches.playedAt, args.since),
        or(
          isNull(discordPosts.matchId),
          and(eq(discordPosts.status, 'failed'), lt(discordPosts.attempts, DISCORD_MAX_ATTEMPTS)),
        ),
        settled,
      ),
    )
    .orderBy(asc(matches.playedAt))
    .limit(args.limit)
}

export async function listDiscordPostCandidates(args: {
  since: Date
  limit: number
}): Promise<number[]> {
  const rows = await discordPostCandidatesQuery({
    ...args,
    unloggedBefore: new Date(Date.now() - DISCORD_UNLOGGED_SETTLE_MS),
  })
  return rows.map((r) => r.matchId)
}

/**
 * Atomically claim a game: insert a pending row, or flip a failed row under
 * the cap back to pending. Returns no row (⇒ false) when the game is pending,
 * posted, skipped, or out of attempts. The ON CONFLICT clauses are raw SQL so
 * the existing-row columns are explicitly qualified.
 */
export function claimDiscordPostQuery(matchId: number) {
  return db
    .insert(discordPosts)
    .values({ matchId, status: 'pending', attempts: 1 })
    .onConflictDoUpdate({
      target: discordPosts.matchId,
      set: {
        status: 'pending',
        attempts: sql`"discord_posts"."attempts" + 1`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`"discord_posts"."status" = 'failed' and "discord_posts"."attempts" < ${sql.raw(String(DISCORD_MAX_ATTEMPTS))}`,
    })
    .returning({ matchId: discordPosts.matchId })
}

export async function claimDiscordPost(matchId: number): Promise<boolean> {
  const rows = await claimDiscordPostQuery(matchId)
  return rows.length > 0
}

export async function markDiscordPostPosted(
  matchId: number,
  messageId: string | null,
): Promise<void> {
  await db
    .update(discordPosts)
    .set({
      status: 'posted',
      discordMessageId: messageId,
      lastError: null,
      postedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(discordPosts.matchId, matchId))
}

export async function markDiscordPostFailed(matchId: number, error: string): Promise<void> {
  await db
    .update(discordPosts)
    .set({ status: 'failed', lastError: error.slice(0, 500), updatedAt: sql`now()` })
    .where(eq(discordPosts.matchId, matchId))
}

export async function markDiscordPostSkipped(matchId: number, reason: string): Promise<void> {
  await db
    .update(discordPosts)
    .set({ status: 'skipped', lastError: reason.slice(0, 500), updatedAt: sql`now()` })
    .where(eq(discordPosts.matchId, matchId))
}

/** Rows left pending since before `olderThan` — a crash mid-post. Logged, never retried. */
export async function listStuckDiscordPosts(olderThan: Date): Promise<number[]> {
  const rows = await db
    .select({ matchId: discordPosts.matchId })
    .from(discordPosts)
    .where(and(eq(discordPosts.status, 'pending'), lt(discordPosts.updatedAt, olderThan)))
  return rows.map((r) => r.matchId)
}
