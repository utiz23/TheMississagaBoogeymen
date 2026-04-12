/**
 * Core ingestion cycle.
 *
 * Responsibilities:
 *  - Fetch recent matches from EA API for each active game title + match type
 *  - Store raw payloads (raw-first: store before transform)
 *  - Attempt transform + persist structured data
 *  - Write ingestion_log rows
 *  - Recompute aggregates after each game title
 *
 * All operations are idempotent. Running the same cycle twice is safe.
 */

import { createHash } from 'node:crypto'
import {
  db,
  gameTitles,
  ingestionLog,
  rawMatchPayloads,
  matches,
  players,
  playerGamertagHistory,
  playerMatchStats,
  MATCH_TYPE,
  type GameTitle,
  type Player,
  type NewPlayer,
} from '@eanhl/db'
import { eq, isNull, and } from 'drizzle-orm'
import { fetchMatches, matchesUrl, throttle, EaApiError, type EaMatchType } from '@eanhl/ea-client'
import { transformMatch, type TransformResult, type PlayerIdentity } from './transform.js'
import { recomputeAggregates } from './aggregate.js'

type DbConn = Pick<typeof db, 'select' | 'insert' | 'update'>

// ─── Ingestion cycle ──────────────────────────────────────────────────────────

export async function runIngestionCycle(): Promise<void> {
  const activeGameTitles = await db.select().from(gameTitles).where(eq(gameTitles.isActive, true))

  if (activeGameTitles.length === 0) {
    console.log('[ingest] No active game titles. Skipping cycle.')
    return
  }

  for (const title of activeGameTitles) {
    console.log(`[ingest] Processing game title: ${title.slug}`)
    await ingestGameTitle(title)

    try {
      await recomputeAggregates(title.id)
      console.log(`[ingest] Aggregates recomputed for ${title.slug}`)
    } catch (err) {
      console.error(`[ingest] Aggregate recomputation failed for ${title.slug}:`, err)
    }
  }
}

async function ingestGameTitle(title: GameTitle): Promise<void> {
  for (const matchType of MATCH_TYPE) {
    await ingestMatchType(title, matchType)
    // Throttle between endpoint calls within a cycle.
    await throttle()
  }
}

