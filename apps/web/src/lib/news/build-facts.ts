// Pure builders for the news desk fact sheets. The AI writer sees nothing about
// a game except what these functions put on the sheet, so the naming rules live
// here: only team members who are not AI goalies and not on press level `out`
// are named; everyone else's names go to `forbiddenNames`, which never reaches
// the model and is only used to reject text that names them anyway.
import type { UnlockDescription } from '@eanhl/db/discord'
import {
  nightKey,
  type NewsFacts,
  type NewsGameFacts,
  type NewsPerson,
  type NewsPlayerLine,
  type PressLevel,
} from '@eanhl/db/news'

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
 * name is forbidden, AI goalies included (they are not teammates).
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
    const profile = p.playerId === null ? undefined : args.profiles.get(p.playerId)
    const pressLevel = profile?.pressLevel ?? 'full'
    const named =
      p.playerId !== null && args.memberIds.has(p.playerId) && !p.aiGoalie && pressLevel !== 'out'
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
  position: string | null
  isGoalie: boolean
  aiGoalie: boolean
  goals: number
  assists: number
  shots: number
  hits: number
  plusMinus: number
  pim: number
  saves: number | null
  goalsAgainst: number | null
  shotsAgainst: number | null
  /** The match page's game score for this player. */
  gameScore: number | null
  /** 1-3 when the player is one of the three stars. */
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

function playerLine(p: GamePlayerInput, person: NewsPerson): NewsPlayerLine {
  let savePct: number | null = null
  if (p.isGoalie && p.saves !== null) {
    const faced = p.shotsAgainst ?? (p.goalsAgainst !== null ? p.saves + p.goalsAgainst : null)
    if (faced !== null && faced > 0) savePct = round1((p.saves / faced) * 100)
  }
  return {
    playerId: person.playerId,
    name: person.name,
    isGoalie: p.isGoalie,
    goals: p.goals,
    assists: p.assists,
    points: p.goals + p.assists,
    shots: p.shots,
    hits: p.hits,
    plusMinus: p.plusMinus,
    pim: p.pim,
    saves: p.isGoalie ? p.saves : null,
    goalsAgainst: p.isGoalie ? p.goalsAgainst : null,
    savePct,
    gameScore: p.gameScore,
    star: p.star,
  }
}

/**
 * One game's part of the sheet. Only named people get a player line. Unnamed
 * club members (press level `out`) count towards `unnamedTeammates`; everyone
 * else unnamed counts towards `guestCount`; AI goalies count towards neither.
 * The goals of everyone stay in the team score; the goals and assists of the
 * unnamed (AI goalies too) are summed in `unnamedGoals` / `unnamedAssists`.
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
    if (p.aiGoalie) aiGoalieInNet = true
    else if (p.playerId !== null && args.memberIds.has(p.playerId)) unnamedTeammates += 1
    else guestCount += 1
  }
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
    team: {
      shotsFor: args.shots.for,
      shotsAgainst: args.shots.against,
      hitsFor: match.hitsFor,
      hitsAgainst: match.hitsAgainst,
      ppGoals: match.ppGoals,
      ppOpportunities: match.ppOpportunities,
      passPct: args.passPct,
      timeOnAttackSeconds: match.timeOnAttack,
    },
    periods: args.periods,
    players,
    aiGoalieInNet,
    guestCount,
    unnamedTeammates,
    unnamedGoals,
    unnamedAssists,
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

const MILESTONE_STEP = 25
const STATS = ['goals', 'assists', 'points', 'games'] as const

/**
 * A milestone when a title total crosses a multiple of 25 between `before` and
 * `after`. One entry per stat (the highest multiple crossed). Only named
 * people; a player with no `before` row starts from zero.
 */
export function buildMilestones(
  before: ReadonlyMap<number, Totals>,
  after: ReadonlyMap<number, Totals>,
  people: readonly NewsPerson[],
): NewsFacts['milestones'] {
  const out: NewsFacts['milestones'] = []
  const value = (t: Totals, stat: (typeof STATS)[number]): number => t[stat]
  for (const person of people) {
    const a = after.get(person.playerId)
    if (!a) continue
    const b = before.get(person.playerId) ?? { goals: 0, assists: 0, points: 0, games: 0 }
    for (const stat of STATS) {
      const crossed = Math.floor(value(a, stat) / MILESTONE_STEP)
      if (crossed > Math.floor(value(b, stat) / MILESTONE_STEP)) {
        out.push({
          playerId: person.playerId,
          name: person.name,
          stat,
          value: crossed * MILESTONE_STEP,
        })
      }
    }
  }
  return out
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
    nightTotals.shotsFor += g.team.shotsFor
    nightTotals.shotsAgainst += g.team.shotsAgainst
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

/** A week key: a real `YYYY-MM-DD` day that is a Monday. */
export function isWeekStartKey(s: string): boolean {
  return isRealDay(s) && new Date(`${s}T00:00:00Z`).getUTCDay() === 1
}
