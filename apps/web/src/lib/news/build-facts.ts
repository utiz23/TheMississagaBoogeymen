// Pure builders for the news desk fact sheets. The AI writer sees nothing about
// a game except what these functions put on the sheet, so the naming rules live
// here: only team members who are not AI goalies and not on press level `out`
// are named; everyone else's names go to `forbiddenNames`, which never reaches
// the model and is only used to reject text that names them anyway.
import type { UnlockDescription } from '@eanhl/db/discord'
import {
  milestoneCrossed,
  nightKey,
  previousWeekStarts,
  rankMilestones,
  weekStart as weekStartOf,
  type NewsAiGoalieLine,
  type NewsAiGoalieWeek,
  type NewsFacts,
  type NewsGameFacts,
  type NewsGoal,
  type NewsGoalPeriod,
  type NewsPerson,
  type NewsPlayerLine,
  type NewsPosition,
  type NewsWeekHistory,
  type NewsWeekPlayer,
  type PressLevel,
} from '@eanhl/db/news'
// The match page's goal timeline functions: the sheet shows its clocks the page's way.
import { clockToSeconds, toElapsedClock } from '../event-timeline.ts'

// ── People ───────────────────────────────────────────────────────────────────

export interface PlayerRef {
  playerId: number | null
  gamertag: string
  aiGoalie: boolean
  position?: string | null
}

export interface NewsProfileInfo {
  name: string | null
  pressLevel: PressLevel
}

const trimmed = (s: string | null | undefined): string => s?.trim() ?? ''

/**
 * Who may be named and who may not. `players` lists every BGM player of the
 * sheet's games, oldest game first (the latest position wins). Named = member,
 * not an AI goalie, press level not `out`; the name is the trimmed profile
 * name or the gamertag. Every other player's gamertag and non-blank profile
 * name is forbidden. AI goalies are neither (spec §12.8): not people, but
 * named on their own AI goalie line, so their names must not be forbidden.
 */
export function buildPeople(args: {
  players: readonly PlayerRef[]
  memberIds: ReadonlySet<number>
  profiles: ReadonlyMap<number, NewsProfileInfo>
  /**
   * Every club member at press level `out`, whether or not they played: an
   * older story or a stat line could still bring their name to the writer.
   */
  outMembers: readonly { gamertag: string; name: string | null }[]
}): { people: NewsPerson[]; forbiddenNames: string[] } {
  const people = new Map<number, NewsPerson>()
  const forbidden = new Map<string, string>() // lower-case -> first spelling
  const forbid = (name: string) => {
    const n = name.trim()
    if (n !== '' && !forbidden.has(n.toLowerCase())) forbidden.set(n.toLowerCase(), n)
  }

  for (const p of args.players) {
    if (p.aiGoalie) continue
    const profile = p.playerId === null ? undefined : args.profiles.get(p.playerId)
    const pressLevel = profile?.pressLevel ?? 'full'
    const named = p.playerId !== null && args.memberIds.has(p.playerId) && pressLevel !== 'out'
    if (named && p.playerId !== null && (pressLevel === 'full' || pressLevel === 'easy')) {
      const name = trimmed(profile?.name) || trimmed(p.gamertag)
      const prev = people.get(p.playerId)
      people.set(p.playerId, {
        playerId: p.playerId,
        name,
        position: trimmed(p.position) || prev?.position || '',
        pressLevel,
      })
    } else {
      forbid(p.gamertag)
      if (profile) forbid(profile.name ?? '')
    }
  }
  for (const m of args.outMembers) {
    forbid(m.gamertag)
    forbid(m.name ?? '')
  }
  return {
    people: [...people.values()],
    forbiddenNames: [...forbidden.values()],
  }
}

// ── One game ─────────────────────────────────────────────────────────────────

export interface GamePlayerInput {
  playerId: number | null
  gamertag: string
  /** The position of this game as the match page shows it (loadout OCR over EA's position). */
  position: string | null
  isGoalie: boolean
  aiGoalie: boolean
  goals: number
  assists: number
  shots: number
  hits: number
  pim: number
  saves: number | null
  goalsAgainst: number | null
  shotsAgainst: number | null
  /** 1-3 when the player is one of the three stars (ranked by the match page's game score). */
  star: 1 | 2 | 3 | null
}

