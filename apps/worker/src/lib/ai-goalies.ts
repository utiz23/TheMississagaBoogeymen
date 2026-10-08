/**
 * EASHL AI goaltenders — pure rules (spec docs/superpowers/specs/2026-10-08-ai-goalies-design.md).
 *
 * In a game with no human BGM goalie, EA's AI goalie plays: Matteo Lehmann
 * when BGM is the home side, Jonas Wagner when away. EA reports no stats for
 * them, so each game's line comes from the team totals: shots against, goals
 * against, result. A game whose side is unknown alternates by match id, so
 * each goalie gets about half of those.
 */

export type AiGoalieSide = 'home' | 'away'

export interface AiGameInput {
  matchId: number
  bgmWasHome: boolean | null
  shotsAgainst: number
  scoreAgainst: number
  result: 'WIN' | 'LOSS' | 'OTL' | 'DNF'
  /** Longest BGM TOI in the game (periods played); null when unknown. */
  toiSeconds: number | null
}

export interface AiGoalieGameLine {
  matchId: number
  side: AiGoalieSide
  /** EA team side: 0 = home, 1 = away. */
  teamSide: 0 | 1
  shotsAgainst: number
  goalsAgainst: number
  saves: number
  toiSeconds: number | null
  result: AiGameInput['result']
}

export function aiGoalieSide(game: Pick<AiGameInput, 'matchId' | 'bgmWasHome'>): AiGoalieSide {
  if (game.bgmWasHome === true) return 'home'
  if (game.bgmWasHome === false) return 'away'
  return game.matchId % 2 === 0 ? 'home' : 'away'
}

/** One AI goalie line per game. Saves never go below 0 (a few EA rows have shots < goals). */
export function planAiGoalieLines(games: readonly AiGameInput[]): AiGoalieGameLine[] {
  return games.map((g) => {
    const side = aiGoalieSide(g)
    return {
      matchId: g.matchId,
      side,
      teamSide: side === 'home' ? 0 : 1,
      shotsAgainst: g.shotsAgainst,
      goalsAgainst: g.scoreAgainst,
      saves: Math.max(0, g.shotsAgainst - g.scoreAgainst),
      toiSeconds: g.toiSeconds,
      result: g.result,
    }
  })
}

export interface AiGoalieSeasonTotals {
  gamesPlayed: number
  gamesCompleted: number
  dnf: number
  wins: number
  losses: number
  otl: number
  shots: number
  saves: number
  goalsAgainst: number
  shutouts: number
  toiSeconds: number | null
  /** numeric(5,2) as text, null without shots. */
  savePct: string | null
  /** numeric(4,2) as text, null without TOI. */
  gaa: string | null
  winPct: string | null
}

/** Season totals for one goalie's lines. A DNF counts as a game played but not completed. */
export function aiGoalieSeasonTotals(lines: readonly AiGoalieGameLine[]): AiGoalieSeasonTotals {
  const sum = (pick: (l: AiGoalieGameLine) => number) => lines.reduce((s, l) => s + pick(l), 0)
  const count = (r: AiGameInput['result']) => lines.filter((l) => l.result === r).length
  const shots = sum((l) => l.shotsAgainst)
  const saves = sum((l) => l.saves)
  const goalsAgainst = sum((l) => l.goalsAgainst)
  const timed = lines.filter((l) => l.toiSeconds !== null && l.toiSeconds > 0)
  const toi = timed.reduce((s, l) => s + (l.toiSeconds ?? 0), 0)
  const timedGa = timed.reduce((s, l) => s + l.goalsAgainst, 0)
  const wins = count('WIN')
  const decided = wins + count('LOSS') + count('OTL')
  return {
    gamesPlayed: lines.length,
    gamesCompleted: lines.length - count('DNF'),
    dnf: count('DNF'),
    wins,
    losses: count('LOSS'),
    otl: count('OTL'),
    shots,
    saves,
    goalsAgainst,
    shutouts: lines.filter((l) => l.result !== 'DNF' && l.goalsAgainst === 0).length,
    toiSeconds: timed.length > 0 ? toi : null,
    savePct: shots > 0 ? ((saves / shots) * 100).toFixed(2) : null,
    gaa: toi > 0 ? ((timedGa / toi) * 3600).toFixed(2) : null,
    winPct: decided > 0 ? ((wins / decided) * 100).toFixed(2) : null,
  }
}
