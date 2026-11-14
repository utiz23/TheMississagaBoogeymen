import {
  REPORTER_IDS,
  mulberry32,
  planBuzz,
  weightedPick,
  type NewsFacts,
  type ReporterId,
} from '@eanhl/db/news'

/**
 * Interview rules (pure, no I/O): the windows and limits, which reporter
 * interviews, who gets the automatic offer, how many questions, when a
 * follow-up may replace a planned question, when the player says it is over,
 * and when an article is written. Operator rules of 2026-11-13 (task T3).
 */

/** The offer waits this long for Accept; ignoring it is a no (no reminder). */
export const INTERVIEW_OFFER_MS = 30 * 60_000
/** After a question, the player has this long to answer. */
export const INTERVIEW_ANSWER_MS = 30 * 60_000
/** Items in an interview: planned questions and the follow-up together. */
export const INTERVIEW_QUESTIONS = 7
/** At most this many follow-ups; each one replaces a planned question. */
export const INTERVIEW_MAX_FOLLOWUPS = 1
/** `/interview`: at most one per player in this time. */
export const INTERVIEW_PLAYER_LIMIT_MS = 7 * 86_400_000
/** Automatic offers: at most one for the club in this time. */
export const INTERVIEW_AUTO_LIMIT_MS = 7 * 86_400_000
/** The questions use the player's latest night in this time; older ⇒ no interview. */
export const INTERVIEW_NIGHT_LOOKBACK_MS = 30 * 86_400_000
/**
 * A night recap newer than this can start an automatic offer: the offer comes
 * right after the night, never hours later (operator, 2026-11-14: a restart at
 * 1 am offered on a recap from 1.5 hours before).
 */
export const INTERVIEW_AUTO_SOURCE_MS = 30 * 60_000
/** The article needs at least this many usable or joke answers. */
export const INTERVIEW_ARTICLE_MIN_ANSWERS = 3
/** Father Rink's weight in the rotation (every other reporter has 1): rare. */
export const INTERVIEW_RINK_WEIGHT = 0.2
/** T9: a reporter who is a fan of the player is this many times likelier to be the interviewer. */
export const INTERVIEW_FAVOUR_WEIGHT = 2

/**
 * The interviewer. Never a disabled reporter; never the last interview's
 * reporter unless that is the only one left. Weights: 1 each, Father Rink
 * `INTERVIEW_RINK_WEIGHT`; x2 for a reporter with a take on the player; x2 for a reporter who is a fan of the player (T9).
 * Seeded: the same seed gives the same reporter. Null when every reporter is off.
 */
export function chooseInterviewReporter(args: {
  seed: number
  disabled: readonly ReporterId[]
  lastReporter: ReporterId | null
  takeReporters: readonly ReporterId[]
  /** T9: reporters who are a fan of the player ("fan" or above): x2 each, like a take. */
  favourReporters?: readonly ReporterId[]
}): ReporterId | null {
  const allowed = REPORTER_IDS.filter((id) => !args.disabled.includes(id))
  const fresh = allowed.filter((id) => id !== args.lastReporter)
  const pool = fresh.length > 0 ? fresh : allowed
  if (pool.length === 0) return null
  const choices = pool.map((id): [ReporterId, number] => {
    let weight = id === 'rink' ? INTERVIEW_RINK_WEIGHT : 1
    if (args.takeReporters.includes(id)) weight *= 2
    if (args.favourReporters?.includes(id) === true) weight *= INTERVIEW_FAVOUR_WEIGHT
    return [id, weight]
  })
  return weightedPick(choices, mulberry32(args.seed >>> 0))
}

/** The night's story for an automatic offer: the player and why (code-built, not shown as fact). */
export interface AutoStory {
  playerId: number
  name: string
  /** 3 = set a club record in a historic game, 2 = a milestone, 1 = played a historic game. */
  strength: 1 | 2 | 3
  why: string
}

/**
 * The strongest story of a night sheet for an automatic offer, or null:
 * first a new club record in a "Historic" game (its holder), then a
 * milestone (the sheet's order is the importance order), then the best
 * player (star, then points) of a "Historic" game. Only players in
 * `facts.people` (never "Leave me out", a guest or an AI goalie) for whom
 * `eligible` is true (linked to Discord).
 */