export interface GameFactsArgs {
  match: {
    id: number
    playedAt: Date
    result: 'WIN' | 'LOSS' | 'OTL'
    scoreFor: number
    scoreAgainst: number
    opponentName: string
    gameMode: '3s' | '6s' | null
    hitsFor: number
    hitsAgainst: number
    ppGoals: number | null
    ppOpportunities: number | null
    timeOnAttack: number | null
  }
  gameTitleName: string
  overtime: boolean
  /** Shots as the match page shows them (reviewed OCR over EA's count). */
  shots: { for: number; against: number }
  passPct: number | null
  periods: NewsGameFacts['periods']
  players: readonly GamePlayerInput[]
  people: readonly NewsPerson[]
  /** Club member ids: an unnamed member is a teammate at press level `out`, not a guest. */
  memberIds: ReadonlySet<number>
  /** The match page's event rows (`getMatchEvents`, its trust filter applied); only goals are used. */
  goalEvents: readonly GoalEventInput[]
}

// ── Goal timeline ────────────────────────────────────────────────────────────

/** The fields of a match-page event row (`MatchEventRow`) the timeline needs. */
export interface GoalEventInput {
  id: number
  eventType: string
  periodNumber: number
  periodLabel: string | null
  /** Stored as the in-game countdown, `MM:SS` remaining. */
  clock: string | null
  teamSide: string | null
  goalNumberInGame: number | null
  scorerId: number | null
  scorerSnapshot: string | null
  actorId: number | null
  primaryAssistId: number | null
  secondaryAssistId: number | null
}

const PERIOD_BY_NUMBER: Record<number, NewsGoalPeriod> = {
  1: '1st',
  2: '2nd',
  3: '3rd',
  4: 'OT',
  5: 'OT2',
  6: 'OT3',
}

/**
 * The sheet's period name. The number decides, as on the match page (OCR
 * writes prefixes such as "RT 2ND PERIOD" into the label); the label is read
 * only when the number is not a period 1-6. EASHL has no shootout.
 */
export function normalizePeriod(periodNumber: number, label: string | null): NewsGoalPeriod | null {
  const byNumber = PERIOD_BY_NUMBER[periodNumber]
  if (byNumber) return byNumber
  const l = (label ?? '').toUpperCase()
  const ot = /\bOT\s*([23])?\b/.exec(l)
  if (ot) return ot[1] === '2' ? 'OT2' : ot[1] === '3' ? 'OT3' : 'OT'
  if (/\b1ST\b/.test(l)) return '1st'
  if (/\b2ND\b/.test(l)) return '2nd'
  if (/\b3RD\b/.test(l)) return '3rd'
  return null
}

const PERIOD_SECONDS = 20 * 60

/** A stored `MM:SS` countdown inside one period, or null. */
function validClock(clock: string | null): string | null {
  const c = clock?.trim() ?? ''
  const m = /^(\d{1,2}):(\d{2})$/.exec(c)
  if (!m || Number(m[2]) > 59) return null
  return clockToSeconds(c) <= PERIOD_SECONDS ? c : null
}

/** The scorer the match page shows: the scorer row, else (no snapshot either) the actor. */
function scorerIdOf(e: GoalEventInput): number | null {
  if (e.scorerId !== null) return e.scorerId
  if (e.scorerSnapshot !== null && e.scorerSnapshot.trim() !== '') return null
  return e.actorId
}

/**
 * The goal timeline for the sheet. Null when the game has no goal events, when
 * the events miss a goal of the final score (the match page then says the rest
 * were not captured), or when a goal has no usable period or clock: a partial
 * timeline would let a story claim "the only goal of the period". Clocks are
 * the match page's (elapsed). Only `people` are named; an opponent goal never
 * has a scorer or assists.
 */
