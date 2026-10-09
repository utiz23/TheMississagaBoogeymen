/**
 * Career Action Map view model (Player Action Map.dc.html renderVals; spec
 * Part 5). Pure and type-only on the db package: filters and their counts,
 * rink markers, the grouped event list and the pin bar.
 */
import type { CareerActionRow } from '@eanhl/db/queries'
import { computeMarkerOffsets } from '../../lib/marker-layout.ts'
import { abbreviateTeamName } from '../../lib/format.ts'
import { toElapsedClock } from '../../lib/event-timeline.ts'

export type ActionType = 'goal' | 'shot' | 'hit' | 'penalty' | 'faceoff'
export type MarkerType = Exclude<ActionType, 'faceoff'>
export type PeriodFilter = 'all' | 1 | 2 | 3 | 'ot'
export type RoleFilter = 'all' | 'by' | 'on'
export type SortMode = 'game' | 'newest' | 'type'
/** DNF counts as a loss in records but reads neutral (operator, 2026-10-09). */
export type ResultTone = 'W' | 'L' | 'OTL' | 'DNF'

export const ACTION_TYPES: readonly ActionType[] = ['goal', 'shot', 'hit', 'penalty', 'faceoff']
export const PERIOD_FILTERS: readonly PeriodFilter[] = ['all', 1, 2, 3, 'ot']
export const ALL_TYPES_ON: Readonly<Record<ActionType, boolean>> = {
  goal: true,
  shot: true,
  hit: true,
  penalty: true,
  faceoff: true,
}

/** The operator's zone (docker-compose BACKUP_TZ default). */
export const ACTION_MAP_TIME_ZONE = 'America/Edmonton'

export interface ActionFilters {
  period: PeriodFilter
  role: RoleFilter
  types: Readonly<Record<ActionType, boolean>>
  isoMatchId: number | null
}

export interface ActionMarker {
  id: number
  type: MarkerType
  role: 'by' | 'on'
  /** Rink viewBox centre (2405×1025) and the de-collision offset. */
  cx: number
  cy: number
  dx: number
  dy: number
  size: number
  pinned: boolean
  opacity: number
  tip: string
}

export interface ActionRow {
  id: number
  type: ActionType
  role: 'by' | 'on'
  actor: string
  target: string
  label: string
  clock: string
  meta: string
  plotted: boolean
}

export interface ActionGroup {
  key: string
  label: string
  sub: string
  /** "W 4–2" (game sort only). */
  result: string | null
  tone: ResultTone | null
  count: number
  /** Game groups isolate their match when clicked. */
  matchId: number | null
  rows: ActionRow[]
}

export interface PinView {
  label: string
  role: 'by' | 'on'
  actor: string
  target: string
  clock: string
  period: string
  opp: string
  date: string
  mode: string
  result: string
  tone: ResultTone
}

const DASH = '—'
const VIEW_W = 2405
const VIEW_H = 1025
const MARKER_SIZE = 56
const PIN_SCALE = 1.5
const Z_ORDER: Record<MarkerType, number> = { hit: 0, penalty: 1, shot: 2, goal: 3 }
const TYPE_PLURAL: Record<ActionType, string> = {
  goal: 'Goals',
  shot: 'Shots',
  hit: 'Hits',
  penalty: 'Penalties',
  faceoff: 'Faceoffs',
}

const isActionType = (t: string): t is ActionType => (ACTION_TYPES as readonly string[]).includes(t)

export function periodName(n: number): string {
  if (n === 1) return '1st period'
  if (n === 2) return '2nd period'
  if (n === 3) return '3rd period'
  if (n === 4) return 'OT'
  return `OT${String(Math.min(n, 6) - 3)}`
}

export function actionLabel(e: CareerActionRow): string {
  const on = e.role === 'on'
  switch (e.eventType) {
    case 'goal':
      return on ? 'Goal against' : 'Goal'
    case 'shot':
      return on ? 'Shot against' : 'Shot'
    case 'hit':
      return on ? 'Hit taken' : 'Hit'
    case 'faceoff':
      return on ? 'Faceoff lost' : 'Faceoff won'
    case 'penalty': {
      const base = on ? 'Penalty drawn' : 'Penalty'
      return e.infraction === null || e.infraction === '' ? base : `${base} · ${e.infraction}`
    }
    default:
      return e.eventType
  }
}

function clockSeconds(clock: string | null): number {
  const m = clock === null ? null : /^(\d+):(\d{2})$/.exec(clock.trim())
  return m === null ? -1 : Number(m[1]) * 60 + Number(m[2])
}

/** Stored clocks count down; show time elapsed, as the game page does. */
const clockText = (clock: string | null) =>
  clock === null || clock.trim() === '' ? DASH : (toElapsedClock(clock.trim()) ?? DASH)

function tone(result: CareerActionRow['result']): ResultTone {
  return result === 'WIN' ? 'W' : result === 'OTL' ? 'OTL' : result === 'DNF' ? 'DNF' : 'L'
}

