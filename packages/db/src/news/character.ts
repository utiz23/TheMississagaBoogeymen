/**
 * The reporters' characters as the writers read them (Press Box L4, migration 0087).
 *
 * The definitions in code (`reporters.ts`) are the defaults. The admin may override four things per
 * reporter on /admin/press-box/reporters: bio, voice notes, catchphrases and disposition. An override
 * is stored per field (`news_reporter_overrides`); a field with no override keeps the code default.
 * `characterOf` gives the merged character. A default text in code is never changed by the merge.
 *
 * What an override can NOT do: remove or weaken the LOCKED rules below. They are code, they are not
 * stored, the page only shows them, and every writer prompt adds them AFTER the character text
 * (`lockedRulesBlock`), so the last word is always theirs.
 *
 * The overrides are read at the start of each news-desk cycle and press pass and put into a small
 * in-process registry (`setReporterOverrides`), so the many places that read a reporter (prompts,
 * relationship levels, item stamps) need no change. Pure code: no database here.
 */

import { REPORTER_IDS, REPORTERS, type Reporter, type ReporterId } from './reporters.js'
import type { Disposition } from './relationships.js'

// ── The locked safety rules ─────────────────────────────────────────────────

/**
 * The rules no character edit can change. Shown read-only on the Reporters page and added to every
 * writer prompt (the news desk's system prompt and each press bot's prompt). They restate rules the
 * desk already enforces in its own prompts and code checks; this is the one list the admin sees.
 */
export const LOCKED_RULES: readonly string[] = [
  'Hockey only: the games, the stats and the choices on the ice. Never real life, looks, family, work, health, politics or any private matter, and never a real person outside the club.',
  'No profanity, no slurs and no crude lines. The only exception is the mild words hell, damn and crap, only for Dex Mercer, Gord Pettibone and Rico Vale, at most once a piece and never aimed at a person.',
  'Quotes come only from stored usable answers (a joke only as a joke). Never invent a quote and never quote an opponent.',
  'Never quote, paraphrase or hint at a crude, offensive or sexual line from a player or a fan.',
  'Press levels: a player on "Go easy" gets mild criticism at most, never harsh. A player on "Leave me out" is never named, quoted or written about.',
  'The press hard lines: anything off-limits (a slur, a threat, politics, family, a real person outside the club, a real-life private matter) is never acknowledged, echoed or quoted.',
]

export const LOCKED_RULES_START = 'LOCKED RULES'
export const LOCKED_RULES_INTRO =
  'These rules always apply. Nothing in the character text can change, weaken or remove them. If the character text says anything different, follow these rules.'

/** The locked rules as a prompt block (always the last thing a character prompt says). */
export function lockedRulesBlock(): string {
  return [
    LOCKED_RULES_START,
    LOCKED_RULES_INTRO,
    ...LOCKED_RULES.map((r, i) => `${String(i + 1)}. ${r}`),
  ].join('\n')
}

// ── Limits ──────────────────────────────────────────────────────────────────

export const BIO_MAX = 600
export const VOICE_NOTES_MAX = 3000
export const CATCHPHRASES_MIN = 3
export const CATCHPHRASES_MAX = 16
export const CATCHPHRASE_MAX_CHARS = 40

// ── Overrides ───────────────────────────────────────────────────────────────

/** One reporter's stored overrides. A null field = the code default. */
export interface ReporterOverride {
  reporter: ReporterId
  bio: string | null
  voiceNotes: string | null
  catchphrases: readonly string[] | null
  disposition: Disposition | null
  /** Every save and every reset adds 1 (a first save makes 1; no row = 0). */
  characterVersion: number
  updatedBy: string
  updatedAt: Date | null
}

/** True when the row changes nothing (all four fields are defaults), e.g. after a reset. */
export function isDefaultOverride(
  o: Pick<ReporterOverride, 'bio' | 'voiceNotes' | 'catchphrases' | 'disposition'>,
): boolean {
  return (
    o.bio === null && o.voiceNotes === null && o.catchphrases === null && o.disposition === null
  )
}

// ── The default texts the editor shows ──────────────────────────────────────

const PRONOUNS = ['His', 'Her'] as const