export function buildGoalTimeline(
  events: readonly GoalEventInput[],
  people: readonly NewsPerson[],
  score: { for: number; against: number },
): Pick<NewsGameFacts, 'goals' | 'clockMeaning'> {
  const none = { goals: null, clockMeaning: null }
  const goals = events.filter((e) => e.eventType === 'goal')
  if (goals.length === 0) return none
  const countFor = goals.filter((e) => e.teamSide === 'for').length
  if (countFor !== score.for || goals.length - countFor !== score.against) return none

  const nameById = new Map(people.map((p) => [p.playerId, p.name]))
  const nameOf = (id: number | null) => (id === null ? undefined : nameById.get(id))
  const rows: { e: GoalEventInput; goal: NewsGoal; periodIndex: number }[] = []
  for (const e of goals) {
    const period = normalizePeriod(e.periodNumber, e.periodLabel)
    const clock = validClock(e.clock)
    const elapsed = toElapsedClock(clock)
    if (period === null || clock === null || elapsed === null) return none
    const side = e.teamSide === 'for' ? 'for' : 'against'
    const assists =
      side === 'for'
        ? [e.primaryAssistId, e.secondaryAssistId].flatMap((id) => {
            const n = nameOf(id)
            return n === undefined ? [] : [n]
          })
        : []
    rows.push({
      e,
      periodIndex: Object.values(PERIOD_BY_NUMBER).indexOf(period),
      goal: {
        period,
        clock: elapsed,
        side,
        scorer: side === 'for' ? (nameOf(scorerIdOf(e)) ?? null) : null,
        assists,
      },
    })
  }
  // As played: period, then the countdown from high to low, then the goal number.
  rows.sort(
    (a, b) =>
      a.periodIndex - b.periodIndex ||
      clockToSeconds(b.e.clock) - clockToSeconds(a.e.clock) ||
      (a.e.goalNumberInGame ?? 0) - (b.e.goalNumberInGame ?? 0) ||
      a.e.id - b.e.id,
  )
  return { goals: rows.map((r) => r.goal), clockMeaning: 'elapsed' }
}

const round1 = (n: number): number => Math.round(n * 10) / 10

/**
 * Pass completion %, one decimal, rounded exactly as the match page's Pass %
 * row (`toFixed(1)`), so the sheet never shows 0.2 where the page shows 0.1.
 */
export function passPctOf(completions: number, attempts: number): number | null {
  return attempts > 0 ? Number(((completions / attempts) * 100).toFixed(1)) : null
}

/**
 * Period goals for the sheet, or null. Every real period (not the -1 "TOT"
 * sentinel) must have both goal numbers and they must add up to the final
 * score; a partly read table would make the story disagree with the page.
 */
export function periodsFromSummaries(
  rows: readonly { periodNumber: number; goalsFor: number | null; goalsAgainst: number | null }[],
  scoreFor: number,
  scoreAgainst: number,
): NewsGameFacts['periods'] {
  const real = rows
    .filter((r) => r.periodNumber >= 1)
    .sort((a, b) => a.periodNumber - b.periodNumber)
  if (real.length === 0) return null
  const out: { period: number; goalsFor: number; goalsAgainst: number }[] = []
  for (const r of real) {
    if (r.goalsFor === null || r.goalsAgainst === null) return null
    out.push({ period: r.periodNumber, goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst })
  }
  const sumFor = out.reduce((n, r) => n + r.goalsFor, 0)
  const sumAgainst = out.reduce((n, r) => n + r.goalsAgainst, 0)
  return sumFor === scoreFor && sumAgainst === scoreAgainst ? out : null
}

/**
 * F, D or G from a game's position string (EA's `center`, `leftWing`,
 * `rightDefenseMen`, `goalie`, ...; the 3s `wing` / `defenseMen`). Without a
 * position the goalie flag decides.
 */
export function newsPosition(position: string | null, isGoalie: boolean): NewsPosition {
  const p = (position ?? '').trim().toLowerCase()
  if (p === 'goalie') return 'G'
  if (p.includes('defense')) return 'D'
  if (p !== '') return 'F'
  return isGoalie ? 'G' : 'F'
}

/** Saves over shots against in %, one decimal, as the match page's SV% (`toFixed(1)`); null without shots. */
function savePctAsShown(saves: number, shotsAgainst: number): number | null {
  return shotsAgainst > 0 ? Number(((saves / shotsAgainst) * 100).toFixed(1)) : null
}

