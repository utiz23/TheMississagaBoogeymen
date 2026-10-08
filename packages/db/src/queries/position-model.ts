/**
 * Per-position skater lines: source rules, wing combination and coverage.
 *
 * Pure (no db import) so it is unit-testable; the loaders live in
 * `positions.ts`. Two sources, never summed within one title:
 *   - local  — `player_position_stats`, precomputed from tracked games. Its
 *              coverage is measured against EA's per-position season GP.
 *   - archive — reviewed player-card screenshots
 *              (`historical_player_season_stats` position scopes). 6s splits
 *              LW / RW; 3s only has a combined `wing`.
 * For a title, archive wins when it has position rows (a full season), else local.
 */
import type { PositionStatsPosition } from '../schema/aggregates.js'
import {
  ARCHIVE_SKATER_KEYS,
  sumArchiveSkaterDetail,
  type ArchiveSkaterDetail,
} from './archive-season-detail.js'
import { computeCareerCoverage, type CareerCoverage } from './career-coverage.js'

export const SKATER_POSITIONS = ['C', 'LW', 'RW', 'W', 'D'] as const
export type SkaterPosition = (typeof SKATER_POSITIONS)[number]

export const POSITION_STORED: Record<SkaterPosition, PositionStatsPosition> = {
  C: 'center',
  LW: 'leftWing',
  RW: 'rightWing',
  W: 'wing',
  D: 'defenseMen',
}

export const POSITION_NAME: Record<SkaterPosition, string> = {
  C: 'center',
  LW: 'left wing',
  RW: 'right wing',
  W: 'wing',
  D: 'defense',
}

/** Shown in place of LW / RW where only a combined wing exists. */
export const WING_UNSPLIT_REASON = '3s screenshots don’t split LW / RW. Pick W for wings.'

/** Detail counts; a count the source never recorded is null, never 0. */
export type PositionDetail = ArchiveSkaterDetail & { possessionSeconds: number | null }

export interface PositionLine {
  source: 'local' | 'archive' | 'mixed'
  gp: number
  goals: number
  assists: number
  points: number
  plusMinus: number
  pim: number
  shots: number
  shotAttempts: number
  hits: number
  takeaways: number
  giveaways: number
  toiSeconds: number | null
  detail: PositionDetail
  /** Games the source saw at this position vs the season's games there.
   * Null when there is no season reference (archive, single-mode splits). */
  coverage: CareerCoverage | null
  /** LW / RW over both playlists from the archive: 6s only (3s has no split). */
  wingSplit6sOnly: boolean
}

export interface PositionPlayerRow {
  playerId: number
  gamertag: string
  /** players.position (last known), for the name sub-line. */
  position: string | null
  line: PositionLine
}

export type PositionSlot = { rows: PositionPlayerRow[] } | { unavailable: string }

export interface PositionTable {
  source: 'local' | 'archive'
  positions: Record<SkaterPosition, PositionSlot>
}

// ─── Source rows ──────────────────────────────────────────────────────────────

export interface EaPositionGp {
  cGp: number
  lwGp: number
  rwGp: number
  dGp: number
}

export interface LocalPositionSourceRow {
  position: PositionStatsPosition
  gp: number
  goals: number
  assists: number
  points: number
  plusMinus: number
  shots: number
  shotAttempts: number
  hits: number
  pim: number
  takeaways: number
  giveaways: number
  faceoffWins: number
  faceoffLosses: number
  passCompletions: number
  passAttempts: number
  blockedShots: number
  ppGoals: number
  shGoals: number
  hatTricks: number
  interceptions: number
  penaltiesDrawn: number
  possessionSeconds: number
  deflections: number
  saucerPasses: number
  toiSeconds: number | null
}

export interface ArchivePositionSourceRow {
  gameMode: '6s' | '3s'
  positionScope: string
  gamesPlayed: number
  goals: number
  assists: number
  points: number
  plusMinus: number
  pim: number
  shots: number
  shotAttempts: number
  hits: number
  takeaways: number
  giveaways: number
  statsJson: unknown
}

type Mode = '6s' | '3s' | null

// ─── Lines ────────────────────────────────────────────────────────────────────

