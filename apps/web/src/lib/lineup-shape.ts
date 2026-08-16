/**
 * Lineup ladder shape per game mode, and the 3s slot re-key.
 *
 * The game sheet's lineup module renders one row per ladder slot. 6s uses the
 * full six-slot roster; 3s dresses three skaters in front of an AI goalie, so
 * it gets its own four-slot ladder.
 *
 * ── Why 3s uses neutral `W` / `D` keys ──────────────────────────────────────
 * The two sources disagree about the third 3s skater. The in-game pre-game
 * lobby labels the row `RW`; EA's Pro Clubs API reports the same player as
 * `defenseMen` on every one of the 56 3s matches in the DB. Rather than pick a
 * winner and render a label one source contradicts, the 3s ladder commits to
 * neither: `W` (a wing, no L/R) and `D` (a defender, no L/R). This mirrors the
 * existing generic `defenseMen → 'D'` entry in `position-colors.ts`, which was
 * added for exactly the same reason on the 6s box-score fallback.
 *
 * ── Why EA is the slot authority for 3s ─────────────────────────────────────
 * The pre-game lobby OCR snaps row anchors to six fixed y-centres tuned for a
 * 6s lobby (`row_grouping.py` LOBBY_CANONICAL_ROW_YS). A 3s lobby only has
 * three rows, so the bottom three slots get filled with whatever text lands
 * near them — in practice, players from the OPPONENT panel. Match 466's BGM
 * `LD` and `G` slots hold `BuckeyeBandit05` and `FROMETHEUS`, both opponents.
 *
 * So for 3s the EA stat row decides the slot, and each loadout snapshot is
 * attached to it by player IDENTITY rather than by its own position label.
 * Measured over the 20 3s matches that have loadout OCR, that identity tier
 * resolves 59/59 BGM rows — the BGM side loses nothing and sheds every
 * fabricated slot.
 *
 * The opponent side needs the second tier. Its rows are only ever read as
 * C/LW/RW (the leak runs left, into BGM's empty lower slots, never right), but
 * 9 of 41 fail the identity match purely on OCR spelling drift — EA's
 * `Slick Sl0th` read as `SlickSIoth`, `Mtl Eli` as `MtIEli`. Requiring identity
 * there would blank real players into CPU rows, so an unmatched row falls back
 * to its lobby label through `LOBBY_TO_3S_SLOT`, which admits only the three
 * slots a 3s lobby actually has.
 *
 * 6s is a strict passthrough — `rekeyLineupToLadder` returns its input array
 * unchanged, so nothing about the shipped 6s sheet moves.
 *
 * @module lineup-shape
 */

import type { LineupRow } from '@eanhl/db/queries'
import type { GameMode } from '@eanhl/db/schema'

/**
 * A slot on the lineup ladder. `C/LW/RW/LD/RD/G` are the 6s roster and match
 * the short codes the loadout OCR emits; `W`/`D` are the 3s ladder's neutral
 * wing/defence keys and are produced only by this module.
 */
export type LineupPositionKey = 'C' | 'LW' | 'RW' | 'LD' | 'RD' | 'G' | 'W' | 'D'

/** Canonical 6s ladder — also the fallback when the game mode is unknown. */
export const LADDER_6S: readonly LineupPositionKey[] = ['C', 'LW', 'RW', 'LD', 'RD', 'G']

/** 3s ladder — three skaters plus the (in practice always AI) goalie. */
export const LADDER_3S: readonly LineupPositionKey[] = ['C', 'W', 'D', 'G']

/**
 * The ladder for a match. `null` game mode falls back to 6s: an unclassified
 * EA game type code is far more likely to be a 6s variant than a 3s one, and
 * the six-slot ladder degrades more honestly (extra CPU rows) than a four-slot
 * one would (silently dropped skaters).
 */
export function ladderFor(gameMode: GameMode | null): readonly LineupPositionKey[] {
  return gameMode === '3s' ? LADDER_3S : LADDER_6S
}

/** EA's per-player position → 3s ladder slot. Unknown positions return null. */
const EA_TO_3S_SLOT: Readonly<Record<string, LineupPositionKey>> = {
  center: 'C',
  leftWing: 'W',
  rightWing: 'W',
  defenseMen: 'D',
  goalie: 'G',
}

/**
 * The pre-game lobby's OWN position label → 3s ladder slot, used only when a
 * row can't be identity-matched to an EA stat row.
 *
 * A 3s lobby renders exactly three rows and the parser reads them as C / LW /
 * RW. Across every 3s match in the DB that correspondence to EA's own labels
 * is stable — lobby `C` is EA `center`, `LW` is `leftWing`, and `RW` is always
 * EA `defenseMen` (EA has never once called a 3s skater `rightWing`).
 *
 * `LD` / `RD` / `G` are deliberately absent. A 3s lobby has no fourth, fifth or
 * sixth row, so anything the parser reports there was snapped in from the
 * neighbouring panel — those are exactly the slots where opponent players leak
 * onto the BGM ladder. An unmatched row in one of them is always fabricated and
 * is dropped. (A row that IS identity-matched still reaches any slot, including
 * `G`, via the EA map above — so a human 3s goalie would survive the day EA
 * starts reporting one.)
 */