/**
 * The AI goalie's line (spec §12.8), or null when the row has no saves or
 * goals against (the page shows a dash). Shots against fall back to saves +
 * goals against. Named by the in-game name (the gamertag).
 */
function aiGoalieLine(p: GamePlayerInput): NewsAiGoalieLine | null {
  if (p.saves === null || p.goalsAgainst === null) return null
  const shotsAgainst = p.shotsAgainst ?? p.saves + p.goalsAgainst
  return {
    name: p.gamertag.replace(/\s+/g, ' ').trim(),
    saves: p.saves,
    shotsAgainst,
    goalsAgainst: p.goalsAgainst,
    savePct: savePctAsShown(p.saves, shotsAgainst),
  }
}

function playerLine(p: GamePlayerInput, person: NewsPerson): NewsPlayerLine {
  let savePct: number | null = null
  if (p.isGoalie && p.saves !== null) {
    const faced = p.shotsAgainst ?? (p.goalsAgainst !== null ? p.saves + p.goalsAgainst : null)
    if (faced !== null && faced > 0) savePct = round1((p.saves / faced) * 100)
  }
  return {
    playerId: person.playerId,
    name: person.name,
    position: newsPosition(p.position, p.isGoalie),
    isGoalie: p.isGoalie,
    goals: p.goals,
    assists: p.assists,
    points: p.goals + p.assists,
    shots: p.shots,
    hits: p.hits,
    pim: p.pim,
    saves: p.isGoalie ? p.saves : null,
    goalsAgainst: p.isGoalie ? p.goalsAgainst : null,
    savePct,
    star: p.star,
  }
}

/** Under this much time on attack (seconds) a game ended early (spec §12.12-3). */
export const ENDED_EARLY_TOA_SECONDS = 240
/** Under this many shots (both teams) a game ended early. */
export const ENDED_EARLY_TOTAL_SHOTS = 10

/**
 * A game that ended early (a quit, a disconnect): the score is above the goals
 * the player rows credit, or time on attack is under 240 s, or both teams
 * together have under 10 shots. An unknown time on attack is not "under".
 */
export function isEndedEarly(g: {
  scoreFor: number
  creditedGoals: number
  timeOnAttack: number | null
  shots: { for: number; against: number }
}): boolean {
  return (
    g.scoreFor > g.creditedGoals ||
    (g.timeOnAttack !== null && g.timeOnAttack < ENDED_EARLY_TOA_SECONDS) ||
    g.shots.for + g.shots.against < ENDED_EARLY_TOTAL_SHOTS
  )
}

/**
 * One game's part of the sheet. Only named people get a player line. Unnamed
 * club members (press level `out`) count towards `unnamedTeammates`; everyone
 * else unnamed counts towards `guestCount`; AI goalies count towards neither.
 * The goals of everyone stay in the team score; the goals and assists of the
 * unnamed (AI goalies too) are summed in `unnamedGoals` / `unnamedAssists`.
 * Goals of the score that no player row accounts for (EA rows short of the
 * score) are unnamed goals too: `unnamedGoals` = the larger of the unnamed
 * rows' goals and the score minus the named goals. Assists come only from rows.
 * A game that ended early (`isEndedEarly`, with the goals the rows credit,
 * before that fallback) gets no team numbers.
 */