function nullDetail(): PositionDetail {
  const d = { possessionSeconds: null } as PositionDetail
  for (const k of Object.keys(ARCHIVE_SKATER_KEYS) as (keyof ArchiveSkaterDetail)[]) d[k] = null
  return d
}

function seasonGp(pos: SkaterPosition, ea: EaPositionGp): number {
  switch (pos) {
    case 'C':
      return ea.cGp
    case 'LW':
      return ea.lwGp
    case 'RW':
      return ea.rwGp
    case 'W':
      return ea.lwGp + ea.rwGp
    case 'D':
      return ea.dGp
  }
}

/**
 * A local (tracked games) line. `ea` is the player's EA season row for the
 * title, used as the coverage reference — pass it only for all-modes lines
 * (EA totals aren't split by playlist). Tracked GP above EA's (EA lag) counts
 * as complete.
 */
export function localLine(
  row: LocalPositionSourceRow,
  pos: SkaterPosition,
  ea: EaPositionGp | null,
): PositionLine {
  const detail = nullDetail()
  detail.powerPlayGoals = row.ppGoals
  detail.shortHandedGoals = row.shGoals
  detail.hatTricks = row.hatTricks
  detail.passes = row.passCompletions
  detail.passAttempts = row.passAttempts
  detail.saucerPasses = row.saucerPasses
  detail.deflections = row.deflections
  detail.faceoffWins = row.faceoffWins
  detail.faceoffLosses = row.faceoffLosses
  detail.blockedShots = row.blockedShots
  detail.interceptions = row.interceptions
  detail.penaltiesDrawn = row.penaltiesDrawn
  detail.possessionSeconds = row.possessionSeconds
  return {
    source: 'local',
    gp: row.gp,
    goals: row.goals,
    assists: row.assists,
    points: row.points,
    plusMinus: row.plusMinus,
    pim: row.pim,
    shots: row.shots,
    shotAttempts: row.shotAttempts,
    hits: row.hits,
    takeaways: row.takeaways,
    giveaways: row.giveaways,
    toiSeconds: row.toiSeconds,
    detail,
    coverage:
      ea === null ? null : computeCareerCoverage(row.gp, Math.max(row.gp, seasonGp(pos, ea))),
    wingSplit6sOnly: false,
  }
}

/** Archive scopes that make up `pos` within one playlist; 'unsplit' = LW/RW asked of 3s. */
function archiveScopes(pos: SkaterPosition, mode: '6s' | '3s'): string[] | 'unsplit' {
  switch (pos) {
    case 'C':
      return ['center']
    case 'D':
      return ['defenseMen']
    case 'W':
      return mode === '6s' ? ['leftWing', 'rightWing'] : ['wing']
    case 'LW':
      return mode === '6s' ? ['leftWing'] : 'unsplit'
    case 'RW':
      return mode === '6s' ? ['rightWing'] : 'unsplit'
  }
}

/**
 * One player × title's archive line for `pos` in `mode` (null = both
 * playlists). Null when the player has no rows there; 'unsplit' for LW / RW
 * in 3s. Over both playlists LW / RW come from 6s only, flagged when the
 * player also has 3s wing games.
 */
export function archiveLine(
  rows: readonly ArchivePositionSourceRow[],
  pos: SkaterPosition,
  mode: Mode,
): PositionLine | null | 'unsplit' {
  const picked: ArchivePositionSourceRow[] = []
  let wingSplit6sOnly = false
  for (const m of mode === null ? (['6s', '3s'] as const) : [mode]) {
    const scopes = archiveScopes(pos, m)
    if (scopes === 'unsplit') {
      if (mode !== null) return 'unsplit'
      wingSplit6sOnly ||= rows.some(
        (r) => r.gameMode === '3s' && r.positionScope === 'wing' && r.gamesPlayed > 0,
      )
      continue
    }
    picked.push(...rows.filter((r) => r.gameMode === m && scopes.includes(r.positionScope)))
  }
  if (picked.length === 0) return null
  const sum = (k: keyof ArchivePositionSourceRow & keyof PositionLine) =>
    picked.reduce((t, r) => t + r[k], 0)
  return {
    source: 'archive',
    gp: picked.reduce((t, r) => t + r.gamesPlayed, 0),
    goals: sum('goals'),
    assists: sum('assists'),
    points: sum('points'),
    plusMinus: sum('plusMinus'),
    pim: sum('pim'),
    shots: sum('shots'),
    shotAttempts: sum('shotAttempts'),
    hits: sum('hits'),
    takeaways: sum('takeaways'),
    giveaways: sum('giveaways'),
    // Skater screenshots never carried time on ice.
    toiSeconds: null,
    detail: { ...sumArchiveSkaterDetail(picked), possessionSeconds: null },
    coverage: null,
    wingSplit6sOnly,
  }
}

