import type { CardStat, CardViewModel } from '../../components/cards/card-model.ts'
import type { CardRosterRow, CardSummaryInput } from '../../components/cards/card-adapters.ts'
import { formatSavePct } from '../format.ts'
import type { LineupPositionKey } from '../lineup-shape.ts'

/** One player's box-score line for the game (getPlayerMatchStats row subset). */
export interface GameStatLine {
  playerId: number | null
  gamertag: string
  goals: number
  assists: number
  plusMinus: number
  saves: number | null
  shotsAgainst: number | null
  goalsAgainst: number | null
}

export interface GameCardInput {
  position: LineupPositionKey
  stat: GameStatLine
  /** The player's normal card source (members, AI goalie); null for guests. */
  identity: CardRosterRow | null
  summary: CardSummaryInput | undefined
  /** Jersey from the lineup slot (OCR); falls back to the roster's. */
  jerseyNumber: number | null
  /** Game score (the 3 stars' number); null if the player has none. */
  score: number | null
  /** 1–3 when the player was one of the 3 stars. */
  starRank: number | null
  /**
   * The position tag the card shows, when it differs from the slot: a
   * box-score lineup can't tell LD from RD (EA doesn't), so it shows D, as the
   * match page does. null ⇒ the slot's own tag.
   */
  positionLabel: string | null
}

const ORDINALS = ['1st', '2nd', '3rd']
const signed = (n: number) => (n > 0 ? `+${String(n)}` : String(n))

function gameStats(position: LineupPositionKey, s: GameStatLine): CardStat[] {
  if (position === 'G') {
    // Per field, as the match page: — = not captured, 0 = a real zero. GA is
    // the stored value (AI goalies' saves are derived, so SA − SV can differ).
    const { saves, shotsAgainst, goalsAgainst } = s
    const dash = (n: number | null) => (n === null ? '—' : String(n))
    const savePct =
      saves !== null && shotsAgainst !== null && shotsAgainst > 0
        ? ((saves / shotsAgainst) * 100).toFixed(1)
        : null
    return [
      { label: 'SA', value: dash(shotsAgainst) },
      { label: 'SV', value: dash(saves) },
      { label: 'GA', value: dash(goalsAgainst) },
      // The site's formatter takes a percentage string ("93.9" → ".939").
      { label: 'SV%', value: formatSavePct(savePct) },
    ]
  }
  return [
    { label: 'G', value: String(s.goals) },
    { label: 'A', value: String(s.assists) },
    { label: '+/-', value: signed(s.plusMinus) },
    { label: 'PTS', value: String(s.goals + s.assists) },
  ]
}

/**
 * The player's normal card (theme, tier, badge, name, flag) carrying THIS
 * game's numbers: game score in the record slot, the star tag in the win %
 * slot, per-game stats in the stat row. Pure data — the card component is
 * the site's, unchanged. Guests get a plain Away card.
 */
export function cardForGame(input: GameCardInput): CardViewModel {
  const { identity, summary, stat } = input
  const jerseyNumber = input.jerseyNumber ?? identity?.jerseyNumber ?? null
  const ordinal = input.starRank === null ? undefined : ORDINALS[input.starRank - 1]
  return {
    front: {
      playerId: stat.playerId ?? -1,
      name: identity?.playerName ?? identity?.gamertag ?? stat.gamertag,
      jersey: jerseyNumber === null ? '##' : String(jerseyNumber),
      role: input.position === 'G' ? 'goalie' : 'skater',
      position: input.positionLabel ?? input.position,
      record: input.score === null ? '' : `GS ${input.score.toFixed(2)}`,
      winPct: ordinal === undefined ? '' : `⭐ ${ordinal} star`,
      stats: gameStats(input.position, stat),
      platform: identity?.clientPlatform ?? null,
      nationality: identity?.nationality ?? null,
      tier: summary?.tier ?? 1,
      level: summary?.level ?? 1,
      theme: summary?.theme ?? 'away',
      badge: summary?.bestBadge ?? null,
    },
    back: null,
  }
}

/** Text for an empty slot outline: the position, plus the OCR name if one was seen. */
export function emptySlotLabel(position: string, gamertag: string | null): string {
  return gamertag === null || gamertag === '' ? position : `${position} · ${gamertag}`
}
