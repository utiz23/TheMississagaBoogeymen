import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '../client.js'
import {
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
} from '../schema/index.js'

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
      ),
    )
    .orderBy(desc(playerLoadoutSnapshots.capturedAt))
    .limit(limit)

  if (snapshots.length === 0) return []

  const ids = snapshots.map((s) => s.id)

  const xFactorRows = await db
    .select()
    .from(playerLoadoutXFactors)
    .where(sql`${playerLoadoutXFactors.loadoutSnapshotId} IN (${sql.join(ids.map((id) => sql`${id}`), sql`,`)})`)
    .orderBy(asc(playerLoadoutXFactors.loadoutSnapshotId), asc(playerLoadoutXFactors.slotIndex))
  const attributeRows = await db
    .select()
    .from(playerLoadoutAttributes)
    .where(sql`${playerLoadoutAttributes.loadoutSnapshotId} IN (${sql.join(ids.map((id) => sql`${id}`), sql`,`)})`)
    .orderBy(asc(playerLoadoutAttributes.loadoutSnapshotId), asc(playerLoadoutAttributes.attributeKey))

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
