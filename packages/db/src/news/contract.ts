/**
 * The JSON the web app's news fact-sheet route returns and the news service
 * consumes. Lives here (no DB client import) so both apps share one
 * definition. Parsed at the network boundary, never trusted.
 *
 * `forbiddenNames` never goes to the model: the service sends only `facts`
 * and uses the list to reject any text that names a player on it.
 */

export interface NewsPerson {
  playerId: number
  name: string
  position: string
  /** Players with press level `out` are never listed. */
  pressLevel: 'full' | 'easy'
}

export interface NewsPlayerLine {
  playerId: number
  name: string
  isGoalie: boolean
  goals: number
  assists: number
  points: number
  shots: number
  hits: number
  plusMinus: number
  pim: number
  saves: number | null
  goalsAgainst: number | null
  savePct: number | null
  gameScore: number | null
  star: 1 | 2 | 3 | null
}

/** A period as the match page names it. EASHL has no shootout: periods 4-6 are OT, OT2, OT3. */
export const NEWS_GOAL_PERIODS = ['1st', '2nd', '3rd', 'OT', 'OT2', 'OT3'] as const
export type NewsGoalPeriod = (typeof NEWS_GOAL_PERIODS)[number]

/** One goal of a game's timeline, as the match page shows it. */
export interface NewsGoal {
  period: NewsGoalPeriod
  /** `MM:SS`, exactly as the match page shows it; see `NewsGameFacts.clockMeaning`. */
  clock: string
  /** `for` = a Boogeymen goal. */
  side: 'for' | 'against'
  /** A name from `people`, or null (opponent, guest, unnamed teammate, AI goalie, unknown). */
  scorer: string | null
  /** Names from `people` only; everyone else is left out. */
  assists: string[]
}

export interface NewsGameFacts {
  matchId: number
  night: string
  playedAt: string
  gameTitleName: string
  gameMode: '3s' | '6s' | null
  result: 'WIN' | 'LOSS' | 'OTL'
  overtime: boolean
  scoreFor: number
  scoreAgainst: number
  opponentName: string
  team: {
    shotsFor: number
    shotsAgainst: number
    hitsFor: number
    hitsAgainst: number
    ppGoals: number | null
    ppOpportunities: number | null
    passPct: number | null
    timeOnAttackSeconds: number | null
  }
  periods: { period: number; goalsFor: number; goalsAgainst: number }[] | null
  players: NewsPlayerLine[]
  aiGoalieInNet: boolean
  /** Players in the game who are not club members (AI goalies not counted). */
  guestCount: number
  /** Club members in the game at press level `out`: teammates who must not be named or singled out. */
  unnamedTeammates: number
  /**
   * Goals by BGM players who are not in `players` (guests, unnamed teammates,
   * an AI goalie if it has any). Named goals + this = the team's goals, when
   * the EA data is consistent.
   */
  unnamedGoals: number
  /** Assists by the same unnamed players. */
  unnamedAssists: number
  /** The goals in the order they were scored, or null when the game has no complete timeline. */
  goals: NewsGoal[] | null
  /** Whether `goals[].clock` counts up from 00:00 (elapsed) or down to 00:00 (remaining). Null without goals. */
  clockMeaning: 'elapsed' | 'remaining' | null
}

export interface NewsRecord {
  wins: number
  losses: number
  otl: number
}

export interface NewsStreak {
  kind: 'W' | 'L'
  count: number
}

export interface NewsFacts {
  kind: 'game' | 'night' | 'week'
  key: string
  gameTitleName: string
  games: NewsGameFacts[]
  nightTotals: {
    goalsFor: number
    goalsAgainst: number
    shotsFor: number
    shotsAgainst: number
    wins: number
    losses: number
    otl: number
  }
  record: NewsRecord
  streak: NewsStreak | null
  unlocks: { playerId: number; name: string; text: string }[]
  milestones: {
    playerId: number
    name: string
    stat: 'goals' | 'assists' | 'points' | 'games'
    value: number
  }[]
  recentNights: {
    night: string
    wins: number
    losses: number
    otl: number
    goalsFor: number
    goalsAgainst: number
  }[]
  people: NewsPerson[]
}

export interface NewsFactsResponse {
  facts: NewsFacts
  forbiddenNames: string[]
}

function fail(path: string, why: string): never {
  throw new Error(`news contract: ${path} ${why}`)
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'is not an object')
  return v as Record<string, unknown>
}
function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'is not a finite number')
  return v
}
function int(v: unknown, path: string): number {
  const n = num(v, path)
  if (!Number.isSafeInteger(n)) fail(path, 'is not an integer')
  return n
}
function nonNegInt(v: unknown, path: string): number {
  const n = int(v, path)
  if (n < 0) fail(path, 'is negative')
  return n
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, 'is not a string')
  return v
}
function night(v: unknown, path: string): string {
  const s = str(v, path)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(path, 'is not a YYYY-MM-DD date')
  return s
}
function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'is not a boolean')
  return v
}
function nullable<T>(v: unknown, path: string, inner: (v: unknown, p: string) => T): T | null {
  return v === null ? null : inner(v, path)
}
function oneOf<const T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) fail(path, 'is invalid')
  return v as T
}
function arr<T>(v: unknown, path: string, item: (v: unknown, p: string) => T): T[] {
  if (!Array.isArray(v)) fail(path, 'is not an array')
  return v.map((x, i) => item(x, `${path}[${String(i)}]`))
}