function resultText(e: CareerActionRow): string {
  const word =
    e.result === 'WIN' ? 'W' : e.result === 'OTL' ? 'OTL' : e.result === 'DNF' ? 'DNF' : 'L'
  return `${word} ${String(e.scoreFor)}–${String(e.scoreAgainst)}`
}

const periodMatches = (e: CareerActionRow, p: PeriodFilter) =>
  p === 'all' || (p === 'ot' ? e.periodNumber >= 4 : e.periodNumber === p)

/** The design's match(e, skip): every active filter except `skip`. */
function passes(e: CareerActionRow, f: ActionFilters, skip?: 'period' | 'role' | 'type'): boolean {
  if (!isActionType(e.eventType)) return false
  if (f.isoMatchId !== null && e.matchId !== f.isoMatchId) return false
  if (skip !== 'period' && !periodMatches(e, f.period)) return false
  if (skip !== 'role' && f.role !== 'all' && e.role !== f.role) return false
  if (skip !== 'type' && !f.types[e.eventType]) return false
  return true
}

export function visibleEvents(
  events: readonly CareerActionRow[],
  f: ActionFilters,
): CareerActionRow[] {
  return events.filter((e) => passes(e, f))
}

export function filterCounts(events: readonly CareerActionRow[], f: ActionFilters) {
  const periods = { all: 0, 1: 0, 2: 0, 3: 0, ot: 0 } as Record<PeriodFilter, number>
  const roles: Record<RoleFilter, number> = { all: 0, by: 0, on: 0 }
  const types: Record<ActionType, number> = { goal: 0, shot: 0, hit: 0, penalty: 0, faceoff: 0 }
  for (const e of events) {
    if (passes(e, f, 'period')) {
      for (const p of PERIOD_FILTERS) if (periodMatches(e, p)) periods[p]++
    }
    if (passes(e, f, 'role')) {
      roles.all++
      roles[e.role]++
    }
    if (passes(e, f, 'type') && isActionType(e.eventType)) types[e.eventType]++
  }
  return { periods, roles, types }
}

const isPlotted = (e: CareerActionRow) => e.x !== null && e.y !== null && e.eventType !== 'faceoff'

/** Visible events with no marker (unknown direction, no position, faceoffs). */
export function notPlotted(visible: readonly CareerActionRow[]): number {
  return visible.filter((e) => !isPlotted(e)).length
}

export function shouldShowActionMap(events: readonly CareerActionRow[]): boolean {
  return events.filter((e) => e.hasPosition).length >= 5
}

/** One formatter per zone: building Intl.DateTimeFormat per event cost ~0.1 ms each. */
const DAY_FORMATS = new Map<string, Intl.DateTimeFormat>()

function formatDay(d: Date, timeZone: string): string {
  let fmt = DAY_FORMATS.get(timeZone)
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone })
    DAY_FORMATS.set(timeZone, fmt)
  }
  return fmt.format(d)
}

function markerTip(e: CareerActionRow, timeZone: string): string {
  const approx = e.positionConfidence === 'extrapolated' ? ' · approx. position' : ''
  return `${actionLabel(e).toUpperCase()} · vs ${abbreviateTeamName(e.opponent)} · ${formatDay(e.playedAt, timeZone)} · ${periodName(e.periodNumber).toUpperCase()} ${clockText(e.clock)}${approx}`
}

export function buildMarkers(
  visible: readonly CareerActionRow[],
  pinId: number | null,
  timeZone = ACTION_MAP_TIME_ZONE,
): ActionMarker[] {
  const plotted = visible.filter(isPlotted)
  const hasPin = pinId !== null && plotted.some((e) => e.eventId === pinId)
  const base = plotted.map((e) => {
    const pinned = e.eventId === pinId
    const size = pinned ? MARKER_SIZE * PIN_SCALE : MARKER_SIZE
    const half = size / 2
    const x = Math.max(-100, Math.min(100, e.x ?? 0))
    const y = Math.max(-42.5, Math.min(42.5, e.y ?? 0))
    return {
      e,
      pinned,
      size,
      cx: Math.max(half, Math.min(VIEW_W - half, 1202.5 + x * 12)),
      cy: Math.max(half, Math.min(VIEW_H - half, 512.5 - y * 12)),
    }
  })
  const offsets = computeMarkerOffsets(base.map((b) => ({ id: b.e.eventId, cx: b.cx, cy: b.cy })))
  return base
    .map(({ e, pinned, size, cx, cy }) => {
      const off = offsets.get(e.eventId) ?? { dx: 0, dy: 0 }
      const opacity = hasPin && !pinned ? 0.28 : e.positionConfidence === 'extrapolated' ? 0.45 : 1
      return {
        id: e.eventId,
        type: e.eventType as MarkerType,
        role: e.role,
        cx,
        cy,
        dx: off.dx,
        dy: off.dy,
        size,
        pinned,
        opacity,
        tip: markerTip(e, timeZone),
      }
    })
    .sort((a, b) => Number(a.pinned) - Number(b.pinned) || Z_ORDER[a.type] - Z_ORDER[b.type])
}