export function buildGameFacts(args: GameFactsArgs): NewsGameFacts {
  const { match } = args
  const byId = new Map(args.people.map((p) => [p.playerId, p]))
  const players: NewsPlayerLine[] = []
  let guestCount = 0
  let unnamedTeammates = 0
  let unnamedGoals = 0
  let unnamedAssists = 0
  let aiGoalieInNet = false
  let aiGoalie: NewsAiGoalieLine | null = null
  for (const p of args.players) {
    const person = p.aiGoalie || p.playerId === null ? undefined : byId.get(p.playerId)
    if (person) {
      players.push(playerLine(p, person))
      continue
    }
    // Everyone without a player line: their goals and assists go on the sheet
    // as plain numbers, each row clamped at 0 so a bad row cannot make a total negative.
    unnamedGoals += Math.max(0, p.goals)
    unnamedAssists += Math.max(0, p.assists)
    if (p.aiGoalie) {
      aiGoalieInNet = true
      aiGoalie ??= aiGoalieLine(p)
    } else if (p.playerId !== null && args.memberIds.has(p.playerId)) unnamedTeammates += 1
    else guestCount += 1
  }
  const namedGoals = players.reduce((n, p) => n + p.goals, 0)
  // Before the fallback below: the goals the player rows credit.
  const endedEarly = isEndedEarly({
    scoreFor: match.scoreFor,
    creditedGoals: namedGoals + unnamedGoals,
    timeOnAttack: match.timeOnAttack,
    shots: args.shots,
  })
  unnamedGoals = Math.max(unnamedGoals, match.scoreFor - namedGoals, 0)
  return {
    matchId: match.id,
    night: nightKey(match.playedAt),
    playedAt: match.playedAt.toISOString(),
    gameTitleName: args.gameTitleName,
    gameMode: match.gameMode,
    result: match.result,
    overtime: args.overtime,
    scoreFor: match.scoreFor,
    scoreAgainst: match.scoreAgainst,
    // EA sends club names with repeated spaces; the writer writes them with one.
    opponentName: match.opponentName.replace(/\s+/g, ' ').trim(),
    team: endedEarly
      ? null
      : {
          shotsFor: args.shots.for,
          shotsAgainst: args.shots.against,
          hitsFor: match.hitsFor,
          hitsAgainst: match.hitsAgainst,
          ppGoals: match.ppGoals,
          ppOpportunities: match.ppOpportunities,
          passPct: args.passPct,
          timeOnAttackSeconds: match.timeOnAttack,
        },
    endedEarly,
    periods: args.periods,
    players,
    aiGoalieInNet,
    aiGoalie,
    guestCount,
    unnamedTeammates,
    unnamedGoals,
    unnamedAssists,
    ...buildGoalTimeline(args.goalEvents, args.people, {
      for: match.scoreFor,
      against: match.scoreAgainst,
    }),
  }
}

// ── Record, streak, unlocks, milestones, assembly ────────────────────────────

/**
 * Record and streak from a title's counted results, newest first. An overtime
 * loss is a loss for the streak (it ends a win run and extends a losing one).
 */
export function buildRecordAndStreak(results: readonly string[]): {
  record: NewsFacts['record']
  streak: NewsFacts['streak']
} {
  const record = { wins: 0, losses: 0, otl: 0 }
  for (const r of results) {
    if (r === 'WIN') record.wins += 1
    else if (r === 'LOSS') record.losses += 1
    else if (r === 'OTL') record.otl += 1
  }
  const counted = results.filter((r) => r === 'WIN' || r === 'LOSS' || r === 'OTL')
  const first = counted[0]
  if (first === undefined) return { record, streak: null }
  const kind: 'W' | 'L' = first === 'WIN' ? 'W' : 'L'
  let count = 0
  for (const r of counted) {
    if ((r === 'WIN') !== (kind === 'W')) break
    count += 1
  }
  return { record, streak: { kind, count } }
}

/** The sheet's sentence for one counted unlock. */
export function unlockText(d: Pick<UnlockDescription, 'kind' | 'subject' | 'graphic'>): string {
  switch (d.kind) {
    case 'badge':
      return `unlocked the ${d.subject} badge`
    case 'card_level':
      return `reached card level ${d.subject}`
    case 'tier':
    case 'mythic':
      return `unlocked the ${d.subject} card`
  }
}

/** A player's totals in the active title (points = goals + assists, as the database sums them). */
export interface Totals {
  goals: number
  assists: number
  points: number
  games: number
}

const STATS = ['goals', 'assists', 'points', 'games'] as const

/**
 * Milestones when a title total crosses a tier (spec §12.12-10, `milestoneCrossed`:
 * points every 100, goals and assists every 50, games at 100/250/500/750/1000)
 * between `before` and `after`. One entry per stat (the highest crossed).
 * Only named people; a player with no `before` row starts from zero. At most
 * three per sheet, ranked by spec §12.7 (`rankMilestones`).
 */
