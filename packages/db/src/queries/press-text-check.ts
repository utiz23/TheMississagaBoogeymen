/**
 * The save-time check for text an admin types into the Press Box that the writers will read
 * (takes, stances, a pinned storyline). Pure: no database, no model.
 *
 * It is the CODE layer of the desk's own hard lines, the same lists the news desk and the press
 * bots use (`apps/discord/src/news/crude.ts`: `slurHit`, `crudeHit`, with `STRONG_WORDS` of
 * `apps/discord/src/news/fact-check.ts`). The packages cannot import from `apps/discord`, so the
 * lists are copied here word for word; `__tests__/press-text-check.test.ts` reads those two source
 * files and fails when a list here differs from the desk's. A change to the desk's lists must be
 * made in both places (the test says so).
 *
 * What this check does NOT do: no model reads the text on save. The rest of the hard lines (a real
 * person outside the club, politics, family, a private matter) and "hockey only" are enforced by a
 * model in the writers' own prompts and checks; a typed text that slips past the code layer still
 * meets those at write time. The Press Box also refuses a text that names a "Leave me out" player
 * (`namesAny` in press-box-dossiers).
 */

/** Letters a person swaps in to dodge a filter: 4 -> a, 0 -> o, and so on. */
const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '@': 'a',
  $: 's',
}

/** Lower case, no accents, look-alike characters mapped, runs of one letter cut to two. */
export function normalizeForFilter(text: string): string {
  const base = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\p{L}\p{N}@$]+/gu, (token) =>
      /[a-z]/.test(token) ? token.replace(/[01345@$]/g, (c) => LEET[c] ?? c) : token,
    )
  return base.replace(/([a-z])\1{2,}/g, '$1$1')
}

function lettersOnly(text: string): string {
  return normalizeForFilter(text).replace(/[^a-z]/g, '')
}

export const SLUR_WORDS =
  /\b(n+i+g+(?:e+r+|a+h?|u+h)s?|f+a+g+(?:o+t+)?s?|k+i+k+e+s?|s+p+i+c+k?s?|c+h+i+n+k+s?|w+e+t+b+a+c+k+s?|t+r+a+n+n+(?:y|ie)s?|r+e+t+a+r+d+(?:e+d+)?s?|d+y+k+e+s?|g+o+o+k+s?|c+o+o+n+s?|b+e+a+n+e+r+s?)\b/

export const SPREAD_SLUR = /nigg(?:er|a)/

export const CRUDE_EXTRA =
  /\b(ass|asses|arse|arsehole|dumbass|jackass|dick|dicks|cock|cocks|piss\w*|slut\w*|whore\w*|douche\w*|cum|jizz\w*|tits?|boobs?|porn\w*|rape\w*|raping|molest\w*)\b/i

/** Always blocked in the desk's own output: strong words and slurs, for every reporter. */
export const STRONG_WORDS =
  /\b(fuck\w*|shit\w*|bullshit|bitch\w*|bastard\w*|asshole\w*|dickhead\w*|cunt\w*|goddamn\w*|motherf\w*|twat\w*|wank\w*|prick\w*|pissed|retard\w*|f[a@]g\w*)\b/i

/** True when `text` holds a slur. */
export function slurHit(text: string): boolean {
  const norm = normalizeForFilter(text)
  return SLUR_WORDS.test(norm) || SPREAD_SLUR.test(lettersOnly(text))
}

/** True when `text` has a slur, a strong word or another crude word (a mild word is allowed). */
export function crudeHit(text: string): boolean {
  if (slurHit(text)) return true
  const norm = normalizeForFilter(text)
  return STRONG_WORDS.test(text) || STRONG_WORDS.test(norm) || CRUDE_EXTRA.test(norm)
}

/** What can be wrong with a typed text. */
export type PressTextProblem = 'empty' | 'too_long' | 'crude' | 'digits'

/** Whitespace collapsed (newlines too), trimmed. */
export const collapseText = (raw: string): string => raw.replace(/\s+/g, ' ').trim()

/**
 * Checks one typed text: not empty, at most `max` characters (counted as characters, not UTF-16
 * units), no crude word or slur, and, when `noDigits`, no digit (the writers may only use numbers
 * from the fact sheet, so a number typed into a storyline would fail their own check). Returns the
 * collapsed text or the first problem.
 */
export function checkPressText(
  raw: string,
  opts: { max: number; allowEmpty?: boolean; noDigits?: boolean },
): { ok: true; text: string } | { ok: false; problem: PressTextProblem } {
  const text = collapseText(raw)
  if (text === '') {
    return opts.allowEmpty === true ? { ok: true, text } : { ok: false, problem: 'empty' }
  }
  if (Array.from(text).length > opts.max) return { ok: false, problem: 'too_long' }
  if (crudeHit(text)) return { ok: false, problem: 'crude' }
  if (opts.noDigits === true && /\d/.test(text)) return { ok: false, problem: 'digits' }
  return { ok: true, text }
}
