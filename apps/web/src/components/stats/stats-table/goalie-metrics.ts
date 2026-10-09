import { formatSavePct } from '../../../lib/format.ts'
import { fmtSuppliedDecimal, parseSupplied, ratio } from './format.ts'
import type { Metric, MetricMap } from './metrics.ts'
import { gaaCoverageAnnotation, toiCoverageAnnotation } from './notes.ts'
import type { GoalieDisplayRow as R, GoalieExpanded } from './types.ts'

const D1 = { format: 'd1' } as const

function count(
  key: string,
  label: string,
  full: string,
  get: (r: R) => number | null,
  extra: Partial<Metric<R>> = {},
): Metric<R> {
  return { key, label, full, value: get, format: 'int', ...extra }
}

const ex =
  (k: keyof GoalieExpanded) =>
  (r: R): number | null => {
    const v = r.expanded?.[k]
    return typeof v === 'number' ? v : null
  }
const exPct =
  (k: keyof GoalieExpanded) =>
  (r: R): number | null => {
    const v = r.expanded?.[k]
    return typeof v === 'string' ? parseSupplied(v) : null
  }
const exPctText =
  (k: keyof GoalieExpanded) =>
  (r: R): string => {
    const v = r.expanded?.[k]
    return formatSavePct(typeof v === 'string' ? v : null)
  }

export const GOALIE_METRICS: MetricMap<R> = {
  gp: {
    key: 'gp',
    label: 'GP',
    full: 'Games played in goal',
    value: (r) => r.gamesPlayed,
    format: 'int',
  },
  w: count('w', 'W', 'Wins supplied by this source', (r) => r.wins),
  l: count('l', 'L', 'Losses supplied by this source', (r) => r.losses, { sortAsc: true }),
  otl: count('otl', 'OTL', 'Overtime losses supplied by this source', (r) => r.otl, {
    sortAsc: true,
  }),
  svp: {
    key: 'svp',
    label: 'SV%',
    full: 'Save percentage as supplied by the source',
    value: (r) => parseSupplied(r.savePct),
    format: 'pct1',
    text: (r) => formatSavePct(r.savePct),
  },
  gaa: {
    key: 'gaa',
    label: 'GAA',
    full: 'Goals-against average as supplied by the source. Career rows compute this only from source rows that contain both time on ice and goals against — see the coverage note.',
    value: (r) => parseSupplied(r.gaa),
    format: 'd2',
    text: (r) => fmtSuppliedDecimal(r.gaa),
    sortAsc: true,
    annotate: (r) => gaaCoverageAnnotation(r.gaaCoverage),
  },
  so: count('so', 'SO', 'Shutouts', (r) => r.shutouts),
  sop: count('sop', 'SOP', 'Shutout periods (not the same as shutouts)', ex('shutoutPeriods'), {
    expanded: true,
  }),

  sa: count('sa', 'SA', 'Shots against', (r) => r.totalShotsAgainst, { perGame: D1 }),
  sv: count('sv', 'SV', 'Saves', (r) => r.totalSaves, { perGame: D1 }),
  ga: count('ga', 'GA', 'Goals against', (r) => r.totalGoalsAgainst, { sortAsc: true }),
  dsv: count('dsv', 'DSV', 'Desperation saves', ex('desperationSaves'), {
    perGame: D1,
    expanded: true,
  }),

  brks: count('brks', 'BRKS', 'Breakaway shots faced', ex('breakawayShots'), {
    perGame: D1,
    expanded: true,
  }),
  brksv: count('brksv', 'BRKSV', 'Breakaway saves', ex('breakawaySaves'), {
    perGame: D1,
    expanded: true,
  }),
  brksvp: {
    key: 'brksvp',
    label: 'BRKSV%',
    full: 'Breakaway save percentage, as stored by EA',
    value: exPct('breakawaySavePct'),
    format: 'pct1',
    text: exPctText('breakawaySavePct'),
    expanded: true,
  },
  ps: count('ps', 'PS', 'Penalty shots faced', ex('penaltyShots'), {
    perGame: D1,
    expanded: true,
  }),
  psv: count('psv', 'PSV', 'Penalty-shot saves', ex('penaltyShotSaves'), {
    perGame: D1,
    expanded: true,
  }),
  psvp: {
    key: 'psvp',
    label: 'PSV%',
    full: 'Penalty-shot save percentage, as stored by EA',
    value: exPct('penaltyShotSavePct'),
    format: 'pct1',
    text: exPctText('penaltyShotSavePct'),
    expanded: true,
  },

  pk: count('pk', 'PK', 'Poke checks', ex('pokeChecks'), { perGame: D1, expanded: true }),
  pkzc: count('pkzc', 'PKZC', 'Penalty-kill zone clears', ex('pkClearZone'), {
    perGame: D1,
    expanded: true,
  }),

  toi: {
    key: 'toi',
    label: 'TOI',
    full: 'Total time in net (h:mm:ss). EA reports goalie TOI in whole minutes. Career rows total only the games with recorded time on ice — see the coverage note.',
    value: (r) => r.toiSeconds,
    format: 'hms',
    annotate: (r) => toiCoverageAnnotation(r.toiCoverage),
  },
  toigp: {
    key: 'toigp',
    label: 'TOI/GP',
    full: 'Average time in net per appearance (m:ss). Career rows divide by only the games with recorded time on ice — see the coverage note.',
    // Career rows carry `toiCoverageGp`; every other source leaves it
    // undefined and falls back to total `gamesPlayed`, unchanged from before.
    value: (r) => ratio(r.toiSeconds, r.toiCoverageGp ?? r.gamesPlayed),
    format: 'mmss',
    annotate: (r) => toiCoverageAnnotation(r.toiCoverage),
  },
}