export function buildMilestones(
  before: ReadonlyMap<number, Totals>,
  after: ReadonlyMap<number, Totals>,
  people: readonly NewsPerson[],
): NewsFacts['milestones'] {
  const out: NewsFacts['milestones'] = []
  for (const person of people) {
    const a = after.get(person.playerId)
    if (!a) continue
    const b = before.get(person.playerId) ?? { goals: 0, assists: 0, points: 0, games: 0 }
    for (const stat of STATS) {
      const value = milestoneCrossed(stat, b[stat], a[stat])
      if (value !== null) out.push({ playerId: person.playerId, name: person.name, stat, value })
    }
  }
  return rankMilestones(out)
}

// ── Week sheets: history and players (revision 2) ────────────────────────────

/** One counted game of the title before the sheet's week (shots as the match page shows them). */
export interface HistoryGameInput {
  night: string
  result: 'WIN' | 'LOSS' | 'OTL'
  scoreFor: number
  scoreAgainst: number
  shotsFor: number
  shotsAgainst: number
  ppGoals: number | null
  ppOpportunities: number | null
}

/** How many weeks before the sheet's week the `history` covers. */
export const HISTORY_WEEKS = 4

/**
 * The week sheet's `history`: team totals of each of the four weeks before
 * `weekStart`, oldest first. A week without a game is left out; a game outside
 * those weeks is ignored. Missing power-play numbers count as 0.
 */
export function buildWeekHistory(
  games: readonly HistoryGameInput[],
  weekStart: string,
): NewsWeekHistory[] {
  const weeks = previousWeekStarts(weekStart, HISTORY_WEEKS)
  const byWeek = new Map<string, NewsWeekHistory>()
  for (const g of games) {
    const w = weekStartOf(g.night)
    if (!weeks.includes(w)) continue
    const row = byWeek.get(w) ?? {
      weekStart: w,
      wins: 0,
      losses: 0,
      otl: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      shotsFor: 0,
      shotsAgainst: 0,
      ppGoals: 0,
      ppOpportunities: 0,
    }
    if (g.result === 'WIN') row.wins += 1
    else if (g.result === 'LOSS') row.losses += 1
    else row.otl += 1
    row.goalsFor += g.scoreFor
    row.goalsAgainst += g.scoreAgainst
    row.shotsFor += g.shotsFor
    row.shotsAgainst += g.shotsAgainst
    row.ppGoals += g.ppGoals ?? 0
    row.ppOpportunities += g.ppOpportunities ?? 0
    byWeek.set(w, row)
  }
  return weeks.flatMap((w) => {
    const row = byWeek.get(w)
    return row ? [row] : []
  })
}

/**
 * The week sheet's `weekPlayers`: every named person with a game line this
 * week, their week (sums of the lines) and their title totals through the
 * week's last game (`titleTotals`, the same totals the milestones use). Most
 * points first, then goals, then the order of `people`.
 */
export function buildWeekPlayers(
  games: readonly NewsGameFacts[],
  people: readonly NewsPerson[],
  titleTotals: ReadonlyMap<number, Totals>,
): NewsWeekPlayer[] {
  const out: NewsWeekPlayer[] = []
  for (const person of people) {
    const lines = games.flatMap((g) => g.players.filter((p) => p.playerId === person.playerId))
    if (lines.length === 0) continue
    const sum = (f: (l: NewsPlayerLine) => number) => lines.reduce((n, l) => n + f(l), 0)
    const t = titleTotals.get(person.playerId) ?? { goals: 0, assists: 0, points: 0, games: 0 }
    out.push({
      playerId: person.playerId,
      name: person.name,
      games: lines.length,
      goals: sum((l) => l.goals),
      assists: sum((l) => l.assists),
      points: sum((l) => l.points),
      shots: sum((l) => l.shots),
      hits: sum((l) => l.hits),
      titleGoals: t.goals,
      titleAssists: t.assists,
      titlePoints: t.points,
      titleGames: t.games,
    })
  }
  const rank = new Map(people.map((p, i) => [p.playerId, i]))
  return out.sort(
    (a, b) =>
      b.points - a.points ||
      b.goals - a.goals ||
      (rank.get(a.playerId) ?? 0) - (rank.get(b.playerId) ?? 0),
  )
}

