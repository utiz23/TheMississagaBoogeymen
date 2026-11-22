// Data for the temporary /game-score explainer page (task
// docs/tasks/2026-11-21-web-game-score-page.md).
//
// Every number the page shows comes from the real score functions in
// match-recap.ts, so the page can never disagree with the game page.
// Only the words (groups, notes) live here.

import {
  GOALIE_FULL_WEIGHT_SHOTS,
  STAR_MIN_GOALIE_SV_PCT,
  goalieBreakdown,
  skaterBreakdown,
  type GoalieScoreInput,
  type ScoreFactor,
  type SkaterScoreInput,
} from './match-recap.ts'

export { GOALIE_FULL_WEIGHT_SHOTS, STAR_MIN_GOALIE_SV_PCT }

/** The win bonus every player on the winning side gets (match-recap `toEntry`). */
export const WIN_BONUS_POINTS = 1.0

export const ZERO_SKATER: SkaterScoreInput = {
  goals: 0,
  assists: 0,
  plusMinus: 0,
  shots: 0,
  hits: 0,
  interceptions: 0,
  blockedShots: 0,
  takeaways: 0,
  giveaways: 0,
  faceoffWins: 0,
  faceoffLosses: 0,
  penaltiesDrawn: 0,
  pim: 0,
}

export const ZERO_GOALIE: GoalieScoreInput = {
  saves: 0,
  goalsAgainst: 0,
  shotsAgainst: 0,
  despSaves: 0,
  breakawaySaves: 0,
  penSaves: 0,
  pokechecks: 0,
}

// ─── Weight tables ────────────────────────────────────────────────────────────

export interface WeightRow {
  label: string
  weight: number
  note: string
}

export interface WeightGroup {
  group: string
  rows: WeightRow[]
}

/** Plain-words names and notes, keyed by the factor label in match-recap. */
const SKATER_WORDS: Record<string, { group: string; label: string; note: string }> = {
  Goals: { group: 'Goals', label: 'Goal', note: 'The main driver' },
  Assists: { group: 'Goals', label: 'Assist', note: 'Almost a goal' },
  Takeaways: { group: 'Winning the puck', label: 'Takeaway', note: 'Stealing the puck' },
  Interceptions: { group: 'Winning the puck', label: 'Interception', note: 'Reading the play' },
  'Blocked Shots': { group: 'Winning the puck', label: 'Blocked shot', note: 'Paying the price' },
  'Penalties Drawn': {
    group: 'Winning the puck',
    label: 'Penalty drawn',
    note: 'A power play for us',
  },
  Giveaways: { group: 'Mistakes', label: 'Giveaway', note: 'Handing the puck over' },
  'Penalty Min': {
    group: 'Mistakes',
    label: 'Penalty minute',
    note: 'A 2-minute minor = 2 of these',
  },
  Shots: { group: 'Small extras', label: 'Shot on goal', note: 'Volume, lightly' },
  '+/-': { group: 'Small extras', label: 'Plus / minus (each +1)', note: 'Mostly a line stat' },
  Hits: { group: 'Small extras', label: 'Hit', note: 'Physical play, lightly' },
  'FO Net': {
    group: 'Small extras',
    label: 'Faceoff (wins − losses)',
    note: 'Net only: 12 won, 10 lost = +2',
  },
}

const GOALIE_WORDS: Record<string, { label: string; note: string }> = {
  'SV%': { label: 'Save % (from 0 to 1.000)', note: 'The big one; see the shot rule below' },
  Saves: { label: 'Save', note: 'Rewards a busy night' },
  'Breakaway Saves': { label: 'Breakaway save', note: 'Extra, on top of the normal save' },
  'Pen. Shot Saves': { label: 'Penalty shot save', note: 'Extra, on top of the normal save' },
  'Desp. Saves': { label: 'Desperation save', note: 'Extra, on top of the normal save' },
  Pokechecks: { label: 'Poke check', note: '' },
  'Goals Against': { label: 'Goal against', note: '' },
}

function groupRows(factors: ScoreFactor[]): WeightGroup[] {
  const groups: WeightGroup[] = []
  for (const f of factors) {
    const words = SKATER_WORDS[f.label]
    const group = words?.group ?? 'Other'
    let g = groups.find((x) => x.group === group)
    if (g === undefined) {
      g = { group, rows: [] }
      groups.push(g)
    }
    g.rows.push({ label: words?.label ?? f.label, weight: f.weight, note: words?.note ?? '' })
  }
  return groups
}

