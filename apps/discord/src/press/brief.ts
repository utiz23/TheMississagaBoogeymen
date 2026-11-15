/**
 * The GM's private brief (task gm-ask-brief, 2026-11-14). A text the GM types for a reporter to
 * work from ("Ask him about his bad game ... Put the heat on him.") is a brief, never a post:
 * `/gm ask` without `exact`, and the topic of `/gm interview`. The code check here refuses a
 * written question that repeats the brief, sounds like an instruction to a reporter, or talks
 * about the player it is addressed to in the third person. A refusal goes back to the writer as a
 * problem (its normal rewrite); when every try fails, the caller uses an ordinary game question.
 *
 * The problem texts never quote the brief or the question (they reach logs and the rewrite).
 */

/** This many words in a row from the brief, in the question, is a copy. */
export const BRIEF_REPEAT_MIN_WORDS = 5

/** Lowercase words of a text, punctuation dropped (apostrophes inside words kept). */
function wordsOf(s: string): string[] {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w !== '')
}

/**
 * True when the question repeats the brief: a run of 5 or more words in a row that the brief also
 * has (case and punctuation ignored), or, for a brief shorter than 5 words, the whole brief as the
 * whole question.
 */
export function repeatsBrief(question: string, brief: string): boolean {
  const q = wordsOf(question)
  const b = wordsOf(brief)
  if (b.length === 0) return false
  if (b.length < BRIEF_REPEAT_MIN_WORDS) return q.join(' ') === b.join(' ')
  const runs = new Set<string>()
  for (let i = 0; i + BRIEF_REPEAT_MIN_WORDS <= b.length; i++) {
    runs.add(b.slice(i, i + BRIEF_REPEAT_MIN_WORDS).join(' '))
  }
  for (let i = 0; i + BRIEF_REPEAT_MIN_WORDS <= q.length; i++) {
    if (runs.has(q.slice(i, i + BRIEF_REPEAT_MIN_WORDS).join(' '))) return true
  }
  return false
}

/** Phrasing a GM uses to tell a reporter what to do. A question to a player never has it. */
const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /(?:^|[.!?:;]\s+)ask\b/iu,
  /\bask(?:ing)?\s+(?:him|her|them|the player|why|about|how|what|whether|if|when|where|who)\b/iu,
  /\bput(?:ting)?\s+(?:some\s+|the\s+|a\s+little\s+|more\s+|a\s+lot\s+of\s+)?(?:heat|pressure|fire)\s+on\b/iu,
  /\b(?:press|grill|push|pressure|challenge|confront)\s+(?:him|her|them)\b/iu,
  /\btell\s+(?:him|her|them)\b/iu,
  /\bmake\s+(?:him|her|them)\s+(?:explain|answer|own)\b/iu,
]

const THIRD_PERSON =
  /(?<![\p{L}\p{N}_'])(?:he|him|his|himself|she|her|hers|herself)(?![\p{L}\p{N}_'])/iu

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The player's name used as a third person ("Why did yoma go for that?", "yoma's game"). A name
 * that addresses the player (start of the text or a sentence, or after a comma, and then followed
 * by a comma, a colon or the end of a sentence) is fine.
 */
function namedInThirdPerson(text: string, name: string): boolean {
  const own = name.trim()
  if (own === '') return false
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(own)}(?![\\p{L}\\p{N}_])`, 'giu')
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    const before = text.slice(0, at)
    const after = text.slice(at + m[0].length)
    const addressedBefore = before.trim() === '' || /(?:[.!?:;,]|—|-)\s*$/u.test(before)
    const addressedAfter = after.trim() === '' || /^\s*[,:?!.;—-]/u.test(after)
    if (!(addressedBefore && addressedAfter)) return true
  }
  return false
}

/**
 * The code check for a question written from a private brief (`playerName` is the player being
 * asked). Empty when fine.
 */
export function briefProblems(question: string, brief: string, playerName: string): string[] {
  const problems: string[] = []
  if (repeatsBrief(question, brief)) {
    problems.push(
      `The question repeats the desk's private brief (${String(BRIEF_REPEAT_MIN_WORDS)} or more words in a row). Write it again in your own words.`,
    )
  }
  if (INSTRUCTION_PATTERNS.some((p) => p.test(question))) {
    problems.push(
      'The question sounds like an instruction to a reporter ("ask him", "ask why", "put the heat on"). Put the question itself to the player.',
    )
  }
  if (THIRD_PERSON.test(question) || namedInThirdPerson(question, playerName)) {
    problems.push(
      `The question talks about ${playerName} in the third person. Speak to ${playerName} as "you".`,
    )
  }
  return problems
}
