import type { NewsPerson, NewsTake, NewsTakeSpread, PlayerLabel } from './contract.js'
import { REPORTER_IDS, type ReporterId } from './reporters.js'

/**
 * Reporter takes (C3a.6, spec §12.19): pure helpers shared by the web route
 * (which builds the sheet's `takes`) and the news service (which decides
 * which takes are due). The take texts are GM-only lore: they never go into
 * `facts`, a public page, a feed or a Discord payload.
 */

/** A take is voiced at most about once a week per player. */
export const TAKE_REUSE_DAYS = 7
/** The data softens or hardens a take when a label holds in this many of the last games. */
export const TAKE_LABEL_GAMES = 5
export const TAKE_LABEL_MIN = 3
export const TAKE_INTENSITY_MIN = -2
export const TAKE_INTENSITY_MAX = 2

const DAY_MS = 86_400_000

/**
 * The take's intensity after the data: "big for him" (points) in 3 or more
 * of the player's last 5 games ⇒ one softer (the critics grudgingly back
 * off); "quiet for him" in 3 or more ⇒ one harder. Clamped to -2..+2.
 * `labels` = the player's points labels of his last games, oldest first.
 */
export function adjustTakeIntensity(intensity: number, labels: readonly PlayerLabel[]): number {
  const last = labels.slice(-TAKE_LABEL_GAMES)
  const big = last.filter((l) => l === 'big for him').length
  const quiet = last.filter((l) => l === 'quiet for him').length
  const moved = intensity + (big >= TAKE_LABEL_MIN ? -1 : 0) + (quiet >= TAKE_LABEL_MIN ? 1 : 0)
  return Math.max(TAKE_INTENSITY_MIN, Math.min(TAKE_INTENSITY_MAX, moved))
}

/** A stored take as the route reads it (the `news_reporter_takes` row). */
export interface TakeRowInput {
  id: number
  reporter: string
  playerId: number
  take: string
  spread: string
  critics: unknown
  defender: string | null
  dataAngle: string | null
  active: boolean
  intensity: number
}

const isReporter = (r: unknown): r is ReporterId =>
  typeof r === 'string' && (REPORTER_IDS as readonly string[]).includes(r)

/**
 * The sheet's takes: active takes on players named on the sheet only (a
 * Leave me out player is never in `people`, so has none), a Go easy player's
 * take marked `mild` and never above intensity 0. `labelsOf(playerId)` gives
 * the player's last points labels for `adjustTakeIntensity`.
 */
export function takesForSheet(
  rows: readonly TakeRowInput[],
  people: readonly NewsPerson[],
  labelsOf: (playerId: number) => readonly PlayerLabel[] = () => [],
): NewsTake[] {
  const out: NewsTake[] = []
  for (const r of rows) {
    if (!r.active || !isReporter(r.reporter)) continue
    const person = people.find((p) => p.playerId === r.playerId)
    if (person === undefined) continue
    const critics = (Array.isArray(r.critics) ? r.critics : []).filter(isReporter)
    const mild = person.pressLevel === 'easy'
    const intensity = adjustTakeIntensity(r.intensity, labelsOf(r.playerId))
    out.push({
      id: r.id,
      reporter: r.reporter,
      critics: critics.filter((c) => c !== r.reporter),
      defender: isReporter(r.defender) && r.defender !== r.reporter ? r.defender : null,
      playerId: r.playerId,
      player: person.name,
      take: r.take,
      spread: (['some', 'a few', 'most'] as const).includes(r.spread as NewsTakeSpread)
        ? (r.spread as NewsTakeSpread)
        : 'some',
      dataAngle: r.dataAngle,
      intensity: mild ? Math.min(0, intensity) : intensity,
      mild,
    })
  }
  return out
}

/** Every reporter who may voice the take: its holder and the critics. */
export function takeCritics(t: NewsTake): ReporterId[] {
  return [t.reporter, ...t.critics.filter((c) => c !== t.reporter)]
}

/**
 * The takes that are due. The weekly limit is per PLAYER (spec §12.19: "at
 * most about once a week per player"): a player with ANY take voiced in the
 * last `TAKE_REUSE_DAYS` days gets none; otherwise one take per player (the
 * oldest id), so a piece never gets two takes on the same player.
 */
export function dueTakes(
  takes: readonly NewsTake[],
  lastUsed: ReadonlyMap<number, Date>,
  now: Date,
): NewsTake[] {
  const cutoff = now.getTime() - TAKE_REUSE_DAYS * DAY_MS
  const recent = new Set<number>()
  for (const t of takes) {
    const used = lastUsed.get(t.id)
    if (used !== undefined && used.getTime() > cutoff) recent.add(t.playerId)
  }
  const players = new Set<number>()
  const out: NewsTake[] = []
  for (const t of [...takes].sort((a, b) => a.id - b.id)) {
    if (recent.has(t.playerId) || players.has(t.playerId)) continue
    players.add(t.playerId)
    out.push(t)
  }
  return out
}
