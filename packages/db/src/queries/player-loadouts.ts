import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { db } from '../client.js'
import {
  gameTitles,
  matches,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
} from '../schema/index.js'
import { groupBuilds, type LoadoutSheet, type PlayerBuild } from '../loadouts/build-runs.js'

export type { LoadoutXFactor, PlayerBuild } from '../loadouts/build-runs.js'

/**
 * Reviewed loadout snapshots for a player, newest captured first.
 * Each snapshot includes its X-factors (up to 3) and all attributes (~23).
 */
export async function getPlayerLoadoutSnapshots(playerId: number, limit = 20) {
  const snapshots = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(
      and(
        eq(playerLoadoutSnapshots.playerId, playerId),
        eq(playerLoadoutSnapshots.reviewStatus, 'reviewed'),
        // Defense-in-depth: CPU placeholder rows always have player_id=null
        // (the lobby-v2 promoter never assigns them to a real player), so
        // they would never match the playerId filter above. Explicit filter
        // documents the intent and protects against future code paths that
        // might write is_cpu=true rows with a non-null player_id.
        eq(playerLoadoutSnapshots.isCpu, false),
      ),
    )
    .orderBy(desc(playerLoadoutSnapshots.capturedAt))
    .limit(limit)

  if (snapshots.length === 0) return []

  const ids = snapshots.map((s) => s.id)

  const xFactorRows = await db
    .select()
    .from(playerLoadoutXFactors)
    .where(
      sql`${playerLoadoutXFactors.loadoutSnapshotId} IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`,`,
      )})`,
    )
    .orderBy(asc(playerLoadoutXFactors.loadoutSnapshotId), asc(playerLoadoutXFactors.slotIndex))
  const attributeRows = await db
    .select()
    .from(playerLoadoutAttributes)
    .where(
      sql`${playerLoadoutAttributes.loadoutSnapshotId} IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`,`,
      )})`,
    )
    .orderBy(
      asc(playerLoadoutAttributes.loadoutSnapshotId),
      asc(playerLoadoutAttributes.attributeKey),
    )

  const xByOwner = new Map<number, typeof xFactorRows>()
  for (const x of xFactorRows) {
    const list = xByOwner.get(x.loadoutSnapshotId) ?? []
    list.push(x)
    xByOwner.set(x.loadoutSnapshotId, list)
  }
  const aByOwner = new Map<number, typeof attributeRows>()
  for (const a of attributeRows) {
    const list = aByOwner.get(a.loadoutSnapshotId) ?? []
    list.push(a)
    aByOwner.set(a.loadoutSnapshotId, list)
  }

  return snapshots.map((s) => ({
    ...s,
    xFactors: xByOwner.get(s.id) ?? [],
    attributes: aByOwner.get(s.id) ?? [],
  }))
}

export type PlayerLoadoutSnapshotWithDetails = Awaited<
  ReturnType<typeof getPlayerLoadoutSnapshots>
>[number]

export interface PlayerBuilds {
  gameTitleId: number
  gameTitleName: string
  /** Newest first, at most `limit`. */
  builds: PlayerBuild[]
  /** The build before the oldest shown one (its Δ baseline), or null. */
  older: PlayerBuild | null
}

/** Reviewed, human, match-linked snapshots of one player (the Build Locker's gate). */
const gatedSheets = (playerId: number) =>
  and(
    eq(playerLoadoutSnapshots.playerId, playerId),
    eq(playerLoadoutSnapshots.reviewStatus, 'reviewed'),
    eq(playerLoadoutSnapshots.isCpu, false),
    isNotNull(playerLoadoutSnapshots.matchId),
  )

/**
 * The player's builds (spec Part 4) in the newest game title they have
 * reviewed game sheets for (operator, 2026-10-07: NHL 26 until NHL 27 sheets
 * are reviewed). Null when the player has none.
 */
export async function getPlayerBuilds(playerId: number, limit = 4): Promise<PlayerBuilds | null> {
  const [latest] = await db
    .select({ gameTitleId: playerLoadoutSnapshots.gameTitleId, name: gameTitles.name })
    .from(playerLoadoutSnapshots)
    .innerJoin(matches, eq(matches.id, playerLoadoutSnapshots.matchId))
    .innerJoin(gameTitles, eq(gameTitles.id, playerLoadoutSnapshots.gameTitleId))
    .where(gatedSheets(playerId))
    .orderBy(desc(matches.playedAt))
    .limit(1)
  if (latest === undefined) return null

  const rows = await db
    .select({
      snapshot: playerLoadoutSnapshots,
      playedAt: matches.playedAt,
      result: matches.result,
    })
    .from(playerLoadoutSnapshots)
    .innerJoin(matches, eq(matches.id, playerLoadoutSnapshots.matchId))
    .where(and(gatedSheets(playerId), eq(playerLoadoutSnapshots.gameTitleId, latest.gameTitleId)))
  const ids = rows.map((r) => r.snapshot.id)
  const [xRows, aRows] = await Promise.all([
    db
      .select()
      .from(playerLoadoutXFactors)
      .where(inArray(playerLoadoutXFactors.loadoutSnapshotId, ids))
      .orderBy(asc(playerLoadoutXFactors.slotIndex)),
    db
      .select()
      .from(playerLoadoutAttributes)
      .where(inArray(playerLoadoutAttributes.loadoutSnapshotId, ids)),
  ])

  const sheets: LoadoutSheet[] = rows.map(({ snapshot: s, playedAt, result }) => {
    const attributes: Record<string, number | null> = {}
    for (const a of aRows) if (a.loadoutSnapshotId === s.id) attributes[a.attributeKey] = a.value
    return {
      snapshotId: s.id,
      matchId: s.matchId ?? 0,
      playedAt,
      capturedAt: s.capturedAt,
      result,
      archetype: s.buildClassCanonical ?? s.buildClass,
      heightText: s.heightText,
      weightLbs: s.weightLbs,
      handedness: s.handedness,
      xFactors: xRows
        .filter((x) => x.loadoutSnapshotId === s.id)
        .map((x) => ({ name: x.xFactorNameCanonical ?? x.xFactorName, tier: x.tier ?? null })),
      attributes,
    }
  })
  const all = groupBuilds(sheets)
  return {
    gameTitleId: latest.gameTitleId,
    gameTitleName: latest.name,
    builds: all.slice(0, limit),
    older: all[limit] ?? null,
  }
}