function parsePerson(v: unknown, path: string): NewsPerson {
  const o = obj(v, path)
  return {
    playerId: int(o['playerId'], `${path}.playerId`),
    name: str(o['name'], `${path}.name`),
    position: str(o['position'], `${path}.position`),
    pressLevel: oneOf(o['pressLevel'], `${path}.pressLevel`, ['full', 'easy']),
  }
}

function parsePlayerLine(v: unknown, path: string): NewsPlayerLine {
  const o = obj(v, path)
  const star = o['star']
  if (star !== null && star !== 1 && star !== 2 && star !== 3) fail(`${path}.star`, 'is invalid')
  return {
    playerId: int(o['playerId'], `${path}.playerId`),
    name: str(o['name'], `${path}.name`),
    isGoalie: bool(o['isGoalie'], `${path}.isGoalie`),
    goals: int(o['goals'], `${path}.goals`),
    assists: int(o['assists'], `${path}.assists`),
    points: int(o['points'], `${path}.points`),
    shots: int(o['shots'], `${path}.shots`),
    hits: int(o['hits'], `${path}.hits`),
    plusMinus: int(o['plusMinus'], `${path}.plusMinus`),
    pim: int(o['pim'], `${path}.pim`),
    saves: nullable(o['saves'], `${path}.saves`, int),
    goalsAgainst: nullable(o['goalsAgainst'], `${path}.goalsAgainst`, int),
    savePct: nullable(o['savePct'], `${path}.savePct`, num),
    gameScore: nullable(o['gameScore'], `${path}.gameScore`, num),
    star,
  }
}

function parseTeam(v: unknown, path: string): NewsGameFacts['team'] {
  const o = obj(v, path)
  return {
    shotsFor: int(o['shotsFor'], `${path}.shotsFor`),
    shotsAgainst: int(o['shotsAgainst'], `${path}.shotsAgainst`),
    hitsFor: int(o['hitsFor'], `${path}.hitsFor`),
    hitsAgainst: int(o['hitsAgainst'], `${path}.hitsAgainst`),
    ppGoals: nullable(o['ppGoals'], `${path}.ppGoals`, int),
    ppOpportunities: nullable(o['ppOpportunities'], `${path}.ppOpportunities`, int),
    passPct: nullable(o['passPct'], `${path}.passPct`, num),
    timeOnAttackSeconds: nullable(o['timeOnAttackSeconds'], `${path}.timeOnAttackSeconds`, int),
  }
}

function parseGoal(v: unknown, path: string): NewsGoal {
  const o = obj(v, path)
  const clock = str(o['clock'], `${path}.clock`)
  if (!/^\d{1,2}:\d{2}$/.test(clock)) fail(`${path}.clock`, 'is not an MM:SS clock')
  return {
    period: oneOf(o['period'], `${path}.period`, NEWS_GOAL_PERIODS),
    clock,
    side: oneOf(o['side'], `${path}.side`, ['for', 'against']),
    scorer: nullable(o['scorer'], `${path}.scorer`, str),
    assists: arr(o['assists'], `${path}.assists`, str),
  }
}

/**
 * The timeline and its clock meaning. A missing `goals` reads as null, so a
 * sheet from a web app without the timeline still parses. A timeline needs a
 * clock meaning.
 */
function parseTimeline(
  o: Record<string, unknown>,
  path: string,
): Pick<NewsGameFacts, 'goals' | 'clockMeaning'> {
  const goals =
    o['goals'] === undefined
      ? null
      : nullable(o['goals'], `${path}.goals`, (x, p) => arr(x, p, parseGoal))
  const raw = o['clockMeaning'] === undefined ? null : o['clockMeaning']
  const clockMeaning = nullable(raw, `${path}.clockMeaning`, (x, p) =>
    oneOf(x, p, ['elapsed', 'remaining']),
  )
  if (goals !== null && clockMeaning === null) {
    fail(`${path}.clockMeaning`, 'is required when goals are present')
  }
  return { goals, clockMeaning: goals === null ? null : clockMeaning }
}