const addNullable = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : a + b

/**
 * Career line: counts add up; a nullable count is null unless every season
 * has it (a partial sum would understate the career); coverage adds the
 * seen and reference GP of every season (archive seasons count as complete).
 */
export function sumLines(lines: readonly PositionLine[]): PositionLine | null {
  const [first, ...rest] = lines
  if (first === undefined) return null
  let acc: PositionLine = { ...first, detail: { ...first.detail } }
  let covered = first.coverage?.coveredGp ?? first.gp
  let total = first.coverage?.totalGp ?? first.gp
  let anyCoverage = first.coverage !== null
  for (const l of rest) {
    const detail = { ...acc.detail }
    for (const k of Object.keys(detail) as (keyof PositionDetail)[]) {
      detail[k] = addNullable(acc.detail[k], l.detail[k])
    }
    acc = {
      source: acc.source === l.source ? acc.source : 'mixed',
      gp: acc.gp + l.gp,
      goals: acc.goals + l.goals,
      assists: acc.assists + l.assists,
      points: acc.points + l.points,
      plusMinus: acc.plusMinus + l.plusMinus,
      pim: acc.pim + l.pim,
      shots: acc.shots + l.shots,
      shotAttempts: acc.shotAttempts + l.shotAttempts,
      hits: acc.hits + l.hits,
      takeaways: acc.takeaways + l.takeaways,
      giveaways: acc.giveaways + l.giveaways,
      toiSeconds: addNullable(acc.toiSeconds, l.toiSeconds),
      detail,
      coverage: null,
      wingSplit6sOnly: acc.wingSplit6sOnly || l.wingSplit6sOnly,
    }
    covered += l.coverage?.coveredGp ?? l.gp
    total += l.coverage?.totalGp ?? l.gp
    anyCoverage ||= l.coverage !== null
  }
  acc.coverage = anyCoverage ? computeCareerCoverage(covered, total) : null
  return acc
}

function byPoints(a: PositionPlayerRow, b: PositionPlayerRow): number {
  return (
    b.line.points - a.line.points ||
    b.line.goals - a.line.goals ||
    b.line.assists - a.line.assists ||
    a.gamertag.localeCompare(b.gamertag)
  )
}

interface PlayerKey {
  playerId: number
  gamertag: string
  playerPosition: string | null
}

function emptyPositions(): Record<SkaterPosition, PositionPlayerRow[]> {
  return { C: [], LW: [], RW: [], W: [], D: [] }
}

// ─── Tables ───────────────────────────────────────────────────────────────────

/** One title × playlist from local rows (`ea` set → all-modes coverage). */
export function buildLocalPositionTable(
  rows: readonly (LocalPositionSourceRow & PlayerKey & { ea: EaPositionGp | null })[],
  mode: Mode,
): PositionTable {
  const out = emptyPositions()
  for (const pos of SKATER_POSITIONS) {
    for (const r of rows) {
      if (r.position !== POSITION_STORED[pos] || r.gp <= 0) continue
      out[pos].push({
        playerId: r.playerId,
        gamertag: r.gamertag,
        position: r.playerPosition,
        line: localLine(r, pos, mode === null ? r.ea : null),
      })
    }
    out[pos].sort(byPoints)
  }
  return {
    source: 'local',
    positions: Object.fromEntries(SKATER_POSITIONS.map((p) => [p, { rows: out[p] }])) as Record<
      SkaterPosition,
      PositionSlot
    >,
  }
}

