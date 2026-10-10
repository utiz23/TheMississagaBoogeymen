import { and, asc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../client.js'
import { discordPosts, gameTitles, matches } from '../schema/index.js'

/** A failed post is retried until it has been attempted this many times. */
export const DISCORD_MAX_ATTEMPTS = 3

/**
 * Games the discord service may post: active title, ended after `since`, and
 * either never touched or failed under the attempt cap. `pending`, `posted`
 * and `skipped` rows are never returned. Joined select, so Drizzle qualifies
 * every column (see feedback: unqualified columns in single-table selects).
 */
export function discordPostCandidatesQuery(args: { since: Date; limit: number }) {
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
      ),
    )
    .orderBy(asc(matches.playedAt))
    .limit(args.limit)
}

export async function listDiscordPostCandidates(args: {
  since: Date
  limit: number
}): Promise<number[]> {
  const rows = await discordPostCandidatesQuery(args)
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