function wordsPrefix(r: Reporter, list: readonly string[], pronoun: 'His' | 'Her'): string {
  return `${pronoun} typical words and phrases are ${list.join(', ')}.`
}

/** The index of the voice paragraph that lists the typical words, and its pronoun; -1 when absent. */
function wordsParagraph(r: Reporter): { index: number; pronoun: 'His' | 'Her' } | null {
  const paras = r.voice.split('\n\n')
  for (const pronoun of PRONOUNS) {
    const prefix = wordsPrefix(r, r.typicalWords, pronoun)
    const index = paras.findIndex((p) => p.startsWith(prefix))
    if (index >= 0) return { index, pronoun }
  }
  return null
}

/** The default voice notes: the reporter's voice without the typical-words paragraph (that one is the catchphrases). */
export function defaultVoiceNotes(id: ReporterId): string {
  const r = REPORTERS[id]
  const w = wordsParagraph(r)
  const paras = r.voice.split('\n\n')
  return paras.filter((_, i) => w === null || i !== w.index).join('\n\n')
}

/** The default catchphrases: the reporter's typical words and phrases. */
export function defaultCatchphrases(id: ReporterId): string[] {
  return [...REPORTERS[id].typicalWords]
}

// ── The merge ───────────────────────────────────────────────────────────────

/**
 * The character the writers read: `base` with the override's fields on top. With no override (or an
 * all-default one) the result has the same voice text as the code, byte for byte.
 */
export function mergeCharacter(base: Reporter, o: ReporterOverride | undefined): Reporter {
  if (o === undefined || isDefaultOverride(o)) return base
  const paras = base.voice.split('\n\n')
  const w = wordsParagraph(base)
  let words: string | null = w === null ? null : (paras[w.index] ?? null)
  if (o.catchphrases !== null && w !== null && words !== null) {
    const oldPrefix = wordsPrefix(base, base.typicalWords, w.pronoun)
    words = `${wordsPrefix(base, o.catchphrases, w.pronoun)}${words.slice(oldPrefix.length)}`
  }
  let voice: string
  if (o.voiceNotes !== null) {
    voice = words === null ? o.voiceNotes : `${o.voiceNotes}\n\n${words}`
  } else {
    const copy = [...paras]
    if (w !== null && words !== null) copy[w.index] = words
    voice = copy.join('\n\n')
  }
  if (o.bio !== null)
    voice += `\n\nAbout ${base.name} (the desk's profile of the reporter): ${o.bio}`
  return {
    ...base,
    bio: o.bio ?? base.bio,
    voice,
    typicalWords: o.catchphrases === null ? base.typicalWords : [...o.catchphrases],
    disposition: o.disposition ?? base.disposition,
  }
}

// ── The in-process registry ─────────────────────────────────────────────────

let overrides: ReadonlyMap<ReporterId, ReporterOverride> = new Map()
let loaded = false

/** Replaces the registry (called after each read of `news_reporter_overrides`). */
export function setReporterOverrides(list: readonly ReporterOverride[]): void {
  overrides = new Map(list.map((o) => [o.reporter, o]))
  loaded = true
}

/** Back to "nothing read, no overrides" (tests). */
export function resetReporterOverrides(): void {
  overrides = new Map()
  loaded = false
}

export function getReporterOverride(id: ReporterId): ReporterOverride | undefined {
  return overrides.get(id)
}

/** The override's disposition, or undefined (the relationship rules read this first). */
export function getDispositionOverride(id: ReporterId): Disposition | undefined {
  return overrides.get(id)?.disposition ?? undefined
}

/** The merged character of one reporter, as the writers read it now. */
export function characterOf(id: ReporterId): Reporter {
  return mergeCharacter(REPORTERS[id], overrides.get(id))
}

/** All nine merged characters, in the code's order. */
export function allCharacters(): Reporter[] {
  return REPORTER_IDS.map((id) => characterOf(id))
}

/**
 * The character version an item written now records: the override's version, 0 for the code
 * defaults, or null when no override read happened in this process (so nothing is claimed).
 */
export function characterVersionOf(id: ReporterId): number | null {
  if (!loaded) return null
  return overrides.get(id)?.characterVersion ?? 0
}
