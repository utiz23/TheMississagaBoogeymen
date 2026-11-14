import {
  INSULT_POINTS,
  REPORTER_IDS,
  feudAtLeast,
  type FeudLevel,
  type ReporterId,
} from '@eanhl/db/news'
import { crudeHit, slurHit } from '../news/crude.ts'
import { feudStoreOf } from './feud-store.ts'
import type { Insult } from './hard-lines.ts'
import type { PressDeps } from './pass.ts'

/**
 * Feuds in the press service (T5, item B). Points come from a message that
 * insults a reporter and is not off-limits; the level is read from the faded
 * points (`@eanhl/db/news` feuds.ts). Rules:
 * - "Go easy" players: points may be stored, but a level is never used for
 *   them (`feudLevel` says "none"): no feud content anywhere;
 * - "Leave me out" players: nothing at all, not even points (`recordInsult`
 *   does nothing);
 * - a store without feud methods, or a database error: no points, level
 *   "none" (a feud is only flavour, so it never fails closed into silence).
 */

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Press levels as the sheet and the roster say them. */
export type PressLevelNow = 'full' | 'easy' | 'out'

/** Adds the points of one insult. Never throws; nothing for a "Leave me out" player. */
export async function recordInsult(
  deps: PressDeps,
  args: {
    playerId: number
    reporter: ReporterId
    insult: Insult
    pressLevel: PressLevelNow
    /** Where it happened, for the log line (never the message). */
    where: string
  },
): Promise<void> {
  if (args.insult === 'none' || args.pressLevel === 'out') return
  const st = feudStoreOf(deps.store)
  if (st === null) return
  const points = INSULT_POINTS[args.insult]
  try {
    await st.addFeudPoints({
      playerId: args.playerId,
      reporter: args.reporter,
      points,
      at: deps.now(),
    })
    deps.log(
      `[press] feud: ${args.where}: ${args.reporter} +${String(points)} (${args.insult} insult)`,
    )
  } catch (err: unknown) {
    deps.log(`[press] feud: ${args.where}: points not saved (${reason(err)})`)
  }
}

/**
 * The reporters this player is in a feud with, strongest first. Empty for a
 * "Go easy" or "Leave me out" player (their feud content is never used), and
 * when the store or the read fails.
 */
export async function feudsFor(
  deps: PressDeps,
  playerId: number,
  pressLevel: PressLevelNow,
): Promise<{ reporter: ReporterId; level: Exclude<FeudLevel, 'none'> }[]> {
  if (pressLevel !== 'full') return []
  const st = feudStoreOf(deps.store)
  if (st === null) return []
  try {
    const rows = await st.listFeuds({ now: deps.now(), playerIds: [playerId] })
    return rows.map((r) => ({
      reporter: r.reporter,
      level: r.level as Exclude<FeudLevel, 'none'>,
    }))
  } catch (err: unknown) {
    deps.log(`[press] feud: level not read for player ${String(playerId)} (${reason(err)})`)
    return []
  }
}

/** The level between one player and one reporter ("none" when there is none to use). */
export async function feudLevel(
  deps: PressDeps,
  playerId: number,
  reporter: ReporterId,
  pressLevel: PressLevelNow,
): Promise<FeudLevel> {
  const all = await feudsFor(deps, playerId, pressLevel)
  return all.find((f) => f.reporter === reporter)?.level ?? 'none'
}

/** The reporters with a feud of at least "feud" level: they are likelier on the player's panel. */
export function panelFeudReporters(
  feuds: readonly { reporter: ReporterId; level: FeudLevel }[],
): ReporterId[] {
  return feuds.filter((f) => feudAtLeast(f.level, 'feud')).map((f) => f.reporter)
}

// ── Messages that are not answers (code only, no model call) ────────────────

/**
 * Names a message may use for a reporter. Long ones also match inside a
 * hashtag ("#FuckMaraQuill"); short ones only as a whole word.
 */
const ALIASES: Readonly<Record<ReporterId, { loose: readonly string[]; word: readonly string[] }>> =
  {
    barlow: { loose: ['barlow'], word: ['wade'] },
    voss: { loose: [], word: ['voss', 'talia'] },
    mercer: { loose: ['mercer'], word: ['dex'] },
    halberd: { loose: ['halberd'], word: ['june'] },
    vale: { loose: [], word: ['vale', 'rico'] },
    quill: { loose: ['quill'], word: ['mara'] },
    rink: { loose: [], word: ['father rink'] },
    pettibone: { loose: ['pettibone'], word: ['gord'] },
    bergstrom: { loose: ['bergstrom'], word: ['lyle'] },
  }

/** Rude words that need no swearing ("idiot", "useless"); strong words come from `crudeHit`. */
const RUDE =
  /\b(idiot|stupid|useless|clown|trash|garbage|moron|dumb|loser|pathetic|terrible|worst|hate you|shut up|suck|sucks|joke of a)\b/i

/**
 * A message in a press thread that is not an answer: does it insult a named
 * reporter? Code only (no model call, no cost): a reporter name, and a rude or
 * crude word. A slur never counts (such a message is off-limits and gets no
 * reaction). Returns the reporter and the strength, or null.
 */
export function codeInsult(
  text: string,
): { reporter: ReporterId; insult: Exclude<Insult, 'none'> } | null {
  if (slurHit(text)) return null
  const strong = crudeHit(text)
  if (!strong && !RUDE.test(text)) return null
  const lower = text.toLowerCase()
  for (const id of REPORTER_IDS) {
    const a = ALIASES[id]
    const hit =
      a.loose.some((n) => lower.includes(n)) ||
      a.word.some((n) => new RegExp(`(?<![\\p{L}\\p{N}])${n}(?![\\p{L}\\p{N}])`, 'iu').test(lower))
    if (hit) return { reporter: id, insult: strong ? 'strong' : 'mild' }
  }
  return null
}
