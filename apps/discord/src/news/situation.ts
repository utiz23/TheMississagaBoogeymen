import type { NewsFacts, NewsGameFacts } from '@eanhl/db/news'

export type GameSituation =
  | 'ot_win'
  | 'ot_loss'
  | 'blowout_loss'
  | 'goalie_steal'
  | 'quiet_win'
  | 'routine_win'
  | 'loss'

export type NightSituation = 'sweep' | 'winning' | 'even' | 'losing' | 'winless' | 'single'

/** What kind of game it was. Decides which reporters write about it. */
export function classifyGame(g: NewsGameFacts): GameSituation {
  if (g.result === 'OTL' || (g.result === 'LOSS' && g.overtime)) return 'ot_loss'
  if (g.result === 'WIN') {
    if (g.overtime) return 'ot_win'
    if (g.team.shotsAgainst >= g.team.shotsFor + 10) return 'goalie_steal'
    if (g.scoreFor + g.scoreAgainst <= 3) return 'quiet_win'
    return 'routine_win'
  }
  if (g.scoreAgainst - g.scoreFor >= 3) return 'blowout_loss'
  return 'loss'
}

/** What kind of night it was, from the night totals. */
export function classifyNight(f: NewsFacts): NightSituation {
  if (f.games.length === 1) return 'single'
  const { wins, losses, otl } = f.nightTotals
  const notWins = losses + otl
  if (wins > 0 && notWins === 0) return 'sweep'
  if (wins === 0) return 'winless'
  if (wins > notWins) return 'winning'
  if (wins === notWins) return 'even'
  return 'losing'
}
