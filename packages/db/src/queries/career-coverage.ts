/**
 * Pure helpers for career (All Time) TOI/GAA coverage.
 *
 * The defect this module fixes: `getAllTimeSkaterStats`/`getAllTimeGoalieStats`
 * previously summed TOI only from rows that had it, but divided by GP (or, for
 * goalies, GA) summed across every row — including reviewed NHL 22-25
 * player-card rows that have GP and goals-against but no TOI at all. That
 * mismatched numerator/denominator understated TOI/GP and grossly inflated
 * GAA for any player with partial-coverage history (e.g. a career GAA of
 * 39.41 instead of the same-row-covered 4.87).
 *
 * Kept separate from the DB query, like `archive-club-member-aggregate.ts`,
 * so the aggregation and precedence rules are unit-testable without a
 * database.
 */

export type CareerCoverageState = 'complete' | 'partial' | 'unavailable'

export interface CareerCoverage {
  state: CareerCoverageState
  coveredGp: number
  totalGp: number
}

/**
 * - complete: covered GP equals total GP and total GP > 0
 * - partial: covered GP is greater than 0 but less than total GP
 * - unavailable: covered GP is 0 (includes the degenerate totalGp === 0 case)
 */
export function computeCareerCoverage(coveredGp: number, totalGp: number): CareerCoverage {
  const state: CareerCoverageState =
    coveredGp > 0 && coveredGp === totalGp ? 'complete' : coveredGp > 0 ? 'partial' : 'unavailable'
  return { state, coveredGp, totalGp }
}

interface CareerSourceRowKey {
  playerId: number
  gameTitleId: number
}

/**
 * Source precedence for career totals — the same rule already used by
 * `getPlayerCareerSeasons`: an EA member-season row is authoritative for a
 * player+title; any reviewed historical player-card row for that exact
 * player+title is excluded so the pair is never double counted. Production
 * currently has zero overlapping player/title pairs (EA only covers active
 * titles, historical only covers retired ones), but the exclusion is applied
 * unconditionally so a future overlap can't silently double-count.
 */
export function excludeHistoricalRowsCoveredByEa<H extends CareerSourceRowKey>(
  eaRows: readonly CareerSourceRowKey[],
  historicalRows: readonly H[],
): H[] {
  const covered = new Set(eaRows.map((r) => `${String(r.playerId)}:${String(r.gameTitleId)}`))
  return historicalRows.filter(
    (r) => !covered.has(`${String(r.playerId)}:${String(r.gameTitleId)}`),
  )
}

export interface CareerSkaterCountRow {
  gamesPlayed: number
  goals: number
  assists: number
  points: number
  plusMinus: number
  pim: number
  shots: number
  hits: number
  takeaways: number
  giveaways: number
  shotAttempts: number
  faceoffWins: number
  faceoffLosses: number
  passCompletions: number
  passAttempts: number
  /** Null when this source row never captured TOI (e.g. NHL 22-25 player-card rows). */
  toiSeconds: number | null
}

export interface AggregatedCareerSkater {
  gamesPlayed: number
  goals: number
  assists: number
  points: number
  plusMinus: number
  pim: number
  shots: number
  hits: number
  takeaways: number
  giveaways: number
  shotAttempts: number
  faceoffPct: string | null
  passPct: string | null
  /** Sum of TOI from rows where TOI was captured only; null when no row has any. */
  toiSeconds: number | null
  /** Sum of GP from exactly those TOI-covered rows — the correct TOI/GP denominator. */
  toiCoverageGp: number
  toiCoverage: CareerCoverage
}

/**
 * Aggregates a player's already precedence-filtered career source rows
 * (EA + non-overlapping reviewed historical rows) into career totals.
 *
 * Every count field sums across every row unconditionally (unaffected by TOI
 * coverage — this preserves the pre-existing totals). TOI, however, is only
 * summed from rows that captured it, and paired with the GP from those SAME
 * rows so the TOI/GP denominator can never include GP from TOI-less rows.
 */
export function aggregateSkaterCareerRows(
  rows: readonly CareerSkaterCountRow[],
): AggregatedCareerSkater {
  let gamesPlayed = 0
  let goals = 0
  let assists = 0
  let points = 0
  let plusMinus = 0
  let pim = 0
  let shots = 0
  let hits = 0
  let takeaways = 0
  let giveaways = 0
  let shotAttempts = 0
  let faceoffWins = 0
  let faceoffLosses = 0
  let passCompletions = 0
  let passAttempts = 0
  let toiSum = 0
  let toiCoverageGp = 0

  for (const r of rows) {
    gamesPlayed += r.gamesPlayed
    goals += r.goals
    assists += r.assists
    points += r.points
    plusMinus += r.plusMinus
    pim += r.pim
    shots += r.shots
    hits += r.hits
    takeaways += r.takeaways
    giveaways += r.giveaways
    shotAttempts += r.shotAttempts
    faceoffWins += r.faceoffWins
    faceoffLosses += r.faceoffLosses
    passCompletions += r.passCompletions
    passAttempts += r.passAttempts
    if (r.toiSeconds !== null && r.toiSeconds > 0) {
      toiSum += r.toiSeconds
      toiCoverageGp += r.gamesPlayed
    }
  }

  const pct = (num: number, den: number): string | null =>
    den > 0 ? ((num / den) * 100).toFixed(2) : null

  return {
    gamesPlayed,
    goals,
    assists,
    points,
    plusMinus,
    pim,
    shots,
    hits,
    takeaways,
    giveaways,
    shotAttempts,
    faceoffPct: pct(faceoffWins, faceoffWins + faceoffLosses),
    passPct: pct(passCompletions, passAttempts),
    toiSeconds: toiCoverageGp > 0 ? toiSum : null,
    toiCoverageGp,
    toiCoverage: computeCareerCoverage(toiCoverageGp, gamesPlayed),
  }
}

