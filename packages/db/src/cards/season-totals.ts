/**
 * Merges the badge inputs into one season total per (title, player, family).
 *
 * Each NHL title is its own season: a card counts only that title's games
 * (docs/superpowers/specs/2026-10-08-season-cards-design.md). Sources: the EA
 * season totals for the title, site-recorded games per mode, and site-recorded
 * 6s games with a BGM goalie. The loader passes only card titles.
 */
import { emptyBadgeValues, type BadgeValues } from './progression.js'

export interface EaTitleTotals {
  playerId: number
  gameTitleId: number
  skaterWins: number
  goalieWins: number
  goals: number
  assists: number
  shots: number
  /** Successful dekes (EA `dekes_made`), not attempts — operator decision 2026-10-07. */
  dekesMade: number
  hatTricks: number
  breakaways: number
  hits: number
  faceoffWins: number
  takeaways: number
  blockedShots: number
  fightsWon: number
  goalieGamesCompleted: number
  goalieSaves: number
  goalieDesperationSaves: number
  goaliePokeChecks: number
  goalieShutouts: number
}

export interface RecordedModeGames {
  playerId: number
  gameTitleId: number
  gameMode: string
  gamesPlayed: number
}

export interface RecordedSixesWithGoalie {
  playerId: number
  gameTitleId: number
  games: number
}

export interface SeasonTotalsInput {
  ea: readonly EaTitleTotals[]
  recordedModes: readonly RecordedModeGames[]
  recordedSixesWithGoalie: readonly RecordedSixesWithGoalie[]
}

/** Season totals: game title id → player id → badge values. */
export type SeasonTotals = Map<number, Map<number, BadgeValues>>

export function mergeSeasonTotals(input: SeasonTotalsInput): SeasonTotals {
  const out: SeasonTotals = new Map()
  const totalsFor = (gameTitleId: number, playerId: number): BadgeValues => {
    let title = out.get(gameTitleId)
    if (title === undefined) {
      title = new Map()
      out.set(gameTitleId, title)
    }
    let v = title.get(playerId)
    if (v === undefined) {
      v = emptyBadgeValues()
      title.set(playerId, v)
    }
    return v
  }

  for (const r of input.ea) {
    const v = totalsFor(r.gameTitleId, r.playerId)
    v.pwins += r.skaterWins + r.goalieWins
    v.pgoals += r.goals
    v.pasts += r.assists
    v.pshots += r.shots
    v.pdekes += r.dekesMade
    v.pht += r.hatTricks
    v.pbrk += r.breakaways
    v.phits += r.hits
    v.pfo += r.faceoffWins
    v.ptka += r.takeaways
    v.pblk += r.blockedShots
    v.pfight += r.fightsWon
    v.gg += r.goalieGamesCompleted
    v.gw += r.goalieWins
    v.gsv += r.goalieSaves
    v.gdsv += r.goalieDesperationSaves
    v.gpoke += r.goaliePokeChecks
    v.gso += r.goalieShutouts
  }

  for (const r of input.recordedModes) {
    const v = totalsFor(r.gameTitleId, r.playerId)
    if (r.gameMode === '3s') v.p3v3 += r.gamesPlayed
    else if (r.gameMode === '6s') v.p6v6 += r.gamesPlayed
  }

  for (const r of input.recordedSixesWithGoalie) {
    totalsFor(r.gameTitleId, r.playerId).p6g += r.games
  }

  return out
}