const LOBBY_TO_3S_SLOT: Readonly<Record<string, LineupPositionKey>> = {
  C: 'C',
  LW: 'W',
  RW: 'D',
}

/**
 * Map an EA position string onto a 3s ladder slot. Returns null for 6s (whose
 * LD/RD split needs a per-side counter, handled by `buildLineupFromStats`) and
 * for any position EA doesn't report.
 *
 * `rightWing` is mapped even though no 3s match in the DB has ever reported
 * one — if EA ever does, a wing belongs in the wing slot, not dropped.
 */
export function eaPositionToSlot(
  gameMode: GameMode | null,
  eaPosition: string | null,
): LineupPositionKey | null {
  if (gameMode !== '3s') return null
  return EA_TO_3S_SLOT[eaPosition ?? ''] ?? null
}

/**
 * Minimal EA stat-row shape needed to resolve a slot — satisfied by both
 * `getPlayerMatchStats` and `getOpponentPlayerMatchStats` rows.
 */
export interface LadderStatSource {
  playerId?: number | null
  gamertag: string
  position: string | null
}

/**
 * Same normalization the lineup query and module already use to reconcile OCR
 * gamertags against EA's. Kept identical on purpose: extending it (e.g. a
 * `0`↔`O` fold) was measured to recover only 2 more opponent rows out of 49,
 * which does not justify diverging from the shared rule.
 */
function normalizeTag(tag: string | null | undefined): string {
  return (tag ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * How much loadout detail a row actually carries. Used only to break a tie
 * when two OCR rows resolve to the same player — the 6s-geometry lobby can
 * report one player twice (match 563 has `JoeyFlopfish` in both `LD` and
 * `RW`), and the richer of the two readings is the one worth keeping.
 */
function detailScore(row: LineupRow): number {
  let score = 0
  if (row.buildClassCanonical ?? row.buildClass) score++
  if (row.playerNumber !== null) score++
  if (row.xFactors.length > 0) score++
  if (row.attributes !== null && Object.keys(row.attributes).length > 0) score++
  if (row.playerNamePersona ?? row.playerNameSnapshot) score++
  if (row.heightText) score++
  return score
}

/**
 * Re-key OCR loadout rows onto the match's ladder.
 *
 * 6s (and unknown mode) is a passthrough — the same array reference comes back
 * out, because the OCR position label already IS the 6s slot.
 *
 * 3s resolves each row in two tiers:
 *
 *   1. Identity — match the row to an EA stat row for the same side (BGM by
 *      `player.id` first, then normalized gamertag; opponent by gamertag only,
 *      since opponent stat rows never carry a resolved `player_id`) and take
 *      the slot from EA's position. This is the authoritative tier and covers
 *      every BGM row on every 3s match in the DB.
 *   2. Lobby position — for rows OCR spelling drift left unmatched (`Slick
 *      Sl0th` read as `SlickSIoth`), fall back to the row's own lobby label via
 *      `LOBBY_TO_3S_SLOT`, which admits only the three slots a 3s lobby
 *      actually has. Without this tier those players vanish into CPU rows.
 *
 * Tier 1 always outranks tier 2 for the same slot, so a real identified player
 * can never be displaced by a fallback guess. Within a tier the row carrying
 * more loadout detail wins, which makes the result independent of input order.
 *
 * @param rows     Loadout-derived lineup rows for one side.
 * @param stats    EA per-player stat rows for the SAME side.
 * @param gameMode The match's game mode.
 * @param side     `'bgm'` enables the player-id match; `'opp'` is tag-only.
 */
export function rekeyLineupToLadder(
  rows: LineupRow[],
  stats: LadderStatSource[],
  gameMode: GameMode | null,
  side: 'bgm' | 'opp',
): LineupRow[] {
  if (gameMode !== '3s') return rows

  const byPlayerId = new Map<number, LadderStatSource>()
  const byTag = new Map<string, LadderStatSource>()
  for (const stat of stats) {
    if (side === 'bgm' && stat.playerId != null) byPlayerId.set(stat.playerId, stat)
    const tag = normalizeTag(stat.gamertag)
    if (tag && !byTag.has(tag)) byTag.set(tag, stat)
  }

  const bySlot = new Map<LineupPositionKey, { row: LineupRow; tier: number }>()
  for (const row of rows) {
    const stat =
      (side === 'bgm' && row.player ? byPlayerId.get(row.player.id) : undefined) ??
      byTag.get(normalizeTag(row.gamertagSnapshot ?? row.player?.gamertag))

    const tier = stat ? 1 : 2
    const slot = stat
      ? eaPositionToSlot(gameMode, stat.position)
      : (LOBBY_TO_3S_SLOT[row.position ?? ''] ?? null)
    if (slot === null) continue

    const held = bySlot.get(slot)
    if (held && held.tier < tier) continue
    if (held?.tier === tier && detailScore(held.row) >= detailScore(row)) continue
    bySlot.set(slot, { row: { ...row, position: slot }, tier })
  }

  return LADDER_3S.map((slot) => bySlot.get(slot)?.row).filter((row) => row !== undefined)
}
