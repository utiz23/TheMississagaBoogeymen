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
  guestCount: number
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
function str(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, 'is not a string')
  return v
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

function parseGame(v: unknown, path: string): NewsGameFacts {
  const o = obj(v, path)
  return {
    matchId: int(o['matchId'], `${path}.matchId`),
    night: str(o['night'], `${path}.night`),
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
    key: str(o['key'], `${path}.key`),
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
        night: str(n['night'], `${p}.night`),
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