/** Skater weights, straight from `skaterBreakdown`, in plain-words groups. */
export function skaterWeightGroups(): WeightGroup[] {
  return groupRows(skaterBreakdown(ZERO_SKATER))
}

/** Goalie weights at full shot volume, straight from `goalieBreakdown`. SV% first. */
export function goalieWeightRows(): WeightRow[] {
  const rows = goalieBreakdown({ ...ZERO_GOALIE, shotsAgainst: GOALIE_FULL_WEIGHT_SHOTS }).map(
    (f) => ({
      label: GOALIE_WORDS[f.label]?.label ?? f.label,
      weight: f.weight,
      note: GOALIE_WORDS[f.label]?.note ?? '',
      key: f.label,
    }),
  )
  rows.sort((a, b) => (a.key === 'SV%' ? -1 : b.key === 'SV%' ? 1 : 0))
  return rows.map(({ label, weight, note }) => ({ label, weight, note }))
}

// ─── Scoring one line ─────────────────────────────────────────────────────────

export interface ScoredLine {
  parts: ScoreFactor[]
  total: number
}

function withWin(parts: ScoreFactor[], won: boolean): ScoredLine {
  const all = won
    ? [
        ...parts,
        {
          label: 'Win Bonus',
          value: 1,
          weight: WIN_BONUS_POINTS,
          contribution: WIN_BONUS_POINTS,
        },
      ]
    : parts
  return { parts: all, total: all.reduce((s, p) => s + p.contribution, 0) }
}

export function scoreSkaterLine(line: SkaterScoreInput, won: boolean): ScoredLine {
  return withWin(skaterBreakdown(line), won)
}

export function scoreGoalieLine(line: GoalieScoreInput, won: boolean): ScoredLine {
  return withWin(goalieBreakdown(line), won)
}

/** Same rule as match-recap `isStarEligible` for a goalie. */
export function goalieCanBeStar(line: Pick<GoalieScoreInput, 'saves' | 'shotsAgainst'>): boolean {
  const sa = line.shotsAgainst ?? 0
  const saves = line.saves ?? 0
  return sa > 0 && saves / sa >= STAR_MIN_GOALIE_SV_PCT
}

// ─── Real lines (read from the live database on 2026-11-21) ──────────────────

/** Match 3405: 2026-11-06, 6s, WIN 4-0 vs 814s Finest. The game page's three stars. */
export const EXAMPLE_GAME = {
  matchId: 3405,
  date: 'Nov 6, 2026',
  mode: '6s',
  scoreFor: 4,
  scoreAgainst: 0,
  opponent: '814s Finest',
}

export const EXAMPLE_CAMRAZZ: SkaterScoreInput = {
  ...ZERO_SKATER,
  goals: 2,
  assists: 2,
  plusMinus: 4,
  shots: 4,
  takeaways: 3,
  interceptions: 2,
  giveaways: 4,
}

export const EXAMPLE_LEHMANN: GoalieScoreInput = {
  ...ZERO_GOALIE,
  saves: 10,
  shotsAgainst: 10,
  goalsAgainst: 0,
}

export const EXAMPLE_HENRY: SkaterScoreInput = {
  ...ZERO_SKATER,
  goals: 1,
  assists: 1,
  plusMinus: 4,
  shots: 1,
  hits: 1,
  takeaways: 1,
  interceptions: 1,
  blockedShots: 1,
  penaltiesDrawn: 2,
}

/** Match 3426: 2026-11-09, 6s, WIN 4-3 vs Chieftains. */
export const ANCHOR_SILKY: SkaterScoreInput = {
  ...ZERO_SKATER,
  goals: 1,
  assists: 1,
  plusMinus: -1,
  shots: 9,
  takeaways: 4,
  penaltiesDrawn: 1,
  giveaways: 5,
  faceoffWins: 7,
  faceoffLosses: 18,
}

/** Match 3390: 2026-10-08, 6s, WIN 6-0 vs Pucks and Bucks. */
export const ANCHOR_HENRY_BIG: SkaterScoreInput = {
  ...ZERO_SKATER,
  goals: 2,
  assists: 3,
  plusMinus: 6,
  shots: 9,
  hits: 2,
  takeaways: 4,
  interceptions: 4,
  penaltiesDrawn: 1,
  giveaways: 8,
}