export interface CareerGoalieCountRow {
  gamesPlayed: number
  wins: number | null
  losses: number | null
  otl: number | null
  shutouts: number | null
  totalSaves: number | null
  /** Null when this source row never captured goals-against. */
  totalGoalsAgainst: number | null
  /** Null when this source row never captured TOI. */
  toiSeconds: number | null
}

export interface AggregatedCareerGoalie {
  gamesPlayed: number
  wins: number
  losses: number
  otl: number
  savePct: string | null
  /** Recomputed ONLY from same-row covered GA and TOI — see `gaaCoverage`. */
  gaa: string | null
  shutouts: number
  totalSaves: number
  totalShotsAgainst: number
  totalGoalsAgainst: number
  /** Sum of TOI from rows where TOI was captured only; null when no row has any. */
  toiSeconds: number | null
  /** Sum of GP from exactly those TOI-covered rows. */
  toiCoverageGp: number
  toiCoverage: CareerCoverage
  /** Sum of GA from rows where BOTH TOI and GA were captured — the GAA numerator. */
  gaaCoveredGoalsAgainst: number | null
  /** Sum of GP from exactly those TOI-and-GA rows — the GAA coverage denominator. */
  gaaCoverageGp: number
  gaaCoverage: CareerCoverage
}

/**
 * Goalie counterpart of `aggregateSkaterCareerRows`.
 *
 * TOI coverage and GAA coverage are tracked separately and independently: a
 * row with TOI but no GA (not seen in production today, but plausible for a
 * future source) contributes to TOI coverage without being allowed to also
 * claim GAA coverage, and vice versa. GAA is computed only from GA and TOI
 * that come from the exact same rows — never GA summed across every row
 * divided by TOI summed across a different subset of rows, which is the
 * defect being fixed.
 */
export function aggregateGoalieCareerRows(
  rows: readonly CareerGoalieCountRow[],
): AggregatedCareerGoalie {
  let gamesPlayed = 0
  let wins = 0
  let losses = 0
  let otl = 0
  let shutouts = 0
  let totalSaves = 0
  let totalGoalsAgainst = 0
  let toiSum = 0
  let toiCoverageGp = 0
  let gaaCoveredGoalsAgainst = 0
  let gaaCoverageGp = 0
  let gaaCoveredToiSum = 0

  for (const r of rows) {
    gamesPlayed += r.gamesPlayed
    wins += r.wins ?? 0
    losses += r.losses ?? 0
    otl += r.otl ?? 0
    shutouts += r.shutouts ?? 0
    totalSaves += r.totalSaves ?? 0
    totalGoalsAgainst += r.totalGoalsAgainst ?? 0

    if (r.toiSeconds !== null && r.toiSeconds > 0) {
      const toi = r.toiSeconds
      toiSum += toi
      toiCoverageGp += r.gamesPlayed
      if (r.totalGoalsAgainst !== null) {
        gaaCoveredGoalsAgainst += r.totalGoalsAgainst
        gaaCoverageGp += r.gamesPlayed
        gaaCoveredToiSum += toi
      }
    }
  }

  const svDenom = totalSaves + totalGoalsAgainst
  const savePct = svDenom > 0 ? ((totalSaves / svDenom) * 100).toFixed(2) : null
  const gaa =
    gaaCoverageGp > 0 && gaaCoveredToiSum > 0
      ? ((gaaCoveredGoalsAgainst * 3600) / gaaCoveredToiSum).toFixed(2)
      : null

  return {
    gamesPlayed,
    wins,
    losses,
    otl,
    savePct,
    gaa,
    shutouts,
    totalSaves,
    totalShotsAgainst: totalSaves + totalGoalsAgainst,
    totalGoalsAgainst,
    toiSeconds: toiCoverageGp > 0 ? toiSum : null,
    toiCoverageGp,
    toiCoverage: computeCareerCoverage(toiCoverageGp, gamesPlayed),
    gaaCoveredGoalsAgainst: gaaCoverageGp > 0 ? gaaCoveredGoalsAgainst : null,
    gaaCoverageGp,
    gaaCoverage: computeCareerCoverage(gaaCoverageGp, gamesPlayed),
  }
}