function parseGame(v: unknown, path: string): NewsGameFacts {
  const o = obj(v, path)
  return {
    matchId: int(o['matchId'], `${path}.matchId`),
    night: night(o['night'], `${path}.night`),
    playedAt: str(o['playedAt'], `${path}.playedAt`),
    gameTitleName: str(o['gameTitleName'], `${path}.gameTitleName`),
    gameMode: nullable(o['gameMode'], `${path}.gameMode`, (x, p) => oneOf(x, p, ['3s', '6s'])),
    result: oneOf(o['result'], `${path}.result`, ['WIN', 'LOSS', 'OTL']),
    overtime: bool(o['overtime'], `${path}.overtime`),
    scoreFor: int(o['scoreFor'], `${path}.scoreFor`),
    scoreAgainst: int(o['scoreAgainst'], `${path}.scoreAgainst`),
    opponentName: str(o['opponentName'], `${path}.opponentName`),
    team: parseTeam(o['team'], `${path}.team`),
    periods: nullable(o['periods'], `${path}.periods`, (x, p) =>
      arr(x, p, (r, rp) => {
        const po = obj(r, rp)
        return {
          period: int(po['period'], `${rp}.period`),
          goalsFor: int(po['goalsFor'], `${rp}.goalsFor`),
          goalsAgainst: int(po['goalsAgainst'], `${rp}.goalsAgainst`),
        }
      }),
    ),
    players: arr(o['players'], `${path}.players`, parsePlayerLine),
    aiGoalieInNet: bool(o['aiGoalieInNet'], `${path}.aiGoalieInNet`),
    guestCount: int(o['guestCount'], `${path}.guestCount`),
    unnamedTeammates: int(o['unnamedTeammates'], `${path}.unnamedTeammates`),
    unnamedGoals: nonNegInt(o['unnamedGoals'], `${path}.unnamedGoals`),
    unnamedAssists: nonNegInt(o['unnamedAssists'], `${path}.unnamedAssists`),
    ...parseTimeline(o, path),
  }
}

function parseRecord(v: unknown, path: string): NewsRecord {
  const o = obj(v, path)
  return {
    wins: int(o['wins'], `${path}.wins`),
    losses: int(o['losses'], `${path}.losses`),
    otl: int(o['otl'], `${path}.otl`),
  }
}

function parseStreak(v: unknown, path: string): NewsStreak {
  const o = obj(v, path)
  return {
    kind: oneOf(o['kind'], `${path}.kind`, ['W', 'L']),
    count: int(o['count'], `${path}.count`),
  }
}

function parseFacts(v: unknown, path: string): NewsFacts {
  const o = obj(v, path)
  const t = obj(o['nightTotals'], `${path}.nightTotals`)
  const tp = `${path}.nightTotals`
  return {
    kind: oneOf(o['kind'], `${path}.kind`, ['game', 'night', 'week']),
    key: night(o['key'], `${path}.key`),
    gameTitleName: str(o['gameTitleName'], `${path}.gameTitleName`),
    games: arr(o['games'], `${path}.games`, parseGame),
    nightTotals: {
      goalsFor: int(t['goalsFor'], `${tp}.goalsFor`),
      goalsAgainst: int(t['goalsAgainst'], `${tp}.goalsAgainst`),
      shotsFor: int(t['shotsFor'], `${tp}.shotsFor`),
      shotsAgainst: int(t['shotsAgainst'], `${tp}.shotsAgainst`),
      wins: int(t['wins'], `${tp}.wins`),
      losses: int(t['losses'], `${tp}.losses`),
      otl: int(t['otl'], `${tp}.otl`),
    },
    record: parseRecord(o['record'], `${path}.record`),
    streak: nullable(o['streak'], `${path}.streak`, parseStreak),
    unlocks: arr(o['unlocks'], `${path}.unlocks`, (x, p) => {
      const u = obj(x, p)
      return {
        playerId: int(u['playerId'], `${p}.playerId`),
        name: str(u['name'], `${p}.name`),
        text: str(u['text'], `${p}.text`),
      }
    }),
    milestones: arr(o['milestones'], `${path}.milestones`, (x, p) => {
      const m = obj(x, p)
      return {
        playerId: int(m['playerId'], `${p}.playerId`),
        name: str(m['name'], `${p}.name`),
        stat: oneOf(m['stat'], `${p}.stat`, ['goals', 'assists', 'points', 'games']),
        value: int(m['value'], `${p}.value`),
      }
    }),
    recentNights: arr(o['recentNights'], `${path}.recentNights`, (x, p) => {
      const n = obj(x, p)
      return {
        night: night(n['night'], `${p}.night`),
        wins: int(n['wins'], `${p}.wins`),
        losses: int(n['losses'], `${p}.losses`),
        otl: int(n['otl'], `${p}.otl`),
        goalsFor: int(n['goalsFor'], `${p}.goalsFor`),
        goalsAgainst: int(n['goalsAgainst'], `${p}.goalsAgainst`),
      }
    }),
    people: arr(o['people'], `${path}.people`, parsePerson),
  }
}

/** Throws (with the path of the first bad field) when the value is not a valid fact-sheet response. */
export function parseNewsFactsResponse(value: unknown): NewsFactsResponse {
  const o = obj(value, 'root')
  return {
    facts: parseFacts(o['facts'], 'facts'),
    forbiddenNames: arr(o['forbiddenNames'], 'forbiddenNames', str),
  }
}