export function pickAutoStory(
  facts: NewsFacts,
  eligible: (playerId: number) => boolean,
): AutoStory | null {
  const people = new Map(facts.people.map((p) => [p.playerId, p]))
  const ok = (id: number): boolean => people.has(id) && eligible(id)
  const historic = facts.games.filter((g) => planBuzz(g, facts).level === 'historic')

  for (const g of historic) {
    for (const r of g.newRecords) {
      const line = g.players.find((p) => p.name === r.name)
      if (line !== undefined && ok(line.playerId)) {
        return {
          playerId: line.playerId,
          name: line.name,
          strength: 3,
          why: `a new club record (${r.stat})`,
        }
      }
    }
  }
  for (const m of facts.milestones) {
    if (ok(m.playerId)) {
      return {
        playerId: m.playerId,
        name: m.name,
        strength: 2,
        why: `a milestone (${String(m.value)} ${m.stat})`,
      }
    }
  }
  for (const g of historic) {
    const best = [...g.players]
      .filter((p) => ok(p.playerId))
      .sort(
        (a, b) => (a.star ?? 4) - (b.star ?? 4) || b.points - a.points || a.playerId - b.playerId,
      )[0]
    if (best !== undefined) {
      return { playerId: best.playerId, name: best.name, strength: 1, why: 'a historic game' }
    }
  }
  return null
}

/** Items asked so far (planned questions and follow-ups). */
export function itemsAsked(i: { questionsAsked: number; followupsAsked: number }): number {
  return i.questionsAsked + i.followupsAsked
}

/**
 * A follow-up may replace a planned question: at most `INTERVIEW_MAX_FOLLOWUPS`,
 * never right after a follow-up, and only while items are left.
 */
export function interviewFollowUpAllowed(i: {
  questionsAsked: number
  followupsAsked: number
  askingFollowup: boolean
}): boolean {
  return (
    !i.askingFollowup &&
    i.followupsAsked < INTERVIEW_MAX_FOLLOWUPS &&
    itemsAsked(i) < INTERVIEW_QUESTIONS
  )
}

/** Another planned question is due (items left). */
export function moreQuestions(i: { questionsAsked: number; followupsAsked: number }): boolean {
  return itemsAsked(i) < INTERVIEW_QUESTIONS
}

const STOP_WORDS_MAX = 8
const STOP_RE =
  /\b(i'?m done|i am done|we'?re done|we are done|that'?s (it|all|enough)|no more( questions)?|enough( questions)?|(this|the) interview'?s? (is )?over|it'?s over|i'?m out|gotta go|got to go|end (the |this )?interview|stop( the interview)?)\b/i

/**
 * The player says the interview is over: a short answer (at most 8 words)
 * with a stop phrase ("I'm done", "that's it", "no more questions"). A longer
 * answer is a real answer, even when it has such words.
 */
export function saysItIsOver(answer: string): boolean {
  const words = answer
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '')
  return words.length > 0 && words.length <= STOP_WORDS_MAX && STOP_RE.test(answer)
}

/** The article is written only with at least 3 usable or joke answers. */
export function articleAllowed(
  answers: readonly { usability: 'usable' | 'joke' | 'unusable' }[],
): boolean {
  return answers.filter((a) => a.usability !== 'unusable').length >= INTERVIEW_ARTICLE_MIN_ANSWERS
}

/** A planned question when the writer fails or the budget is spent: hockey only, by position. */
export function fallbackInterviewQuestion(
  position: number,
  name: string,
  /** T7: a person who did not play is asked about the team, never about "your game". */
  bench?: 'bench' | 'coach',
): string {
  const list =
    bench !== undefined
      ? [
          `Thanks for sitting down, ${name}. How did the team look to you tonight?`,
          `What stood out about the way the team played, ${name}?`,
          `Which stretch of the game worked best for the team, ${name}?`,
          `What would you change in the team's plan, ${name}?`,
          `How would you describe the mood of the team, ${name}?`,
          `What does this club need to do better as a group?`,
          `Last one, ${name}: what should the team chase for the rest of the season?`,
        ]
      : [
          `Thanks for sitting down, ${name}. How do you feel about your game lately?`,
          `What has been working for you on the ice this season, ${name}?`,
          `What part of your game do you want to sharpen next?`,
          `Which recent game stands out for you, and why?`,
          `How would you describe your role on this team, ${name}?`,
          `What does this club need to do better as a group?`,
          `Last one, ${name}: what are you chasing for the rest of the season?`,
        ]
  return list[Math.min(Math.max(position, 1), list.length) - 1]!
}

/** The reporter's polite close when the player stops or the time runs out. */
export const interviewClosing = (name: string): string =>
  `That's where we'll leave it. Thanks for your time, ${name}.`
