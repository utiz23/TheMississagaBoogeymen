/**
 * Club-vote trophies and championship banners — the awards stats can't
 * produce. Stored in the database since migration 0066 and edited on
 * /admin/awards (they used to be a hand-edited list in this file). `playerIds` are
 * `players.id` (stable across gamertag changes); `title` is the game title's
 * display name. A trophy is either a real club vote (`from: 'vote'`) or, for
 * seasons with no vote on record, picked from the archive stats
 * (`from: 'stats'`, with the reason shown on the page).
 */

import type { ClubAwardRecord } from '@eanhl/db/queries'

export type VotedTrophy = 'mvp' | 'defense' | 'rookie'
export type BannerMode = '3s' | '6s' | 'arcade'

export type ClubAward =
  | {
      kind: 'trophy'
      trophy: VotedTrophy
      title: string
      playerIds: readonly number[]
      from: 'vote'
    }
  | {
      kind: 'trophy'
      trophy: VotedTrophy
      title: string
      playerIds: readonly number[]
      from: 'stats'
      reason: string
    }
  | { kind: 'banner'; mode: BannerMode; title: string; playerIds: readonly number[] }

/** A stored award (migration 0066) in the shape the awards model takes. */
export function toClubAward(record: ClubAwardRecord): ClubAward {
  if (record.kind === 'banner') {
    return {
      kind: 'banner',
      mode: record.mode,
      title: record.titleName,
      playerIds: record.playerIds,
    }
  }
  const base = {
    kind: 'trophy' as const,
    trophy: record.trophy,
    title: record.titleName,
    playerIds: record.playerIds,
  }
  return record.source === 'stats'
    ? { ...base, from: 'stats', reason: record.reason ?? '' }
    : { ...base, from: 'vote' }
}