/**
 * The week sheet's `aiGoalieWeek` (spec §12.8): each AI goalie's totals over
 * the games, save % from the sums as the page shows it. Most games first,
 * then the order of first appearance.
 */
export function buildAiGoalieWeek(games: readonly NewsGameFacts[]): NewsAiGoalieWeek[] {
  const byName = new Map<string, NewsAiGoalieWeek>()
  for (const g of games) {
    const a = g.aiGoalie
    if (a === null) continue
    const row = byName.get(a.name) ?? {
      name: a.name,
      games: 0,
      saves: 0,
      shotsAgainst: 0,
      goalsAgainst: 0,
      savePct: null,
    }
    row.games += 1
    row.saves += a.saves
    row.shotsAgainst += a.shotsAgainst
    row.goalsAgainst += a.goalsAgainst
    byName.set(a.name, row)
  }
  return [...byName.values()]
    .map((r) => ({ ...r, savePct: savePctAsShown(r.saves, r.shotsAgainst) }))
    .sort((a, b) => b.games - a.games)
}

/** Assemble a sheet; the night totals are summed from the games. */
export function buildFacts(args: {
  kind: NewsFacts['kind']
  key: string
  gameTitleName: string
  games: NewsGameFacts[]
  record: NewsFacts['record']
  streak: NewsFacts['streak']
  unlocks: NewsFacts['unlocks']
  milestones: NewsFacts['milestones']
  recentNights: NewsFacts['recentNights']
  people: NewsPerson[]
  /** Week sheets only (default []). */
  history?: NewsWeekHistory[]
  /** Week sheets only (default []). */
  weekPlayers?: NewsWeekPlayer[]
  /** Week sheets only (default []). */
  aiGoalieWeek?: NewsAiGoalieWeek[]
}): NewsFacts {
  const nightTotals = {
    goalsFor: 0,
    goalsAgainst: 0,
    shotsFor: 0,
    shotsAgainst: 0,
    wins: 0,
    losses: 0,
    otl: 0,
  }
  for (const g of args.games) {
    nightTotals.goalsFor += g.scoreFor
    nightTotals.goalsAgainst += g.scoreAgainst
    // A game that ended early has no team numbers: its shots are not counted.
    nightTotals.shotsFor += g.team?.shotsFor ?? 0
    nightTotals.shotsAgainst += g.team?.shotsAgainst ?? 0
    if (g.result === 'WIN') nightTotals.wins += 1
    else if (g.result === 'LOSS') nightTotals.losses += 1
    else nightTotals.otl += 1
  }
  return {
    kind: args.kind,
    key: args.key,
    gameTitleName: args.gameTitleName,
    games: args.games,
    nightTotals,
    record: args.record,
    streak: args.streak,
    unlocks: args.unlocks,
    milestones: args.milestones,
    recentNights: args.recentNights,
    people: args.people,
    history: args.history ?? [],
    weekPlayers: args.weekPlayers ?? [],
    aiGoalieWeek: args.aiGoalieWeek ?? [],
  }
}

// ── Route parameters ─────────────────────────────────────────────────────────

const DAY = /^\d{4}-\d{2}-\d{2}$/

function isRealDay(s: string): boolean {
  if (!DAY.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** A night key: a real `YYYY-MM-DD` calendar day. */
export const isNightKey = isRealDay

/** Options of the fact-sheet loaders: `includeInactive` loads nights of a title that is not active. */
export interface FactsLoadOptions {
  includeInactive?: boolean
}

/** `?includeInactive=1` (exactly) on an internal fact-sheet route turns the option on. */
export function includeInactiveOption(url: string): { includeInactive: boolean } {
  return { includeInactive: new URL(url).searchParams.get('includeInactive') === '1' }
}

/** A game's title may get a sheet: the active title always, another one only with `includeInactive`. */
export function titleAllowed(
  title: { isActive: boolean } | undefined,
  opts: FactsLoadOptions,
): boolean {
  if (!title) return false
  return title.isActive || opts.includeInactive === true
}

/** A week key: a real `YYYY-MM-DD` day that is a Monday. */
export function isWeekStartKey(s: string): boolean {
  return isRealDay(s) && new Date(`${s}T00:00:00Z`).getUTCDay() === 1
}
