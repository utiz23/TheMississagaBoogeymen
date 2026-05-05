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
  clubSeasonalStats,
  players,
  playerGamertagHistory,
  playerProfiles,
  type GameTitle,
  type Player,
  type NewPlayer,
} from '@eanhl/db'
import { eq } from 'drizzle-orm'
import { fetchMemberStats, fetchSeasonalStats, throttle } from '@eanhl/ea-client'
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
          set: { ...statsRow, lastFetchedAt: now },
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

// ─── Official club record ─────────────────────────────────────────────────────

/**
 * Fetch and store the official EA club record from clubs/seasonalStats.
 * Upserts one row per game title. Non-fatal on failure.
 */
export async function fetchAndStoreSeasonalStats(title: GameTitle): Promise<void> {
  await throttle()

  const response = await fetchSeasonalStats({
    platform: title.eaPlatform as Parameters<typeof fetchSeasonalStats>[0]['platform'],
    clubId: title.eaClubId,
    baseUrl: title.apiBaseUrl,
  })

  // Response is an array; find our club by clubId field.
  const clubData = response.find((entry) => entry.clubId === title.eaClubId)
  if (!clubData) {
    console.warn(`[seasonal] No data for club ${title.eaClubId} in response (${title.slug})`)
    return
  }

  const wins = parseInt(clubData.wins ?? '', 10)
  const losses = parseInt(clubData.losses ?? '', 10)
  const otl = parseInt(clubData.otl ?? '', 10)

  if (isNaN(wins) || isNaN(losses) || isNaN(otl)) {
    console.warn(`[seasonal] Could not parse W/L/OTL for ${title.slug}`)
    return
  }

  const rankingPoints = parseInt(clubData.rankingPoints ?? '', 10)
  const goals = parseInt(clubData.goals ?? '', 10)
  const goalsAgainst = parseInt(clubData.goalsAgainst ?? '', 10)

  const row = {
    gameTitleId: title.id,
    wins,
    losses,
    otl,
    gamesPlayed: wins + losses + otl,
    record: clubData.record ?? null,
    rankingPoints: isNaN(rankingPoints) ? null : rankingPoints,
    goals: isNaN(goals) ? null : goals,
    goalsAgainst: isNaN(goalsAgainst) ? null : goalsAgainst,
    fetchedAt: new Date(),
  }

  await db
    .insert(clubSeasonalStats)
    .values(row)
    .onConflictDoUpdate({
      target: clubSeasonalStats.gameTitleId,
      set: {
        wins: row.wins,
        losses: row.losses,
        otl: row.otl,
        gamesPlayed: row.gamesPlayed,
        record: row.record,
        rankingPoints: row.rankingPoints,
        goals: row.goals,
        goalsAgainst: row.goalsAgainst,
        fetchedAt: row.fetchedAt,
      },
    })

  console.log(
    `[seasonal] ${title.slug}: ${row.record ?? `${String(wins)}-${String(losses)}-${String(otl)}`} (${isNaN(rankingPoints) ? '?' : String(rankingPoints)} pts)`,
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
