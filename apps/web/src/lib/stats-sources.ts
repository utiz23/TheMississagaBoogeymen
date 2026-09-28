import type { GameMode } from '@eanhl/db'
import type { StatsSource } from '@/components/stats/stats-table/types'

/**
 * Shared `StatsSource` definitions for the player-stat tables on `/roster`
 * and `/stats`. Extracted from `/roster` (the original owner of these
 * definitions) so the two pages describe the same sources with identical
 * wording instead of maintaining separate copies that could drift apart.
 * Sources are never merged — each kind stays visibly distinct in the table.
 */

/** Active-title live source: EA season totals (All mode) or locally tracked matches (6s/3s). */
export function liveSource(gameMode: GameMode | null): StatsSource {
  return gameMode === null
    ? {
        kind: 'ea-season',
        label: 'EA season totals',
        description: 'Official EA club-member totals. Includes games not captured locally.',
      }
    : {
        kind: 'local-tracked',
        label: `Local tracked ${gameMode}`,
        description: `Only ${gameMode} matches captured here, so totals can be far smaller than EA season totals. Choose All for those.`,
      }
}

/** All Time (career) source, assembled across titles and precedence-filtered source rows. */
export function careerSource(label: string): StatsSource {
  return {
    kind: 'career',
    label,
    description:
      'EA season totals plus reviewed player-card history, which can include other clubs. Title and mode filters do not apply.',
  }
}

/**
 * Archive club-member source: club-scoped totals from reviewed CLUBS →
 * MEMBERS screen captures. Distinct from `ARCHIVE_PLAYER_CARD_SOURCE` — never
 * identify one as the other, since club-member totals are scoped to this
 * club only while player-card totals may include other clubs.
 */
export const ARCHIVE_CLUB_MEMBER_SOURCE: StatsSource = {
  kind: 'archive-club-member',
  label: 'Club-member totals (reviewed screenshot import)',
  description: 'Club-scoped, from reviewed CLUBS → MEMBERS captures.',
}

/**
 * Archive player-card source: reviewed per-player season-totals screen
 * captures. May include games the player played for other clubs in the same
 * title — distinct from the club-scoped `ARCHIVE_CLUB_MEMBER_SOURCE`.
 */
export const ARCHIVE_PLAYER_CARD_SOURCE: StatsSource = {
  kind: 'archive-player-card',
  label: 'Player-card totals (reviewed screenshot import)',
  description: 'Reviewed player-card season totals — may include games for other clubs.',
}
