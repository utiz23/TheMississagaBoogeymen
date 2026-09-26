import { parseSupplied, fmtSuppliedPct, ratio } from './format.ts'
import type { Metric, MetricMap } from './metrics.ts'
import type { SkaterDisplayRow as R, SkaterExpanded } from './types.ts'

const D2 = { format: 'd2' } as const
const HMS_PER_GAME = { format: 'mmss' } as const

function count(
  key: string,
  label: string,
  full: string,
  get: (r: R) => number | null,
  extra: Partial<Metric<R>> = {},
): Metric<R> {
  return { key, label, full, value: get, format: 'int', perGame: D2, ...extra }
}

const ex =
  (k: keyof SkaterExpanded) =>
  (r: R): number | null => {
    const v = r.expanded?.[k]
    return typeof v === 'number' ? v : null
  }
const exPct =
  (k: keyof SkaterExpanded) =>
  (r: R): number | null => {
    const v = r.expanded?.[k]
    return typeof v === 'string' ? parseSupplied(v) : null
  }
const exPctText =
  (k: keyof SkaterExpanded) =>
  (r: R): string => {
    const v = r.expanded?.[k]
    return fmtSuppliedPct(typeof v === 'string' ? v : null)
  }

export const SKATER_METRICS: MetricMap<R> = {
  gp: {
    key: 'gp',
    label: 'GP',
    full: 'Games played as a skater',
    value: (r) => r.gamesPlayed,
    format: 'int',
  },
  g: count('g', 'G', 'Goals', (r) => r.goals),
  a: count('a', 'A', 'Assists', (r) => r.assists),
  pts: count('pts', 'PTS', 'Points (goals + assists)', (r) => r.points),
  pm: {
    key: 'pm',
    label: '+/−',
    full: 'Plus/minus: goal differential while on ice',
    value: (r) => r.plusMinus,
    format: 'signed',
  },
  ppg: count('ppg', 'PPG', 'Power-play goals', ex('powerPlayGoals'), { expanded: true }),
  shg: count('shg', 'SHG', 'Short-handed goals', ex('shortHandedGoals'), { expanded: true }),
  gwg: count('gwg', 'GWG', 'Game-winning goals', ex('gameWinningGoals'), { expanded: true }),
  hat: count('hat', 'HAT', 'Hat tricks', ex('hatTricks'), { expanded: true }),

  sog: count('sog', 'SOG', 'Shots on goal', (r) => r.shots),
  satt: count('satt', 'SATT', 'Shot attempts (goals + missed + blocked)', (r) => r.shotAttempts),
  shp: {
    key: 'shp',
    label: 'S%',
    full: 'Shooting percentage as stored by EA: goals divided by shots on goal',
    value: exPct('shotPct'),
    format: 'pct1',
    text: exPctText('shotPct'),
    expanded: true,
  },
  sonp: {
    key: 'sonp',
    label: 'SOG%',
    full: 'Shots on net divided by shot attempts, as stored by EA',
    value: exPct('shotOnNetPct'),
    format: 'pct1',
    text: exPctText('shotOnNetPct'),
    expanded: true,
  },
  gatt: {
    key: 'gatt',
    label: 'G/SATT%',
    full: 'Goals divided by shot attempts, ×100. Same formula the roster has always shown as SHT%; renamed so it is not confused with EA’s S% (goals ÷ shots on goal).',
    value: (r) => {
      const x = ratio(r.goals, r.shotAttempts)
      return x === null ? null : x * 100
    },
    format: 'pct1',
  },

  pass: count('pass', 'PASS', 'Completed passes', ex('passes'), { expanded: true }),
  patt: count('patt', 'PATT', 'Pass attempts', ex('passAttempts'), { expanded: true }),
  passp: {
    key: 'passp',
    label: 'PASS%',
    full: 'Pass completion percentage',
    value: (r) => parseSupplied(r.passPct),
    format: 'pct1',
    text: (r) => fmtSuppliedPct(r.passPct),
  },
  spass: count('spass', 'SPASS', 'Saucer passes', ex('saucerPasses'), { expanded: true }),

  poss: {
    key: 'poss',
    label: 'POSS',
    full: 'Puck possession time (h:mm:ss total, m:ss per game)',
    value: ex('possessionSeconds'),
    format: 'hms',
    perGame: HMS_PER_GAME,
    expanded: true,
  },
  dka: count('dka', 'DKA', 'Dekes attempted', ex('dekes'), { expanded: true }),
  dk: count('dk', 'DK', 'Dekes completed', ex('dekesMade'), { expanded: true }),
  defl: count('defl', 'DEFL', 'Deflections', ex('deflections'), { expanded: true }),
  gv: count('gv', 'GV', 'Giveaways', (r) => r.giveaways, { sortAsc: true }),
  tagv: {
    key: 'tagv',
    label: 'TA:GV',
    full: 'Takeaway-to-giveaway ratio (higher is better). Unavailable when giveaways are 0.',
    value: (r) => ratio(r.takeaways, r.giveaways),
    format: 'd2',
  },

  fow: count('fow', 'FOW', 'Faceoffs won', ex('faceoffWins'), { expanded: true }),
  fol: count('fol', 'FOL', 'Faceoffs lost', ex('faceoffLosses'), { expanded: true }),
  fo: {
    key: 'fo',
    label: 'FO%',
    full: 'Faceoff win percentage',
    value: (r) => parseSupplied(r.faceoffPct),
    format: 'pct1',
    text: (r) => fmtSuppliedPct(r.faceoffPct),
  },

  hits: count('hits', 'HITS', 'Body checks delivered', (r) => r.hits),
  bs: count('bs', 'BS', 'Blocked shots', ex('blockedShots'), { expanded: true }),
  int: count('int', 'INT', 'Interceptions', ex('interceptions'), { expanded: true }),
  ta: count('ta', 'TA', 'Takeaways: possessions stripped from the opponent', (r) => r.takeaways),
  pkzc: count('pkzc', 'PKZC', 'Penalty-kill zone clears', ex('pkClearZone'), { expanded: true }),

  pim: count('pim', 'PIM', 'Penalty minutes', (r) => r.pim, { sortAsc: true }),
  pd: count('pd', 'PD', 'Penalties drawn', ex('penaltiesDrawn'), { expanded: true }),
  off: count('off', 'OFF', 'Offsides', ex('offsides'), { expanded: true }),
  fht: count('fht', 'FHT', 'Fights', ex('fights'), { expanded: true }),
  fhtw: count('fhtw', 'FHTW', 'Fights won', ex('fightsWon'), { expanded: true }),

  brk: count('brk', 'BRK', 'Breakaway attempts', ex('breakaways'), { expanded: true }),
  brkg: count('brkg', 'BRKG', 'Breakaway goals', ex('breakawayGoals'), { expanded: true }),
  brkp: {
    key: 'brkp',
    label: 'BRK%',
    full: 'Breakaway conversion percentage, as stored by EA',
    value: exPct('breakawayPct'),
    format: 'pct1',
    text: exPctText('breakawayPct'),
    expanded: true,
  },
  ps: count('ps', 'PS', 'Penalty-shot attempts', ex('penaltyShotAttempts'), { expanded: true }),
  psg: count('psg', 'PSG', 'Penalty-shot goals', ex('penaltyShotGoals'), { expanded: true }),
  psp: {
    key: 'psp',
    label: 'PS%',
    full: 'Penalty-shot conversion percentage, as stored by EA',
    value: exPct('penaltyShotPct'),
    format: 'pct1',
    text: exPctText('penaltyShotPct'),
    expanded: true,
  },

  toigp: {
    key: 'toigp',
    label: 'TOI/GP',
    full: 'Average time on ice per game (m:ss). EA reports total TOI in whole minutes, so per-game is approximate.',
    value: (r) => ratio(r.toiSeconds, r.gamesPlayed),
    format: 'mmss',
  },
}
