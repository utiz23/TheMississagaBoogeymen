/**
 * Opponent club metadata ingestion.
 *
 * After matches are ingested, any opponent club IDs that don't have a row in
 * opponent_clubs are fetched from EA clubs/info and stored. This enables
 * opponent logo display on match-facing UI surfaces.
 *
 * We never fetch info for our own club (Boogeymen ID comes from GameTitle.eaClubId).
 * Boogeymen branding is local/manual — EA crest data is for opponents only.
 */

import { db, matches, opponentClubs, type GameTitle } from '@eanhl/db'
import { eq, inArray } from 'drizzle-orm'
import { fetchClubInfo, throttle } from '@eanhl/ea-client'
import type { EaPlatform } from '@eanhl/ea-client'

export async function fetchAndStoreOpponentClubs(title: GameTitle): Promise<void> {
  // Collect all distinct opponent club IDs seen for this game title
  const seenRows = await db
    .selectDistinct({ eaClubId: matches.opponentClubId })
    .from(matches)
    .where(eq(matches.gameTitleId, title.id))

  if (seenRows.length === 0) return

  const seenIds = seenRows.map((r) => r.eaClubId)

  // Find which ones we already have metadata for
  const knownRows = await db
    .select({ eaClubId: opponentClubs.eaClubId })
    .from(opponentClubs)
    .where(inArray(opponentClubs.eaClubId, seenIds))

  const knownIds = new Set(knownRows.map((r) => r.eaClubId))
  const unknownIds = seenIds.filter((id) => !knownIds.has(id))

  if (unknownIds.length === 0) {
    console.log(`[opponents] All opponent clubs already known for ${title.slug}`)
    return
  }

  const now = new Date()
  let upserted = 0

  // EA clubs/info only accepts one club ID per request — fetch one at a time.
  for (const eaClubId of unknownIds) {
    await throttle()

    let response: Awaited<ReturnType<typeof fetchClubInfo>>
    try {
      response = await fetchClubInfo({
        platform: title.eaPlatform as EaPlatform,
        clubId: eaClubId,
        baseUrl: title.apiBaseUrl,
      })
    } catch (err) {
      console.warn(`[opponents] clubs/info fetch failed for ${eaClubId} (${title.slug}):`, err)
      continue
    }

    const clubData = response[eaClubId]
    if (!clubData) {
      console.warn(`[opponents] No club info returned for ${eaClubId} (${title.slug})`)
      continue
    }
    const name = typeof clubData.name === 'string' ? clubData.name : eaClubId
    const crestAssetId = clubData.customKit?.crestAssetId ?? null

    await db
      .insert(opponentClubs)
      .values({ eaClubId, name, crestAssetId, fetchedAt: now })
      .onConflictDoUpdate({
        target: opponentClubs.eaClubId,
        set: { name, crestAssetId, fetchedAt: now },
      })
    upserted++
  }

  console.log(
    `[opponents] ${title.slug}: fetched info for ${String(upserted)}/${String(unknownIds.length)} new opponent clubs`,
  )
}
