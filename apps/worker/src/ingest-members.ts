/**
 * EA member stats ingestion.
 *
 * Fetches the /members/stats endpoint for a game title, archives the raw response,
 * and upserts transformed rows into ea_member_season_stats.
 *
 * Called at the end of each game title ingestion cycle, after match ingestion and
 * aggregate recomputation.
 *
 * Player resolution:
 *   Each member's gamertag is looked up in the players table. If found, the existing
 *   player_id is used. If not found, a minimal players row + gamertag history row are
 *   inserted so that /roster/[id] links work immediately for members-only players.
 */

import { createHash } from 'node:crypto'
import {
  db,
  rawMemberStatsPayloads,
  eaMemberSeasonStats,
  players,
  playerGamertagHistory,
  playerProfiles,
  type GameTitle,
  type Player,
  type NewPlayer,
} from '@eanhl/db'
import { eq } from 'drizzle-orm'
import { fetchMemberStats, throttle } from '@eanhl/ea-client'
import { transformMemberStats } from './transform-members.js'

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Fetch and store member stats for one game title.
 * Errors are caught and logged — a members fetch failure never aborts match ingestion.
 */
export async function fetchAndStoreMemberStats(title: GameTitle): Promise<void> {
  await throttle()

  const response = await fetchMemberStats({
    platform: title.eaPlatform as Parameters<typeof fetchMemberStats>[0]['platform'],
    clubId: title.eaClubId,
    baseUrl: title.apiBaseUrl,
  })

  const members = response.members ?? []
  if (members.length === 0) {
    console.log(`[members] No members returned for ${title.slug}`)
    return
  }

  // Archive raw response (upsert: one snapshot per game title)
  const payloadStr = JSON.stringify(response)
  const payloadHash = createHash('sha256').update(payloadStr).digest('hex')
  await db
    .insert(rawMemberStatsPayloads)
    .values({
      gameTitleId: title.id,
      payload: response as Record<string, unknown>,
      payloadHash,
    })
    .onConflictDoUpdate({
      target: rawMemberStatsPayloads.gameTitleId,
      set: {
        payload: response as Record<string, unknown>,
        payloadHash,
        fetchedAt: new Date(),
      },
    })

  const now = new Date()
  let upserted = 0

  for (const member of members) {
    if (!member.name) {
      console.warn(`[members] Member without name skipped (${title.slug})`)
      continue
    }

    try {
      const player = await upsertMemberPlayer(member.name, now)
      const statsRow = transformMemberStats(member, title.id, player.id)

      await db
        .insert(eaMemberSeasonStats)
        .values({ ...statsRow, lastFetchedAt: now })
        .onConflictDoUpdate({
          target: [eaMemberSeasonStats.gameTitleId, eaMemberSeasonStats.gamertag],
          set: {
            playerId: statsRow.playerId,
            favoritePosition: statsRow.favoritePosition,
            gamesPlayed: statsRow.gamesPlayed,
            skaterGp: statsRow.skaterGp,
            goals: statsRow.goals,
            assists: statsRow.assists,
            points: statsRow.points,
            pointsPerGame: statsRow.pointsPerGame,
            plusMinus: statsRow.plusMinus,
            pim: statsRow.pim,
            shots: statsRow.shots,
            shotPct: statsRow.shotPct,
            shotAttempts: statsRow.shotAttempts,
            hits: statsRow.hits,
            toiSeconds: statsRow.toiSeconds,
            faceoffPct: statsRow.faceoffPct,
            passPct: statsRow.passPct,
            takeaways: statsRow.takeaways,
            giveaways: statsRow.giveaways,
            goalieGp: statsRow.goalieGp,
            goalieWins: statsRow.goalieWins,
            goalieLosses: statsRow.goalieLosses,
            goalieOtl: statsRow.goalieOtl,
            goalieSavePct: statsRow.goalieSavePct,
            goalieGaa: statsRow.goalieGaa,
            goalieShutouts: statsRow.goalieShutouts,
            goalieSaves: statsRow.goalieSaves,
            goalieShots: statsRow.goalieShots,
            goalieGoalsAgainst: statsRow.goalieGoalsAgainst,
            goalieToiSeconds: statsRow.goalieToiSeconds,
            clientPlatform: statsRow.clientPlatform,
            lastFetchedAt: now,
          },
        })

      upserted++
    } catch (err) {
      console.error(`[members] Failed to upsert member "${member.name}" (${title.slug}):`, err)
    }
  }

  console.log(
    `[members] ${title.slug}: ${String(upserted)}/${String(members.length)} members upserted`,
  )
}

// ─── Player resolution ────────────────────────────────────────────────────────

/**
 * Look up a player by gamertag. If not found, insert a minimal row so that
 * /roster/[id] links work for players who appear in member stats before any match data.
 *
 * Does NOT update players.position — match ingestion owns that column.
 * favoritePosition is stored only in ea_member_season_stats.
 */
async function upsertMemberPlayer(gamertag: string, now: Date): Promise<Player> {
  const existing = await db.select().from(players).where(eq(players.gamertag, gamertag)).limit(1)

  let player: Player
  if (existing.length > 0) {
    const row = existing[0]
    if (!row) throw new Error(`Unexpected missing row for gamertag ${gamertag}`)
    player = row
  } else {
    // New player — minimal insert. position is left null; match ingestion sets it later.
    const values: NewPlayer = {
      eaId: null,
      gamertag,
      position: null,
      firstSeenAt: now,
      lastSeenAt: now,
    }
    const [newPlayer] = await db.insert(players).values(values).returning()
    if (!newPlayer) throw new Error(`Failed to insert player "${gamertag}"`)

    // Open initial gamertag history row.
    await db.insert(playerGamertagHistory).values({
      playerId: newPlayer.id,
      gamertag,
      seenFrom: now,
    })

    console.log(`[members] New player created from members data: "${gamertag}"`)
    player = newPlayer
  }

  // Ensure a profile row exists — mirrors the guarantee in upsertPlayer (ingest.ts).
  // ON CONFLICT DO NOTHING: new player gets an empty row; existing player is untouched.
  await db.insert(playerProfiles).values({ playerId: player.id }).onConflictDoNothing()

  return player
}
