/**
 * Loadout game sheets → builds, for the Build Locker (spec Part 4; operator
 * decisions 2026-10-07). Pure: no database client.
 *
 * A build is a run of consecutive games with the same archetype and the same
 * set of three X-factors. Game-sheet OCR is not exact (a missed weight, a
 * misread attribute), so attribute values never split a build, and a sheet
 * missing its archetype or X-factors joins the build it sits in. Each field
 * shows the build's newest known value.
 */
import type { MatchResult } from '../schema/matches.js'
import type { XFactorTier } from '../schema/player-loadout.js'

export interface LoadoutXFactor {
  name: string
  tier: XFactorTier | null
}

/** One reviewed, non-CPU snapshot with its match. */
export interface LoadoutSheet {
  snapshotId: number
  matchId: number
  playedAt: Date
  capturedAt: Date
  result: MatchResult
  /** build_class_canonical, else the raw build_class. */
  archetype: string | null
  heightText: string | null
  weightLbs: number | null
  handedness: string | null
  /** Slot order; name = canonical, else raw. */
  xFactors: LoadoutXFactor[]
  attributes: Record<string, number | null>
}

export interface PlayerBuild {
  archetype: string | null
  heightText: string | null
  weightLbs: number | null
  handedness: string | null
  xFactors: LoadoutXFactor[]
  attributes: Record<string, number | null>
  gp: number
  wins: number
  /** Losses including DNF (site rule). */
  losses: number
  otl: number
  firstPlayed: Date
  lastPlayed: Date
}

const isEmpty = (s: LoadoutSheet) => s.archetype === null && s.xFactors.length === 0
const xfKey = (s: LoadoutSheet) =>
  s.xFactors
    .map((x) => x.name)
    .sort()
    .join('|')

/** Equal, or either side unknown. */
const compatible = <T>(a: T | null, b: T | null) => a === null || b === null || a === b

/** Newest known value among sheets ordered newest first. */
function newest<T>(sheets: readonly LoadoutSheet[], pick: (s: LoadoutSheet) => T | null): T | null {
  for (const s of sheets) {
    const v = pick(s)
    if (v !== null) return v
  }
  return null
}

function toBuild(run: readonly LoadoutSheet[]): PlayerBuild {
  const desc = [...run].reverse()
  const withXf = desc.find((s) => s.xFactors.length > 0)
  const xFactors = (withXf?.xFactors ?? []).map((x) => ({
    name: x.name,
    tier: x.tier ?? newest(desc, (s) => s.xFactors.find((o) => o.name === x.name)?.tier ?? null),
  }))
  const keys = new Set(desc.flatMap((s) => Object.keys(s.attributes)))
  const attributes: Record<string, number | null> = {}
  for (const k of keys) attributes[k] = newest(desc, (s) => s.attributes[k] ?? null)
  const first = run[0]
  const last = desc[0]
  if (first === undefined || last === undefined) throw new Error('empty build run')
  return {
    archetype: newest(desc, (s) => s.archetype),
    heightText: newest(desc, (s) => s.heightText),
    weightLbs: newest(desc, (s) => s.weightLbs),
    handedness: newest(desc, (s) => s.handedness),
    xFactors,
    attributes,
    gp: run.length,
    wins: run.filter((s) => s.result === 'WIN').length,
    losses: run.filter((s) => s.result === 'LOSS' || s.result === 'DNF').length,
    otl: run.filter((s) => s.result === 'OTL').length,
    firstPlayed: first.playedAt,
    lastPlayed: last.playedAt,
  }
}

/** Builds, newest first. */
export function groupBuilds(sheets: readonly LoadoutSheet[]): PlayerBuild[] {
  // One sheet per match: the latest captured non-empty one.
  const perMatch = new Map<number, LoadoutSheet>()
  for (const s of sheets) {
    if (isEmpty(s)) continue
    const held = perMatch.get(s.matchId)
    const later =
      held === undefined ||
      s.capturedAt.getTime() > held.capturedAt.getTime() ||
      (s.capturedAt.getTime() === held.capturedAt.getTime() && s.snapshotId > held.snapshotId)
    if (later) perMatch.set(s.matchId, s)
  }
  const ordered = [...perMatch.values()].sort(
    (a, b) => a.playedAt.getTime() - b.playedAt.getTime() || a.matchId - b.matchId,
  )

  const runs: LoadoutSheet[][] = []
  let run: LoadoutSheet[] = []
  let arch: string | null = null
  let xf: string | null = null
  for (const s of ordered) {
    const sArch = s.archetype
    const sXf = s.xFactors.length > 0 ? xfKey(s) : null
    if (run.length > 0 && compatible(arch, sArch) && compatible(xf, sXf)) {
      run.push(s)
      arch ??= sArch
      xf ??= sXf
      continue
    }
    if (run.length > 0) runs.push(run)
    run = [s]
    arch = sArch
    xf = sXf
  }
  if (run.length > 0) runs.push(run)
  return runs.map(toBuild).reverse()
}
