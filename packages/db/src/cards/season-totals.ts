/**
 * Merges the badge inputs into one season total per (title, player, family).
 *
 * Each NHL title is its own season: a card counts only that title's games
 * (docs/superpowers/specs/2026-10-08-season-cards-design.md). Badges count club
 * games only (docs/superpowers/specs/2026-10-26-club-only-badges-design.md):
 * per-game club totals, site-recorded games per mode, and site-recorded 6s games
 * with a BGM goalie. EA's member totals include drop-in games, so they feed only
 * the three stats the per-game records lack. The loader passes only card titles.
 */
import { emptyBadgeValues, type BadgeValues } from './progression.js'

/** Per-game club totals for one (player, title), summed by the loader. */
export interface ClubTitleTotals {
  playerId: number
  gameTitleId: number
  /** Club games won that the player played, skater or goalie (each game once). */
  wins: number
  goals: number
  assists: number
  shots: number
  /** Games with 3 or more goals. */
  hatTricks: number
  hits: number
  faceoffWins: number
  takeaways: number
  blockedShots: number
  goalieGamesCompleted: number
  goalieWins: number
  goalieSaves: number
  goalieDesperationSaves: number
  goaliePokeChecks: number
  goalieShutouts: number
}

/** EA member totals (drop-ins included) for the stats the per-game records lack. */
export interface EaOnlyTotals {
  playerId: number
  gameTitleId: number
  /** Successful dekes (EA `dekes_made`), not attempts — operator decision 2026-10-07. */
  dekesMade: number
  fightsWon: number
  breakaways: number
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
  club: readonly ClubTitleTotals[]
  eaOnly: readonly EaOnlyTotals[]
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

  for (const r of input.club) {
    const v = totalsFor(r.gameTitleId, r.playerId)
    v.pwins += r.wins
    v.pgoals += r.goals
    v.pasts += r.assists
    v.pshots += r.shots
    v.pht += r.hatTricks
    v.phits += r.hits
    v.pfo += r.faceoffWins
    v.ptka += r.takeaways
    v.pblk += r.blockedShots
    v.gg += r.goalieGamesCompleted
    v.gw += r.goalieWins
    v.gsv += r.goalieSaves
    v.gdsv += r.goalieDesperationSaves
    v.gpoke += r.goaliePokeChecks
    v.gso += r.goalieShutouts
  }

  for (const r of input.eaOnly) {
    const v = totalsFor(r.gameTitleId, r.playerId)
    v.pdekes += r.dekesMade
    v.pfight += r.fightsWon
    v.pbrk += r.breakaways
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