async function ingestMatchType(title: GameTitle, matchType: EaMatchType): Promise<void> {
  const startedAt = new Date()

  // Create the ingestion log row up front so we can link raw payloads to it.
  const [logRow] = await db
    .insert(ingestionLog)
    .values({
      gameTitleId: title.id,
      startedAt,
      matchType,
      status: 'success', // updated at end of cycle
    })
    .returning()

  if (!logRow) throw new Error('Failed to insert ingestion_log row')

  let matchesFound = 0
  let matchesNew = 0
  let transformsFailed = 0
  let status: 'success' | 'partial' | 'error' = 'success'
  let errorMessage: string | undefined

  try {
    const response = await fetchMatches({
      platform: title.eaPlatform as Parameters<typeof fetchMatches>[0]['platform'],
      clubId: title.eaClubId,
      matchType,
      baseUrl: title.apiBaseUrl,
    })

    matchesFound = response.length
    const sourceEndpoint = matchesUrl({
      platform: title.eaPlatform as Parameters<typeof matchesUrl>[0]['platform'],
      clubId: title.eaClubId,
      matchType,
      baseUrl: title.apiBaseUrl,
    })

    for (const rawMatch of response) {
      const eaMatchId = (rawMatch as { matchId?: string }).matchId
      if (!eaMatchId) {
        console.warn(`[ingest] Match without matchId skipped (${title.slug}/${matchType})`)
        continue
      }

      const payloadStr = JSON.stringify(rawMatch)
      const payloadHash = createHash('sha256').update(payloadStr).digest('hex')

      // Raw-first: insert before transform. ON CONFLICT DO NOTHING = idempotent.
      const inserted = await db
        .insert(rawMatchPayloads)
        .values({
          gameTitleId: title.id,
          eaMatchId,
          matchType,
          sourceEndpoint,
          payload: rawMatch as Record<string, unknown>,
          payloadHash,
          ingestionLogId: logRow.id,
        })
        .onConflictDoNothing()
        .returning()

      if (inserted.length === 0) {
        // Already in DB — skip transform.
        continue
      }

      const rawRow = inserted[0]
      if (!rawRow) throw new Error(`Failed to retrieve inserted raw payload for ${eaMatchId}`)
      matchesNew++

      try {
        const result = transformMatch(rawMatch, title.id, title.eaClubId, matchType)
        await persistTransform(result)
        await db
          .update(rawMatchPayloads)
          .set({ transformStatus: 'success', transformError: null })
          .where(eq(rawMatchPayloads.id, rawRow.id))
      } catch (err) {
        transformsFailed++
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[transform] Failed for match ${eaMatchId} (${title.slug}):`, msg)
        await db
          .update(rawMatchPayloads)
          .set({ transformStatus: 'error', transformError: msg })
          .where(eq(rawMatchPayloads.id, rawRow.id))
      }
    }

    if (transformsFailed > 0) {
      status = transformsFailed === matchesNew ? 'error' : 'partial'
    }
  } catch (err) {
    status = 'error'
    errorMessage = err instanceof Error ? err.message : String(err)
    if (err instanceof EaApiError) {
      console.error(
        `[ingest] EA API error (${title.slug}/${matchType}): ${String(err.status)} ${err.message}`,
      )
    } else {
      console.error(`[ingest] Unexpected error (${title.slug}/${matchType}):`, err)
    }
  }

  await db
    .update(ingestionLog)
    .set({
      finishedAt: new Date(),
      matchesFound,
      matchesNew,
      transformsFailed,
      status,
      errorMessage: errorMessage ?? null,
    })
    .where(eq(ingestionLog.id, logRow.id))

  console.log(
    `[ingest] ${title.slug}/${matchType}: found=${String(matchesFound)} new=${String(matchesNew)} failed=${String(transformsFailed)} status=${status}`,
  )
}

// ─── Persist transform result ─────────────────────────────────────────────────

/**
 * Persist a successful transform: upsert match + player identities + per-game stats.
 * All upserts are idempotent.
 * Exported so reprocess.ts can reuse it.
 */
export async function persistTransform(result: TransformResult): Promise<void> {
  await db.transaction(async (tx) => {
    const dbConn: DbConn = tx
    // Upsert match row. ON CONFLICT (game_title_id, ea_match_id) DO UPDATE.
    const [matchRow] = await dbConn
      .insert(matches)
      .values(result.match)
      .onConflictDoUpdate({
        target: [matches.gameTitleId, matches.eaMatchId],
        set: {
          result: result.match.result,
          scoreFor: result.match.scoreFor,
          scoreAgainst: result.match.scoreAgainst,
          shotsFor: result.match.shotsFor,
          shotsAgainst: result.match.shotsAgainst,
          hitsFor: result.match.hitsFor,
          hitsAgainst: result.match.hitsAgainst,
          faceoffPct: result.match.faceoffPct ?? null,
          timeOnAttack: result.match.timeOnAttack ?? null,
          penaltyMinutes: result.match.penaltyMinutes ?? null,
        },
      })
      .returning()

    if (!matchRow) throw new Error(`Failed to upsert match ${result.eaMatchId}`)

    for (const { identity, stats } of result.players) {
      const player = await upsertPlayer(identity, dbConn)
      await dbConn
        .insert(playerMatchStats)
        .values({ ...stats, playerId: player.id, matchId: matchRow.id })
        .onConflictDoNothing()
    }
  })
}

// ─── Player upsert ────────────────────────────────────────────────────────────

/**
 * Upsert a player by ea_id (primary) or gamertag (fallback if ea_id absent).
 * Tracks gamertag changes via player_gamertag_history.
 * Exported so reprocess.ts can reuse it.
 */
export async function upsertPlayer(
  identity: PlayerIdentity,
  dbConn: DbConn = db,
): Promise<Player> {
  const now = new Date()

  if (identity.eaId) {
    return upsertPlayerByEaId(identity, identity.eaId, now, dbConn)
  }

  // ea_id absent — degraded path. Duplicates are possible if gamertag changes.
  console.warn(`[player] blazeId absent for "${identity.gamertag}" — using gamertag fallback`)
  return upsertPlayerByGamertag(identity, now, dbConn)
}

async function upsertPlayerByEaId(
  identity: PlayerIdentity,
  eaId: string,
  now: Date,
  dbConn: DbConn,
): Promise<Player> {
  const existing = await dbConn.select().from(players).where(eq(players.eaId, eaId)).limit(1)

  if (existing.length > 0) {
    const row = existing[0]
    if (!row) throw new Error(`Unexpected missing row for eaId ${eaId}`)
    if (row.gamertag !== identity.gamertag) {
      await handleGamertagChange(row, identity.gamertag, now, dbConn)
    }
    await dbConn
      .update(players)
      .set({ lastSeenAt: now, position: identity.position ?? row.position })
      .where(eq(players.id, row.id))
    return { ...row, lastSeenAt: now, position: identity.position ?? row.position }
  }

  return insertNewPlayer(identity, now, dbConn)
}

async function upsertPlayerByGamertag(
  identity: PlayerIdentity,
  now: Date,
  dbConn: DbConn,
): Promise<Player> {
  const existing = await dbConn
    .select()
    .from(players)
    .where(eq(players.gamertag, identity.gamertag))
    .limit(1)

  if (existing.length > 0) {
    const row = existing[0]
    if (!row) throw new Error(`Unexpected missing row for gamertag ${identity.gamertag}`)
    await dbConn
      .update(players)
      .set({ lastSeenAt: now, position: identity.position ?? row.position })
      .where(eq(players.id, row.id))
    return { ...row, lastSeenAt: now }
  }

  return insertNewPlayer(identity, now, dbConn)
}

async function insertNewPlayer(
  identity: PlayerIdentity,
  now: Date,
  dbConn: DbConn,
): Promise<Player> {
  const values: NewPlayer = {
    eaId: identity.eaId ?? null,
    gamertag: identity.gamertag,
    position: identity.position ?? null,
    firstSeenAt: now,
    lastSeenAt: now,
  }

  const [newPlayer] = await dbConn.insert(players).values(values).returning()
  if (!newPlayer) throw new Error(`Failed to insert player "${identity.gamertag}"`)

  // Open initial gamertag history row.
  await dbConn.insert(playerGamertagHistory).values({
    playerId: newPlayer.id,
    gamertag: identity.gamertag,
    seenFrom: now,
  })

  return newPlayer
}

/**
 * Close the current open-ended history row and open a new one for the new gamertag.
 * Must run inside the same transaction as the players.gamertag update to avoid
 * a race with the partial unique index on (player_id) WHERE seen_until IS NULL.
 *
 * NOTE: Currently not wrapped in a transaction. At this data volume with a single
 * worker process, the race window is acceptable. Wrap in db.transaction() if the
 * worker ever runs concurrently.
 */
async function handleGamertagChange(
  player: Player,
  newGamertag: string,
  now: Date,
  dbConn: DbConn,
): Promise<void> {
  console.log(
    `[player] Gamertag change: "${player.gamertag}" → "${newGamertag}" (id=${String(player.id)})`,
  )

  // Close current open-ended history row.
  await dbConn
    .update(playerGamertagHistory)
    .set({ seenUntil: now })
    .where(
      and(eq(playerGamertagHistory.playerId, player.id), isNull(playerGamertagHistory.seenUntil)),
    )

  // Update current gamertag.
  await dbConn.update(players).set({ gamertag: newGamertag }).where(eq(players.id, player.id))

  // Open new history row.
  await dbConn.insert(playerGamertagHistory).values({
    playerId: player.id,
    gamertag: newGamertag,
    seenFrom: now,
  })
}