/** One title × playlist from archive rows. */
export function buildArchivePositionTable(
  rows: readonly (ArchivePositionSourceRow & PlayerKey)[],
  mode: Mode,
): PositionTable {
  const byPlayer = groupBy(rows, (r) => r.playerId)
  const positions = {} as Record<SkaterPosition, PositionSlot>
  for (const pos of SKATER_POSITIONS) {
    if (mode === '3s' && (pos === 'LW' || pos === 'RW')) {
      positions[pos] = { unavailable: WING_UNSPLIT_REASON }
      continue
    }
    const list: PositionPlayerRow[] = []
    for (const playerRows of byPlayer.values()) {
      const head = playerRows[0]
      if (head === undefined) continue
      const line = archiveLine(playerRows, pos, mode)
      if (line === 'unsplit' || line === null || line.gp <= 0) continue
      list.push({
        playerId: head.playerId,
        gamertag: head.gamertag,
        position: head.playerPosition,
        line,
      })
    }
    positions[pos] = { rows: list.sort(byPoints) }
  }
  return { source: 'archive', positions }
}

function groupBy<T, K>(rows: readonly T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const r of rows) {
    const list = m.get(key(r)) ?? []
    list.push(r)
    m.set(key(r), list)
  }
  return m
}

// ─── Per player × title (career and player page) ─────────────────────────────

export interface TitleKey {
  gameTitleId: number
}

/**
 * Lines for one player × title, all playlists: archive when the player has
 * archive position rows for the title, else local.
 */
export function titleLines(
  archive: readonly ArchivePositionSourceRow[],
  local: readonly LocalPositionSourceRow[],
  ea: EaPositionGp | null,
): { source: 'archive' | 'local'; lines: Record<SkaterPosition, PositionLine | null> } {
  const lines = {} as Record<SkaterPosition, PositionLine | null>
  if (archive.length > 0) {
    for (const pos of SKATER_POSITIONS) {
      const l = archiveLine(archive, pos, null)
      lines[pos] = l === 'unsplit' || l === null || l.gp <= 0 ? null : l
    }
    return { source: 'archive', lines }
  }
  for (const pos of SKATER_POSITIONS) {
    const r = local.find((x) => x.position === POSITION_STORED[pos] && x.gp > 0)
    lines[pos] = r === undefined ? null : localLine(r, pos, ea)
  }
  return { source: 'local', lines }
}

/** Career (All Time) rows per position across every title a player has. */
export function buildCareerPositionRows(
  archive: readonly (ArchivePositionSourceRow & PlayerKey & TitleKey)[],
  local: readonly (LocalPositionSourceRow & PlayerKey & TitleKey & { ea: EaPositionGp | null })[],
): Record<SkaterPosition, PositionPlayerRow[]> {
  const players = new Map<number, PlayerKey>()
  for (const r of [...archive, ...local]) players.set(r.playerId, r)
  const archiveBy = groupBy(archive, (r) => `${String(r.playerId)}:${String(r.gameTitleId)}`)
  const localBy = groupBy(local, (r) => `${String(r.playerId)}:${String(r.gameTitleId)}`)
  const titlesBy = new Map<number, Set<number>>()
  for (const r of [...archive, ...local]) {
    const s = titlesBy.get(r.playerId) ?? new Set<number>()
    s.add(r.gameTitleId)
    titlesBy.set(r.playerId, s)
  }

  const out = emptyPositions()
  for (const [playerId, titles] of titlesBy) {
    const p = players.get(playerId)
    if (p === undefined) continue
    const perPos = emptyLines()
    for (const titleId of titles) {
      const key = `${String(playerId)}:${String(titleId)}`
      const loc = localBy.get(key) ?? []
      const { lines } = titleLines(archiveBy.get(key) ?? [], loc, loc[0]?.ea ?? null)
      for (const pos of SKATER_POSITIONS) {
        const l = lines[pos]
        if (l !== null) perPos[pos].push(l)
      }
    }
    for (const pos of SKATER_POSITIONS) {
      const line = sumLines(perPos[pos])
      if (line === null || line.gp <= 0) continue
      out[pos].push({
        playerId,
        gamertag: p.gamertag,
        position: p.playerPosition,
        line,
      })
    }
  }
  for (const pos of SKATER_POSITIONS) out[pos].sort(byPoints)
  return out
}

function emptyLines(): Record<SkaterPosition, PositionLine[]> {
  return { C: [], LW: [], RW: [], W: [], D: [] }
}