/** Within a game: period, then latest clock first (design `chrono`). */
const chrono = (a: CareerActionRow, b: CareerActionRow) =>
  a.periodNumber - b.periodNumber || clockSeconds(b.clock) - clockSeconds(a.clock)
const newestGame = (a: CareerActionRow, b: CareerActionRow) =>
  b.playedAt.getTime() - a.playedAt.getTime() || b.matchId - a.matchId

export function buildGroups(
  visible: readonly CareerActionRow[],
  sort: SortMode,
  timeZone = ACTION_MAP_TIME_ZONE,
): ActionGroup[] {
  const row = (e: CareerActionRow): ActionRow => ({
    id: e.eventId,
    type: e.eventType as ActionType,
    role: e.role,
    actor: e.actorName ?? DASH,
    target: e.targetName ?? DASH,
    label: actionLabel(e),
    clock: clockText(e.clock),
    meta:
      sort === 'game'
        ? periodName(e.periodNumber)
        : `${periodName(e.periodNumber)} · vs ${abbreviateTeamName(e.opponent)} · ${formatDay(e.playedAt, timeZone)}`,
    plotted: isPlotted(e),
  })

  if (sort === 'game') {
    const byMatch = new Map<number, CareerActionRow[]>()
    for (const e of [...visible].sort(newestGame)) {
      const list = byMatch.get(e.matchId) ?? []
      list.push(e)
      byMatch.set(e.matchId, list)
    }
    return [...byMatch.entries()].flatMap(([matchId, list]) => {
      const first = list[0]
      if (first === undefined) return []
      const day = formatDay(first.playedAt, timeZone)
      return [
        {
          key: `game-${String(matchId)}`,
          label: `vs ${abbreviateTeamName(first.opponent)}`,
          sub: first.gameMode === null ? day : `${day} · ${first.gameMode}`,
          result: resultText(first),
          tone: tone(first.result),
          count: list.length,
          matchId,
          rows: [...list].sort(chrono).map(row),
        },
      ]
    })
  }
  if (sort === 'newest') {
    if (visible.length === 0) return []
    const rows = [...visible]
      .sort(
        (a, b) =>
          newestGame(a, b) ||
          b.periodNumber - a.periodNumber ||
          clockSeconds(a.clock) - clockSeconds(b.clock),
      )
      .map(row)
    return [
      {
        key: 'newest',
        label: 'All events',
        sub: 'newest first',
        result: null,
        tone: null,
        count: rows.length,
        matchId: null,
        rows,
      },
    ]
  }
  return ACTION_TYPES.flatMap((t) => {
    const list = visible.filter((e) => e.eventType === t)
    if (list.length === 0) return []
    const by = list.filter((e) => e.role === 'by').length
    return [
      {
        key: `type-${t}`,
        label: TYPE_PLURAL[t],
        sub: `${String(by)} by · ${String(list.length - by)} on`,
        result: null,
        tone: null,
        count: list.length,
        matchId: null,
        rows: [...list].sort((a, b) => newestGame(a, b) || chrono(a, b)).map(row),
      },
    ]
  })
}

export function buildPin(
  visible: readonly CareerActionRow[],
  pinId: number | null,
  timeZone = ACTION_MAP_TIME_ZONE,
): PinView | null {
  const e = pinId === null ? undefined : visible.find((v) => v.eventId === pinId)
  if (e === undefined) return null
  return {
    label: actionLabel(e),
    role: e.role,
    actor: e.actorName ?? DASH,
    target: e.targetName ?? DASH,
    clock: clockText(e.clock),
    period: periodName(e.periodNumber),
    opp: abbreviateTeamName(e.opponent),
    date: formatDay(e.playedAt, timeZone),
    mode: e.gameMode ?? DASH,
    result: resultText(e),
    tone: tone(e.result),
  }
}

/**
 * The event list shows its rows in batches (page weight: a player can have
 * hundreds of events). Keeps groups in order up to `limit` rows; a group cut
 * short keeps its full `count` in its header.
 */
export function limitGroups(
  groups: readonly ActionGroup[],
  limit: number,
): { groups: ActionGroup[]; hidden: number } {
  const out: ActionGroup[] = []
  let left = limit
  let total = 0
  for (const g of groups) {
    total += g.rows.length
    if (left <= 0) continue
    out.push(g.rows.length <= left ? g : { ...g, rows: g.rows.slice(0, left) })
    left -= Math.min(left, g.rows.length)
  }
  const shown = out.reduce((s, g) => s + g.rows.length, 0)
  return { groups: out, hidden: total - shown }
}

/** Position of an event's row across all groups (list order), or -1. */
export function rowIndexOf(groups: readonly ActionGroup[], eventId: number): number {
  let i = 0
  for (const g of groups) {
    for (const r of g.rows) {
      if (r.id === eventId) return i
      i++
    }
  }
  return -1
}
