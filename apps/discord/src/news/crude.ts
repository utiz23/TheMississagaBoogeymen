import type { NewsFacts } from '@eanhl/db/news'
import { STRONG_WORDS, withoutSheetNames } from './fact-check.ts'

/**
 * Crude language in code (T5): the hard line (slurs) and rule C (no crude
 * quotes). Two lists, both short on purpose: the AI judge covers what a word
 * list cannot ("a bunch of slaves"); this is the cheap code layer that runs
 * first and that never needs a model call.
 *
 * - `slurHit`: a slur. This is a hard line: a message with a slur gets no
 *   reaction at all (press/hard-lines.ts).
 * - `crudeHit`: a slur, a strong word (`STRONG_WORDS` of the desk) or another
 *   crude word. Mild words (hell, damn, crap) are not crude: the reporters
 *   who swear mildly use them, and a player's mild word was always allowed in
 *   a quote (ruling 56).
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

/**
 * Lower case, no accents, look-alike characters mapped, runs of one letter cut
 * to two. A look-alike is mapped only inside a word that also has a letter, so
 * a plain number ("455") never turns into a word.
 */
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

/** The same text with only letters (so "n.i.g.g.e.r" and "n i g g e r" become one run). */
function lettersOnly(text: string): string {
  return normalizeForFilter(text).replace(/[^a-z]/g, '')
}

/**
 * Obvious slurs, as word patterns on the normalised text. Kept compact:
 * the AI check covers the rest. Word-bounded, so a name that merely contains
 * the letters is not hit.
 */
const SLUR_WORDS =
  /\b(n+i+g+(?:e+r+|a+h?|u+h)s?|f+a+g+(?:o+t+)?s?|k+i+k+e+s?|s+p+i+c+k?s?|c+h+i+n+k+s?|w+e+t+b+a+c+k+s?|t+r+a+n+n+(?:y|ie)s?|r+e+t+a+r+d+(?:e+d+)?s?|d+y+k+e+s?|g+o+o+k+s?|c+o+o+n+s?|b+e+a+n+e+r+s?)\b/

/** The n-word and its stem, also with the letters spread out ("n i g g e r"). */
const SPREAD_SLUR = /nigg(?:er|a)/

/** True when `text` holds a slur (also leet speak and spread-out letters for the n-word). */
export function slurHit(text: string): boolean {
  const norm = normalizeForFilter(text)
  return SLUR_WORDS.test(norm) || SPREAD_SLUR.test(lettersOnly(text))
}

/** Crude words beyond the desk's strong words (STRONG_WORDS). */
const CRUDE_EXTRA =
  /\b(ass|asses|arse|arsehole|dumbass|jackass|dick|dicks|cock|cocks|piss\w*|slut\w*|whore\w*|douche\w*|cum|jizz\w*|tits?|boobs?|porn\w*|rape\w*|raping|molest\w*)\b/i

/** True when `text` has a slur, a strong word or another crude word. */
export function crudeHit(text: string): boolean {
  if (slurHit(text)) return true
  const norm = normalizeForFilter(text)
  return STRONG_WORDS.test(text) || STRONG_WORDS.test(norm) || CRUDE_EXTRA.test(norm)
}

/** Same, for a text that may print sheet names: a teammate's name that holds a crude word never counts. */
export function crudeHitOutsideNames(text: string, facts: NewsFacts): boolean {
  return crudeHit(withoutSheetNames(text, facts))
}

export const CRUDE_PROBLEM =
  'The text has crude language, a swear word or a slur. Rewrite it clean; never quote or hint at such words.'
