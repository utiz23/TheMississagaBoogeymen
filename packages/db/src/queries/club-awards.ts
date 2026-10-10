import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '../client.js'
import { clubAwardPlayers, clubAwards, gameTitles } from '../schema/index.js'

/** One hand-entered award as stored (migration 0066). */
export type ClubAwardRecord =
  | {
      id: number
      kind: 'trophy'
      trophy: 'mvp' | 'defense' | 'rookie'
      gameTitleId: number
      titleName: string
      source: 'vote' | 'stats'
      /** Shown on the page for a 'stats' trophy; null for a vote. */
      reason: string | null
      playerIds: number[]
    }
  | {
      id: number
      kind: 'banner'
      mode: '3s' | '6s' | 'arcade'
      gameTitleId: number
      titleName: string
      playerIds: number[]
    }

/** What the admin form saves (no id). The caller validates it. */
export type ClubAwardInput =
  | {
      kind: 'trophy'
      trophy: 'mvp' | 'defense' | 'rookie'
      gameTitleId: number
      source: 'vote' | 'stats'
      reason: string | null
      playerIds: number[]
    }
  | { kind: 'banner'; mode: '3s' | '6s' | 'arcade'; gameTitleId: number; playerIds: number[] }

/** Every award in entry order, with its title name and players in display order. */
export async function listClubAwards(): Promise<ClubAwardRecord[]> {
  const awards = await db
    .select({
      id: clubAwards.id,
      kind: clubAwards.kind,
      trophy: clubAwards.trophy,
      mode: clubAwards.mode,
      gameTitleId: clubAwards.gameTitleId,
      titleName: gameTitles.name,
      source: clubAwards.source,
      reason: clubAwards.reason,
    })
    .from(clubAwards)
    .innerJoin(gameTitles, eq(gameTitles.id, clubAwards.gameTitleId))
    .orderBy(asc(clubAwards.id))
  if (awards.length === 0) return []
  const who = await db
    .select()
    .from(clubAwardPlayers)
    .where(
      inArray(
        clubAwardPlayers.awardId,
        awards.map((a) => a.id),
      ),
    )
    .orderBy(asc(clubAwardPlayers.awardId), asc(clubAwardPlayers.position))
  const playersOf = (id: number) => who.filter((w) => w.awardId === id).map((w) => w.playerId)
  return awards.flatMap((a): ClubAwardRecord[] => {
    const base = {
      id: a.id,
      gameTitleId: a.gameTitleId,
      titleName: a.titleName,
      playerIds: playersOf(a.id),
    }
    if (a.kind === 'trophy' && a.trophy !== null && a.source !== null) {
      return [{ ...base, kind: 'trophy', trophy: a.trophy, source: a.source, reason: a.reason }]
    }
    if (a.kind === 'banner' && a.mode !== null) return [{ ...base, kind: 'banner', mode: a.mode }]
    return []
  })
}

function columnsOf(input: ClubAwardInput) {
  return input.kind === 'trophy'
    ? {
        kind: 'trophy' as const,
        trophy: input.trophy,
        mode: null,
        gameTitleId: input.gameTitleId,
        source: input.source,
        reason: input.source === 'stats' ? input.reason : null,
      }
    : {
        kind: 'banner' as const,
        trophy: null,
        mode: input.mode,
        gameTitleId: input.gameTitleId,
        source: null,
        reason: null,
      }
}

async function writePlayers(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  awardId: number,
  playerIds: readonly number[],
) {
  await tx.delete(clubAwardPlayers).where(eq(clubAwardPlayers.awardId, awardId))
  const unique = [...new Set(playerIds)]
  if (unique.length > 0) {
    await tx
      .insert(clubAwardPlayers)
      .values(unique.map((playerId, i) => ({ awardId, playerId, position: i + 1 })))
  }
}

/** Add an award and its players in one transaction. Returns the new id. */
export async function createClubAward(input: ClubAwardInput): Promise<number> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(clubAwards)
      .values(columnsOf(input))
      .returning({ id: clubAwards.id })
    await writePlayers(tx, row!.id, input.playerIds)
    return row!.id
  })
}

/** Replace an award's fields and players in one transaction. False if it doesn't exist. */
export async function updateClubAward(id: number, input: ClubAwardInput): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(clubAwards)
      .set({ ...columnsOf(input), updatedAt: new Date() })
      .where(eq(clubAwards.id, id))
      .returning({ id: clubAwards.id })
    if (updated.length === 0) return false
    await writePlayers(tx, id, input.playerIds)
    return true
  })
}

/** Remove an award (its player rows cascade). */
export async function deleteClubAward(id: number): Promise<void> {
  await db.delete(clubAwards).where(eq(clubAwards.id, id))
}
