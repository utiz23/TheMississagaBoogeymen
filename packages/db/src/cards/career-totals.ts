/**
 * Merges the badge inputs into one career total per player and family.
 *
 * Sources (spec Part 1): EA season totals per title, reviewed NHL 22–25
 * history per title, site-recorded games per mode, and site-recorded 6s games
 * with a BGM goalie. One source per (player, title): when EA has a row for a
 * title, that title's history rows are ignored, so nothing is counted twice.
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
  dekes: number
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

export interface HistoryTitleTotals {
  playerId: number
  gameTitleId: number
  gameMode: string
  gamesPlayed: number
  wins: number
  goals: number
  assists: number
  shots: number
  hits: number
  takeaways: number
  blockedShots: number
  saves: number
  shutouts: number
}

export interface RecordedModeGames {
  playerId: number
  gameMode: string
  gamesPlayed: number
}

export interface RecordedSixesWithGoalie {
  playerId: number
  games: number
}

export interface CareerTotalsInput {
  ea: readonly EaTitleTotals[]
  history: readonly HistoryTitleTotals[]
  recordedModes: readonly RecordedModeGames[]
  recordedSixesWithGoalie: readonly RecordedSixesWithGoalie[]
}

export function mergeCareerTotals(input: CareerTotalsInput): Map<number, BadgeValues> {
  const out = new Map<number, BadgeValues>()
  const totalsFor = (playerId: number): BadgeValues => {
    let v = out.get(playerId)
    if (v === undefined) {
      v = emptyBadgeValues()
      out.set(playerId, v)
    }
    return v
  }

  const eaTitles = new Set<string>()
  for (const r of input.ea) {
    eaTitles.add(`${String(r.playerId)}:${String(r.gameTitleId)}`)
    const v = totalsFor(r.playerId)
    v.pwins += r.skaterWins + r.goalieWins
    v.pgoals += r.goals
    v.pasts += r.assists
    v.pshots += r.shots
    v.pdekes += r.dekes
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

  for (const r of input.history) {
    if (eaTitles.has(`${String(r.playerId)}:${String(r.gameTitleId)}`)) continue
    const v = totalsFor(r.playerId)
    if (r.gameMode === '6s') v.p6v6 += r.gamesPlayed
    v.pwins += r.wins
    v.pgoals += r.goals
    v.pasts += r.assists
    v.pshots += r.shots
    v.phits += r.hits
    v.ptka += r.takeaways
    v.pblk += r.blockedShots
    v.gsv += r.saves
    v.gso += r.shutouts
  }

  for (const r of input.recordedModes) {
    const v = totalsFor(r.playerId)
    if (r.gameMode === '3s') v.p3v3 += r.gamesPlayed
    else if (r.gameMode === '6s') v.p6v6 += r.gamesPlayed
  }

  for (const r of input.recordedSixesWithGoalie) {
    totalsFor(r.playerId).p6g += r.games
  }

  return out
}
