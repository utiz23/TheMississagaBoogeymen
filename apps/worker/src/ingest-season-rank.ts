/**
 * Season rank + settings ingestion.
 *
 * Fetches clubs/seasonRank and settings for a game title, then upserts
 * a single row into club_season_rank (one row per game title).
 *
 * The wins/losses/otl here are SEASON-SPECIFIC (current ranking period) —
 * NOT the all-time official club record (that lives in club_seasonal_stats).
 *
 * Non-fatal: a failure here does not affect match data or player aggregates.
 * All fields from both endpoints are UNVERIFIED — defensive parsing throughout.
 */

import { db, clubSeasonRank, type GameTitle } from '@eanhl/db'
import { fetchSeasonRank, fetchSettings, throttle } from '@eanhl/ea-client'

export async function fetchAndStoreSeasonRank(title: GameTitle): Promise<void> {
  await throttle()

  const rankResponse = await fetchSeasonRank({
    platform: title.eaPlatform as Parameters<typeof fetchSeasonRank>[0]['platform'],
    clubId: title.eaClubId,
    baseUrl: title.apiBaseUrl,
  })

  const entry = rankResponse[title.eaClubId]
  if (!entry) {
    console.warn(`[season-rank] No entry for club ${title.eaClubId} in response (${title.slug})`)
    return
  }

  const currentDivision = parseIntOrNull(entry.currentDivision)

  // Fetch settings to get division thresholds — requires the division number.
  let pointsForPromotion: number | null = null
  let pointsToHoldDivision: number | null = null
  let pointsToTitle: number | null = null
  let divisionName: string | null = null

  if (currentDivision !== null) {
    try {
      await throttle()
      const settingsResponse = await fetchSettings({
        platform: title.eaPlatform as Parameters<typeof fetchSettings>[0]['platform'],
        baseUrl: title.apiBaseUrl,
      })

      const divEntry = settingsResponse[String(currentDivision)]
      if (divEntry) {
        pointsForPromotion = parseIntOrNull(divEntry.pointsForPromotion)
        pointsToHoldDivision = parseIntOrNull(divEntry.pointsToHoldDivision)
        pointsToTitle = parseIntOrNull(divEntry.pointsToTitle)
        divisionName = typeof divEntry.divisionName === 'string' ? divEntry.divisionName : null
      }
    } catch (err) {
      console.warn(`[season-rank] Settings fetch failed — thresholds unavailable:`, err)
    }
  }

  const row = {
    gameTitleId: title.id,
    wins: parseIntOrNull(entry.wins),
    losses: parseIntOrNull(entry.losses),
    otl: parseIntOrNull(entry.otl),
    gamesPlayed: parseIntOrNull(entry.gamesPlayed),
    points: parseIntOrNull(entry.points),
    rankingPoints: parseIntOrNull(entry.rankingPoints),
    projectedPoints: parseIntOrNull(entry.projectedPoints),
    currentDivision,
    divisionName,
    pointsForPromotion,
    pointsToHoldDivision,
    pointsToTitle,
    fetchedAt: new Date(),
  }

  await db
    .insert(clubSeasonRank)
    .values(row)
    .onConflictDoUpdate({
      target: clubSeasonRank.gameTitleId,
      set: {
        wins: row.wins,
        losses: row.losses,
        otl: row.otl,
        gamesPlayed: row.gamesPlayed,
        points: row.points,
        rankingPoints: row.rankingPoints,
        projectedPoints: row.projectedPoints,
        currentDivision: row.currentDivision,
        divisionName: row.divisionName,
        pointsForPromotion: row.pointsForPromotion,
        pointsToHoldDivision: row.pointsToHoldDivision,
        pointsToTitle: row.pointsToTitle,
        fetchedAt: row.fetchedAt,
      },
    })

  const divLabel =
    divisionName ?? (currentDivision !== null ? `Div ${String(currentDivision)}` : '?')
  const pts = row.points !== null ? `${String(row.points)} pts` : '? pts'
  const projected = row.projectedPoints !== null ? ` / ${String(row.projectedPoints)} proj` : ''
  console.log(`[season-rank] ${title.slug}: ${divLabel} · ${pts}${projected}`)
}

function parseIntOrNull(val: string | undefined | null): number | null {
  if (val == null) return null
  const n = parseInt(val, 10)
  return isNaN(n) ? null : n
}
