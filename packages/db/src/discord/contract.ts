/**
 * The JSON the web app's /internal/discord/game/[matchId] route returns and
 * the discord service consumes. Lives here (no DB client import) so both
 * apps share one definition. Parsed at the network boundary, never trusted.
 */

export const DISCORD_RESULTS = ['WIN', 'LOSS', 'OTL', 'DNF'] as const
export type DiscordResult = (typeof DISCORD_RESULTS)[number]
export type DiscordStarKind = 'member' | 'guest' | 'opponent'

export interface DiscordStar {
  /** 1, 2 or 3. */
  rank: number
  gamertag: string
  kind: DiscordStarKind
  /** BGM player id for members and guests; null for opponents. */
  playerId: number | null
  score: number
  statLine: string
  /** Opponent club abbreviation; null for BGM stars. */
  teamAbbrev: string | null
}

export interface DiscordGameResult {
  matchId: number
  result: DiscordResult
  overtime: boolean
  scoreFor: number
  scoreAgainst: number
  opponentName: string
  gameTitleName: string
  gameMode: '3s' | '6s' | null
  /** ISO timestamp of game end (matches.played_at). */
  playedAt: string
  /** Empty for DNF. */
  stars: DiscordStar[]
  /** Member stars with a renderable card, in star order. */
  cardPlayerIds: number[]
}

function fail(path: string, why: string): never {
  throw new Error(`discord contract: ${path} ${why}`)
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
function nullable<T>(v: unknown, path: string, inner: (v: unknown, p: string) => T): T | null {
  return v === null ? null : inner(v, path)
}

function parseStar(v: unknown, path: string): DiscordStar {
  const o = obj(v, path)
  const kind = o['kind']
  if (kind !== 'member' && kind !== 'guest' && kind !== 'opponent')
    fail(`${path}.kind`, 'is invalid')
  return {
    rank: int(o['rank'], `${path}.rank`),
    gamertag: str(o['gamertag'], `${path}.gamertag`),
    kind,
    playerId: nullable(o['playerId'], `${path}.playerId`, int),
    score: num(o['score'], `${path}.score`),
    statLine: str(o['statLine'], `${path}.statLine`),
    teamAbbrev: nullable(o['teamAbbrev'], `${path}.teamAbbrev`, str),
  }
}

export function parseDiscordGameResult(value: unknown): DiscordGameResult {
  const o = obj(value, 'root')
  const result = o['result']
  if (!DISCORD_RESULTS.includes(result as DiscordResult)) fail('result', 'is invalid')
  const gameMode = o['gameMode']
  if (gameMode !== null && gameMode !== '3s' && gameMode !== '6s') fail('gameMode', 'is invalid')
  const overtime = o['overtime']
  if (typeof overtime !== 'boolean') fail('overtime', 'is not a boolean')
  const starsRaw = o['stars']
  if (!Array.isArray(starsRaw)) fail('stars', 'is not an array')
  const stars = starsRaw.map((s, i) => parseStar(s, `stars[${String(i)}]`))
  const cardsRaw = o['cardPlayerIds']
  if (!Array.isArray(cardsRaw)) fail('cardPlayerIds', 'is not an array')
  const cardPlayerIds = cardsRaw.map((c, i) => int(c, `cardPlayerIds[${String(i)}]`))
  const memberIds = new Set(stars.filter((s) => s.kind === 'member').map((s) => s.playerId))
  if (cardPlayerIds.some((id) => !memberIds.has(id)))
    fail('cardPlayerIds', 'names a non-member star')
  return {
    matchId: int(o['matchId'], 'matchId'),
    result: result as DiscordResult,
    overtime,
    scoreFor: int(o['scoreFor'], 'scoreFor'),
    scoreAgainst: int(o['scoreAgainst'], 'scoreAgainst'),
    opponentName: str(o['opponentName'], 'opponentName'),
    gameTitleName: str(o['gameTitleName'], 'gameTitleName'),
    gameMode,
    playedAt: str(o['playedAt'], 'playedAt'),
    stars,
    cardPlayerIds,
  }
}
