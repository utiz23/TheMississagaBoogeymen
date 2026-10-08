/**
 * Depth chart placement (operator, 2026-10-08).
 *
 * A player gets a card at every position they play: their **main** position
 * (most games this title) plus every other position with at least
 * DEPTH_MIN_GAMES games, shown as **depth**. Each position lists its players by
 * games at that position (main before depth on a tie), so the line order is
 * the usage order. Forward lines, defense pairs and goalie slots grow to fit.
 *
 * Games per position come from EA's season split (lw/c/rw/d/goalie GP). A
 * player with games but no EA split falls back to locally recorded positions;
 * a player with no games this title (carried over or pinned) shows only at
 * their profile / EA favorite position.
 */

export type ChartPos = 'LW' | 'C' | 'RW' | 'D' | 'G'

export interface ChartMember {
  playerId: number
  gamesPlayed: number
  lwGp: number
  cGp: number
  rwGp: number
  dGp: number
  goalieGp: number
  favoritePosition: string | null
  preferredPosition: string | null
}

export interface ChartSlot<R> {
  player: R
  isDepth: boolean
  /** Games at this slot's position. */
  games: number
}

export interface BuiltDepthChart<R> {
  forwards: { lw: ChartSlot<R> | null; c: ChartSlot<R> | null; rw: ChartSlot<R> | null }[]
  defense: { ld: ChartSlot<R> | null; rd: ChartSlot<R> | null }[]
  goalies: ChartSlot<R>[]
}

export const DEPTH_MIN_GAMES = 3
const MIN_LINES = 4
const MIN_PAIRS = 3
const POSITION_ORDER: readonly ChartPos[] = ['C', 'LW', 'RW', 'D', 'G']

const FROM_EA: Readonly<Record<string, ChartPos>> = {
  leftWing: 'LW',
  center: 'C',
  rightWing: 'RW',
  defenseMen: 'D',
  goalie: 'G',
}

export function chartPos(position: string | null): ChartPos | null {
  return position === null ? null : (FROM_EA[position] ?? null)
}

type Counts = Record<ChartPos, number>

function countsFor(m: ChartMember, local: Partial<Counts> | undefined): Counts {
  const ea: Counts = { LW: m.lwGp, C: m.cGp, RW: m.rwGp, D: m.dGp, G: m.goalieGp }
  const skaterSplit = ea.LW + ea.C + ea.RW + ea.D
  if (skaterSplit > 0 || local === undefined) return ea
  return {
    LW: local.LW ?? 0,
    C: local.C ?? 0,
    RW: local.RW ?? 0,
    D: local.D ?? 0,
    G: Math.max(ea.G, local.G ?? 0),
  }
}

export function mainPosition(m: ChartMember, counts: Counts): ChartPos {
  const preferred = chartPos(m.preferredPosition)
  const favorite = chartPos(m.favoritePosition)
  const top = Math.max(...POSITION_ORDER.map((p) => counts[p]))
  if (top === 0) return preferred ?? favorite ?? 'C'
  const tied = POSITION_ORDER.filter((p) => counts[p] === top)
  return tied.find((p) => p === preferred) ?? tied.find((p) => p === favorite) ?? tied[0] ?? 'C'
}

export function buildDepthChart<R extends ChartMember>(
  rows: readonly R[],
  localCounts: ReadonlyMap<number, Partial<Counts>> = new Map(),
): BuiltDepthChart<R> {
  const byPos: Record<ChartPos, ChartSlot<R>[]> = { LW: [], C: [], RW: [], D: [], G: [] }
  for (const player of rows) {
    const counts = countsFor(player, localCounts.get(player.playerId))
    const main = mainPosition(player, counts)
    for (const pos of POSITION_ORDER) {
      if (pos !== main && counts[pos] < DEPTH_MIN_GAMES) continue
      byPos[pos].push({ player, isDepth: pos !== main, games: counts[pos] })
    }
  }
  for (const pos of POSITION_ORDER) {
    byPos[pos].sort(
      (a, b) =>
        b.games - a.games ||
        Number(a.isDepth) - Number(b.isDepth) ||
        b.player.gamesPlayed - a.player.gamesPlayed ||
        a.player.playerId - b.player.playerId,
    )
  }

  const lines = Math.max(MIN_LINES, byPos.LW.length, byPos.C.length, byPos.RW.length)
  const pairs = Math.max(MIN_PAIRS, Math.ceil(byPos.D.length / 2))
  return {
    forwards: Array.from({ length: lines }, (_, i) => ({
      lw: byPos.LW[i] ?? null,
      c: byPos.C[i] ?? null,
      rw: byPos.RW[i] ?? null,
    })),
    defense: Array.from({ length: pairs }, (_, i) => ({
      ld: byPos.D[i * 2] ?? null,
      rd: byPos.D[i * 2 + 1] ?? null,
    })),
    goalies: byPos.G,
  }
}
