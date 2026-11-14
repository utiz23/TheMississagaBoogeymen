import type { PressLevel } from '@eanhl/db/news'

// The rules of the background questions (task background-b2). Pure: no I/O, no database import (the
// discord tests run without a database, and `@eanhl/db/queries` needs one at import time).
// The SQL that backs these rules is in `packages/db/src/queries/press-background-asks.ts`.
//
//   1. A teammate is only ever the subject of a question when the press level is "full":
//      "Go easy" and "Leave me out" teammates are never the subject (`eligibleSubjects`), and
//      "Leave me out" people get no background question at all (`mayAskBackground`).
//   2. A "Go easy" person is never asked a question for the bad side (`seedIsCritical`).
//   3. Where and when: `scrumMayAskBackground`, `interviewMayAskBackground`.

/** Scrums: at most one background question per person in this time. */
export const BACKGROUND_SCRUM_LIMIT_MS = 7 * 86_400_000

/** A fact is one short paragraph (the database check allows 1 to 400 characters). */
export const FACT_MAX = 400

/** Whitespace collapsed, 1 to `FACT_MAX` characters; else null (the same rule as the database's). */
export function normalizeFactText(raw: string): string | null {
  const t = raw.replace(/\s+/g, ' ').trim()
  return t === '' || Array.from(t).length > FACT_MAX ? null : t
}

export interface AskableQuestion {
  id: number
  part: string
  /** The bank text, `{name}` still in it. */
  question: string
  aboutTeammate: boolean
}

/** A person's press level allows background questions: everyone but "Leave me out". */
export const mayAskBackground = (level: PressLevel | null): boolean => level !== 'out'

/**
 * The teammates a teammate question may be about: members at press level "full" only, never the
 * person asked. "Go easy" and "Leave me out" are never the subject of a rating or a criticism.
 */
export function eligibleSubjects(
  roster: readonly { playerId: number; name: string; pressLevel: PressLevel }[],
  ownerId: number,
): { playerId: number; name: string }[] {
  return roster
    .filter((r) => r.pressLevel === 'full' && r.playerId !== ownerId)
    .map((r) => ({ playerId: r.playerId, name: r.name }))
    .sort((a, b) => a.playerId - b.playerId)
}

/** A deterministic index from a seed (the same seed gives the same pick). */
export function seededIndex(seed: number, length: number): number {
  let x = (seed ^ 0x9e3779b9) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0
  x = (x ^ (x >>> 16)) >>> 0
  return length <= 0 ? 0 : x % length
}

/**
 * A bank question that asks for weaknesses, mistakes or the bad side ("a classic bad game", "what
 * makes {name} worse", "most frustrating habit"). A "Go easy" person is never asked one: no
 * criticism of them at all. Conservative on purpose (a false hit only skips a question).
 */
const CRITICAL_SEED =
  /\b(bad|worse|worst|fail|fails|failed|failure|frustrat\w*|clash\w*|criticis\w*|weak\w*|mistake\w*|turnover\w*|slump\w*|unravel\w*|annoy\w*|lazy|floor|cold|nuts|wrong|rough|fault\w*|struggl\w*|disappear\w*|vanish\w*|liabilit\w*|hurt\w*|blame\w*)\b/i
export const seedIsCritical = (question: string): boolean => CRITICAL_SEED.test(question)

export interface BackgroundPick {
  question: AskableQuestion
  /** Set for a teammate question: the member it is about. */
  subject: { playerId: number; name: string } | null
}

/**
 * One question for one person: seeded, from the questions still open. A teammate question needs an
 * eligible subject; with none, only the other questions are offered. Null when nothing is left.
 */
export function pickBackgroundQuestion(args: {
  candidates: readonly AskableQuestion[]
  subjects: readonly { playerId: number; name: string }[]
  seed: number
  /** The person asked is at "Go easy": no question that asks for the bad side. */
  easy?: boolean
}): BackgroundPick | null {
  const pool = args.candidates.filter(
    (c) =>
      (!c.aboutTeammate || args.subjects.length > 0) &&
      !(args.easy === true && seedIsCritical(c.question)),
  )
  if (pool.length === 0) return null
  const question = pool[seededIndex(args.seed, pool.length)]!
  if (!question.aboutTeammate) return { question, subject: null }
  return { question, subject: args.subjects[seededIndex(args.seed + 1, args.subjects.length)]! }
}

/**
 * A scrum may ask a background question only when: the person is a member, the panel has at least
 * two questions and this is the LAST one (game questions come first), no background question went
 * to them in the last 7 days, the scrum has none yet, and the game was not lost by 3+ goals.
 */
export function scrumMayAskBackground(args: {
  isMember: boolean
  isTestScrum: boolean
  /** The 1-based number of the question about to be asked, and the panel's length. */
  questionNumber: number
  panelLength: number
  targetTotalKnown: boolean
  askedInThisScrum: number
  askedInLastWeek: number
  /** Goals lost by in this scrum's game (0 or negative for a win or a draw). */
  lostBy: number
}): boolean {
  return (
    args.isMember &&
    !args.isTestScrum &&
    args.targetTotalKnown &&
    args.panelLength >= 2 &&
    args.questionNumber === args.panelLength &&
    args.askedInThisScrum === 0 &&
    args.askedInLastWeek === 0 &&
    args.lostBy < 3
  )
}

/** The first planned question that may be the background one (the bigger picture, after the night and the season). */
export const INTERVIEW_BACKGROUND_FROM_POSITION = 5

/** An interview asks at most one, from this position on, only to a member. */
export function interviewMayAskBackground(args: {
  isMember: boolean
  position: number
  askedInThisInterview: number
}): boolean {
  return (
    args.isMember &&
    args.position >= INTERVIEW_BACKGROUND_FROM_POSITION &&
    args.askedInThisInterview === 0
  )
}

/** The bank text for a person as plain text (the writer rewrites it in the reporter's voice). */
export const seedQuestionText = (template: string, name: string): string =>
  template.split('{name}').join(name)
