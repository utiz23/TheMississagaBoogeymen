/**
 * The match page's lineup slots, as pure helpers: which row fills each ladder
 * slot and which box-score line belongs to it. Shared by the lineup module on
 * /games/[id] and the Discord lineup image, so the two can never disagree.
 * No `@/` imports — runs under node:test directly.
 */
import type { LineupRow } from '@eanhl/db/queries'
import type { GameMode } from '@eanhl/db/schema'
import type { LineupPositionKey } from './lineup-shape.ts'

// ─── Lookups ─────────────────────────────────────────────────────────────────

/**
 * Gamertag join key: lowercase, whitespace stripped. OCR loses spaces in
 * tags ("RAIDERS G7" is snapshotted as "RAIDERSG7"), so an exact-lower match
 * would strand real players without stats.
 */
export function normalizeLineupTag(tag: string): string {
  return tag.toLowerCase().replace(/\s+/g, '')
}

export function findStat<S extends { playerId?: number | null; gamertag: string }>(
  stats: S[],
  team: 'bgm' | 'opp',
  row: LineupRow,
): S | null {
  if (team === 'bgm' && row.player) {
    const byId = stats.find((s) => s.playerId === row.player?.id)
    if (byId) return byId
  }
  const tag = normalizeLineupTag(row.gamertagSnapshot ?? row.player?.gamertag ?? '')
  if (!tag) return null
  return stats.find((s) => normalizeLineupTag(s.gamertag) === tag) ?? null
}

// ─── Slot bucketing ───────────────────────────────────────────────────────────

const JUNK_GAMERTAG_TOKENS = new Set(['away', 'home', 'cpu', '?', '(unknown)'])

/**
 * OCR-noise guard: a row with no build, no jersey AND no X-Factors is almost
 * certainly noise — treat the slot as CPU. Box-score rows are authoritative
 * (they came from the final stats) and bypass the guard.
 */
function isRenderable(row: LineupRow): boolean {
  const tag = (row.gamertagSnapshot ?? '').trim()
  if (!tag || JUNK_GAMERTAG_TOKENS.has(tag.toLowerCase())) return false
  return (
    row.buildClass !== null ||
    row.buildClassCanonical !== null ||
    row.playerNumber !== null ||
    row.xFactors.length > 0
  )
}

export function bucketByPosition(
  rows: LineupRow[],
  variant: 'ocr' | 'boxScore',
  ladder: readonly LineupPositionKey[],
): Map<LineupPositionKey, LineupRow> {
  const map = new Map<LineupPositionKey, LineupRow>()
  for (const r of rows) {
    if (!r.position) continue
    if (variant === 'ocr' && !isRenderable(r)) continue
    const pos = r.position as LineupPositionKey
    if (ladder.includes(pos) && !map.has(pos)) map.set(pos, r)
  }
  return map
}

export interface LineupSlot<S> {
  position: LineupPositionKey
  row: LineupRow | null
  stat: S | null
}

/** One slot per ladder position, in ladder order — the match page's lineup. */
export function lineupSlots<S extends { playerId?: number | null; gamertag: string }>(
  rows: LineupRow[],
  variant: 'ocr' | 'boxScore',
  ladder: readonly LineupPositionKey[],
  stats: S[],
): LineupSlot<S>[] {
  const byPos = bucketByPosition(rows, variant, ladder)
  return ladder.map((position) => {
    const row = byPos.get(position) ?? null
    return { position, row, stat: row ? findStat(stats, 'bgm', row) : null }
  })
}

const DISPLAY_6S: readonly LineupPositionKey[] = ['LW', 'C', 'RW', 'LD', 'G', 'RD']
const DISPLAY_3S: readonly LineupPositionKey[] = ['W', 'C', 'D', 'G']

/** The Discord image's two-row order (forwards over defence, goalie in the middle). */
export function discordDisplayOrder(gameMode: GameMode | null): readonly LineupPositionKey[] {
  return gameMode === '3s' ? DISPLAY_3S : DISPLAY_6S
}
