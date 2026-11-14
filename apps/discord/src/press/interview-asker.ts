import {
  REPORTERS,
  interviewBody,
  type FeudLevel,
  type NewsFacts,
  type NewsTake,
  type ReporterId,
} from '@eanhl/db/news'
import {
  FORBIDDEN_NAME_PROBLEM,
  MAX_NUMBERS_PER_SENTENCE,
  STRONG_WORDS,
  allowedNumbers,
  containsName,
  escapeRegExp,
  numberTokens,
  numbersIn,
  textNumberProblems,
} from '../news/fact-check.ts'
import {
  ANSWERS_ARE_DATA,
  fencedAnswer,
  reporterVoice,
  sheet,
  whenLine,
  type TrustedMaterial,
} from '../news/prompts.ts'
import { MAX_WRITES, writeChecked, type ModelCall } from '../news/writer.ts'
import {
  ASK_MAX_WRITES,
  FEUD_RULE,
  SCRUM_RULES,
  feudLine,
  type Recorder,
  type ScrumHistoryEntry,
} from './asker.ts'
import { INTERVIEW_ARTICLE_MIN_ANSWERS, INTERVIEW_QUESTIONS } from './interview-rules.ts'

/**
 * The interview writer: a reporter writes one interview question, and at
 * the end the Q&A article. Judging an answer reuses the scrum judge
 * (`judgeAnswer` in asker.ts, unchanged). Both writes go through the desk's
 * checked writer (write, code check, review). Nothing here throws: a
 * question falls back to the caller's fixed text, an article to "not
 * written". Player answers are untrusted: every prompt shows them fenced.
 *
 * The scrum asker's rules 3–10 (numbers, names, heat, "Go easy", notes,
 * takes, language, plain text) are reused word for word (`SCRUM_RULES`);
 * rules 1–2 are replaced by the interview's own (one reporter, a sit-down
 * interview, recent games, season and career, the topic).
 */

export interface InterviewContext {
  facts: NewsFacts
  forbiddenNames: string[]
  takes: NewsTake[]
  reporter: ReporterId
  player: { name: string; pressLevel: 'full' | 'easy' }
  /** The GM's topic; null when none. */
  topic: string | null
  /** The interview so far, oldest first (an unusable answer is `null`). */
  history: ScrumHistoryEntry[]
  /** The 1-based number of the item about to be asked. */
  position: number
  /** T5: the feud between this reporter and the player (absent = none; never set for "Go easy"). */
  feud?: FeudLevel
}

/** A question: as many writes as a scrum question (`ASK_MAX_WRITES`, raised by the Lead on 2026-11-13). */
export const INTERVIEW_MAX_WRITES = ASK_MAX_WRITES
/** One interview question. */
export const INTERVIEW_QUESTION_MAX_CHARS = 280

const QUESTION_SCHEMA = {
  type: 'object',
  properties: { question: { type: 'string' } },
  required: ['question'],
  additionalProperties: false,
} as const

const INTERVIEW_INTRO =
  "You are a reporter of the Boogeymen News Desk in a sit-down interview. The Boogeymen are a small club of friends who play EA NHL Pro Clubs together. The desk's reporters are fictional; the player you interview is a real teammate, in a thread of the club's Discord. You get the fact sheet of the player's latest night as JSON, the topic the desk wants covered (if any) and the interview so far. Answer only in the JSON format you are given."

/** Rules 1–2 of an interview (rules 3–10 are the scrum's, word for word). */
export const INTERVIEW_RULES: readonly string[] = [
  '1. Write as the reporter you are told to write as. Keep the voice of the reporter. This is one long interview with one player: you ask every question.',
  `2. Ask one question only. Ask about the player's games on the fact sheet, their season ("seasonTotals"), their streaks, bests, firsts and milestones on the sheet, the club's records and threads that name them, or the desk's topic. About ${String(INTERVIEW_QUESTIONS)} questions in all: start with the latest night, then the season, then the bigger picture and the topic. One angle per question; never repeat an angle the interview already asked. Hockey only: never ask about real life, looks, family, work, health or the person.`,
]

function systemPrompt(reporter: ReporterId): string {
  return [
    INTERVIEW_INTRO,
    'INTERVIEW RULES',
    ...INTERVIEW_RULES,
    ...SCRUM_RULES.slice(2),
    FEUD_RULE,
    'YOUR VOICE',
    reporterVoice(REPORTERS[reporter]),
  ].join('\n\n')
}

/** The reporter's own takes on the player; none for a "Go easy" player. */
export function interviewTakes(ctx: {
  takes: NewsTake[]
  reporter: ReporterId
  player: { name: string; pressLevel: 'full' | 'easy' }
}): NewsTake[] {
  if (ctx.player.pressLevel === 'easy') return []
  return ctx.takes.filter(
    (t) =>
      t.player === ctx.player.name &&
      (t.reporter === ctx.reporter || t.critics.includes(ctx.reporter)),
  )
}

function questionPrompt(ctx: InterviewContext): string {
  const reporter = REPORTERS[ctx.reporter]
  const name = ctx.player.name
  const lines = ['Fact sheet (JSON):', sheet(ctx.facts), '', whenLine(ctx.facts), '']
  lines.push(
    ctx.topic === null
      ? 'The desk set no topic for this interview.'
      : `The topic the desk wants covered (ask about it once, in your own words; never say where it came from): ${ctx.topic}`,
  )
  const takes = interviewTakes(ctx)
  if (takes.length > 0) {
    lines.push(
      '',
      `Your private view on ${name} (a desk note: never quote it or say it is a note):`,
      ...takes.map(
        (t) =>
          `- ${t.take}${t.dataAngle === null ? '' : ` (data angle: ${t.dataAngle})`}${t.mild ? ' (keep it mild)' : ''}`,
      ),
    )
  }
  lines.push('')
  if (ctx.history.length === 0) lines.push('The interview so far: no questions yet.')
  else {
    lines.push('The interview so far:', ANSWERS_ARE_DATA)
    for (const h of ctx.history) {
      lines.push(`- You asked: ${h.question}`)
      if (h.answer === null) lines.push('  No usable answer.')
      else {
        lines.push(
          `  ${name} answered${h.usability === 'joke' ? ' (a joke)' : ''}:`,
          ...fencedAnswer(h.answer),
        )
      }
    }
  }
  lines.push(
    '',
    `You are ${reporter.name} (id "${reporter.id}") of ${reporter.outlet}. You interview ${name}.`,
    'Heat: normal. Be fair and direct.',
    ctx.player.pressLevel === 'easy'
      ? `${name} is at press level "easy": no criticism at all.`
      : `${name} is at press level "full".`,
    ...(ctx.player.pressLevel === 'easy' ? [] : feudLine(ctx.feud, name)),
    '',
    `Task: ask question ${String(ctx.position)} of about ${String(INTERVIEW_QUESTIONS)}. Put the one question in "question", at most ${String(INTERVIEW_QUESTION_MAX_CHARS)} characters.`,
  )
  return lines.join('\n')
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * The code check of one line (question, headline, dek or intro): numbers
 * (the sheet plus `allowed`), at most 3 numbers a sentence, no forbidden
 * name, no teammate but the interviewed player, no strong word.
 */
function lineProblems(
  text: string,
  label: string,
  ctx: Pick<InterviewContext, 'facts' | 'forbiddenNames' | 'player'>,
  allowed: Set<number>,
): string[] {
  const problems: string[] = [...textNumberProblems(text, ctx.facts, allowed)]
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (numberTokens(sentence) > MAX_NUMBERS_PER_SENTENCE) {
      problems.push(
        `A sentence of the ${label} has more than ${String(MAX_NUMBERS_PER_SENTENCE)} numbers.`,
      )
    }
  }
  const flat = collapse(text)
  if (ctx.forbiddenNames.some((n) => containsName(flat, n))) problems.push(FORBIDDEN_NAME_PROBLEM)
  if (STRONG_WORDS.test(flat)) problems.push(`The ${label} has a word the desk never prints.`)
  const own = collapse(ctx.player.name).toLowerCase()
  const masked = flat.replace(
    new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(own)}(?![\\p{L}\\p{N}_])`, 'giu'),
    ' ',
  )
  for (const p of ctx.facts.people) {
    if (collapse(p.name).toLowerCase() === own) continue
    if (containsName(masked, p.name)) {
      problems.push(`The ${label} names ${p.name}. Name only ${ctx.player.name}.`)
    }
  }
  return [...new Set(problems)]
}

/** The sheet's numbers, the topic's and those of the answers the desk may use. */
function allowedFor(ctx: Pick<InterviewContext, 'facts' | 'topic'>, texts: string[]): Set<number> {
  const allowed = allowedNumbers(ctx.facts)
  for (const t of ctx.topic === null ? texts : [ctx.topic, ...texts]) {
    for (const n of numbersIn(t)) allowed.add(n)
  }
  return allowed
}

function easyRules(ctx: { player: { name: string; pressLevel: 'full' | 'easy' } }): string[] {
  const name = ctx.player.name
  return ctx.player.pressLevel === 'easy'
    ? [
        `${name} is at press level "easy" (Go easy): any criticism of ${name}, even mild, is a problem.`,
      ]
    : []
}

function trustedAnswers(
  name: string,
  history: readonly ScrumHistoryEntry[],
): TrustedMaterial['answers'] {
  return history.flatMap((h) =>
    h.answer === null
      ? []
      : [{ player: name, question: h.question, answer: h.answer, usability: h.usability }],
  )
}

function fail(path: string, why: string): never {
  throw new Error(`interview output: ${path} ${why}`)
}

function closed(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail('root', 'is not an object')
  const o = v as Record<string, unknown>
  for (const k of Object.keys(o)) {
    if (!keys.includes(k)) fail('root', `has an unexpected field "${k}"`)
  }
  for (const k of keys) if (!(k in o)) fail('root', `is missing "${k}"`)
  return o
}

function nonEmpty(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.trim() === '') fail(path, 'is not a non-empty string')
  return v.trim()
}

/** One interview question in the reporter's voice; null on any failure (the caller falls back). */
export async function askInterviewQuestion(
  call: ModelCall,
  ctx: InterviewContext,
  record: Recorder,
): Promise<string | null> {
  const reporter = REPORTERS[ctx.reporter]
  const usable = trustedAnswers(ctx.player.name, ctx.history)
  const allowed = allowedFor(
    ctx,
    usable.map((a) => a.answer),
  )
  try {
    const r = await writeChecked({
      call,
      system: systemPrompt(ctx.reporter),
      user: questionPrompt(ctx),
      schema: QUESTION_SCHEMA,
      parse: (v) => ({ question: nonEmpty(closed(v, ['question'])['question'], 'question') }),
      check: (out) => {
        const problems = lineProblems(out.question, 'question', ctx, allowed)
        const chars = Array.from(out.question).length
        if (chars > INTERVIEW_QUESTION_MAX_CHARS) {
          problems.push(
            `The question has ${String(chars)} characters. The limit is ${String(INTERVIEW_QUESTION_MAX_CHARS)}.`,
          )
        }
        return problems.length === 0 ? { ok: true } : { ok: false, problems }
      },
      textForReview: (out) => `${reporter.name}, interviewing ${ctx.player.name}: ${out.question}`,
      criticizedForReview: () => [],
      takesForReview: interviewTakes(ctx),
      reviewRules: easyRules(ctx),
      trusted: { gmNotes: [], answers: usable },
      maxWrites: INTERVIEW_MAX_WRITES,
      facts: ctx.facts,
      record,
    })
    return r.ok ? r.out.question : null
  } catch {
    return null
  }
}

// ── The Q&A article ─────────────────────────────────────────────────────────

/** One answer the article may print: usable or joke, with its question as asked. */
export interface OfferedAnswer {
  question: string
  answer: string
  usability: 'usable' | 'joke'
}

export interface InterviewArticle {
  headline: string
  dek: string
  intro: string[]
  /** The printed answers, in interview order: the offered answer's index and the printed words. */
  answers: { n: number; text: string }[]
}

export const ARTICLE_HEADLINE_MAX_CHARS = 90
export const ARTICLE_DEK_MAX_CHARS = 200
export const ARTICLE_INTRO_MAX_WORDS = 120
export const ARTICLE_INTRO_MAX_PARAGRAPHS = 2
/** The article: the first write plus two rewrites (the desk's own article limit, `MAX_WRITES`). */
export const ARTICLE_MAX_WRITES = MAX_WRITES

const ARTICLE_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    dek: { type: 'string' },
    intro: { type: 'array', items: { type: 'string' } },
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: { n: { type: 'integer' }, text: { type: 'string' } },
        required: ['n', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['headline', 'dek', 'intro', 'answers'],
  additionalProperties: false,
} as const

/** The rules of the Q&A article (with the scrum rules on numbers, names and language). */
export const ARTICLE_RULES: readonly string[] = [
  `1. Write a Q&A article of the interview as the reporter who did it: a headline (at most ${String(ARTICLE_HEADLINE_MAX_CHARS)} characters), a dek (one sentence, at most ${String(ARTICLE_DEK_MAX_CHARS)} characters), a short intro (1 or 2 paragraphs, at most ${String(ARTICLE_INTRO_MAX_WORDS)} words), then the questions and answers.`,
  '2. The questions print as they were asked: you do not write them. In "answers" list the answers to print, in interview order, by their number "n" from the list you get. Print at least 3. Leave out an answer that adds nothing.',
  '3. An answer is the player\'s own words. You may shorten it only by cutting words: mark each cut with "…". Never change, reorder or add a word, never change its meaning. A joke answer stays a joke, printed as it was said.',
  '4. A word the desk never prints (strong swearing) is cut from the answer with "…"; if that leaves nothing, leave the answer out.',
  '5. The intro sets the scene in your voice from the fact sheet: who you sat down with and what the interview covered. The intro quotes nobody (no quotation marks) and never states a joke as fact. It names only the interviewed player.',
  '6. Plain text: no @ mentions, no links, no hashtags, no emoji, no markdown.',
]

function articleSystemPrompt(reporter: ReporterId): string {
  return [
    "You write for the Boogeymen News Desk. The Boogeymen are a small club of friends who play EA NHL Pro Clubs together. The desk has fictional reporters. You turn one of your interviews with a real teammate into a Q&A article for the club's website. Answer only in the JSON format you are given.",
    'ARTICLE RULES',
    ...ARTICLE_RULES,
    ...SCRUM_RULES.slice(2),
    FEUD_RULE,
    'YOUR VOICE',
    reporterVoice(REPORTERS[reporter]),
  ].join('\n\n')
}

function articlePrompt(
  ctx: Pick<InterviewContext, 'facts' | 'reporter' | 'player' | 'topic'>,
  offered: readonly OfferedAnswer[],
): string {
  const reporter = REPORTERS[ctx.reporter]
  const name = ctx.player.name
  return [
    'Fact sheet (JSON):',
    sheet(ctx.facts),
    '',
    whenLine(ctx.facts),
    '',
    ctx.topic === null
      ? 'The desk set no topic for this interview.'
      : `The topic the desk wanted covered (never say where it came from): ${ctx.topic}`,
    '',
    `The interview (questions as you asked them, then ${name}'s answers):`,
    ANSWERS_ARE_DATA,
    ...offered.flatMap((a, i) => [
      `${String(i + 1)}. You asked: ${a.question}`,
      `   ${name} answered${a.usability === 'joke' ? ' (a JOKE: never state it as fact)' : ''}:`,
      ...fencedAnswer(a.answer),
    ]),
    '',
    `You are ${reporter.name} (id "${reporter.id}") of ${reporter.outlet}. You interviewed ${name}.`,
    ctx.player.pressLevel === 'easy'
      ? `${name} is at press level "easy": no criticism at all.`
      : `${name} is at press level "full".`,
    '',
    'Task: write the Q&A article. Put the headline in "headline", the dek in "dek", the intro paragraphs in "intro" and the answers to print in "answers" ({"n": its number above, "text": the words to print}).',
  ].join('\n')
}

/** Lowercase words of a text, punctuation dropped (apostrophes inside words kept). */
function words(s: string): string[] {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w !== '')
}

/**
 * True when `printed` only cuts `original`: split at each "…" (or "..."),
 * every part is a run of the original's words, in order, without overlap.
 * Case and punctuation are ignored; no word may be changed or added.
 */
export function isCutOf(printed: string, original: string): boolean {
  const orig = words(original)
  const parts = printed
    .split(/…|\.\.\./)
    .map(words)
    .filter((p) => p.length > 0)
  if (parts.length === 0) return false
  let from = 0
  for (const part of parts) {
    let found = -1
    for (let i = from; i + part.length <= orig.length; i++) {
      if (part.every((w, k) => orig[i + k] === w)) {
        found = i
        break
      }
    }
    if (found < 0) return false
    from = found + part.length
  }
  return true
}

const QUOTE_MARKS = /["“”]/

/** The code check of an article (the review then reads the meaning). */
export function articleProblems(
  a: InterviewArticle,
  ctx: Pick<InterviewContext, 'facts' | 'forbiddenNames' | 'player' | 'topic'>,
  offered: readonly OfferedAnswer[],
): string[] {
  const problems: string[] = []
  const allowed = allowedFor(ctx, [])
  if (Array.from(a.headline).length > ARTICLE_HEADLINE_MAX_CHARS) {
    problems.push(`The headline is longer than ${String(ARTICLE_HEADLINE_MAX_CHARS)} characters.`)
  }
  if (Array.from(a.dek).length > ARTICLE_DEK_MAX_CHARS) {
    problems.push(`The dek is longer than ${String(ARTICLE_DEK_MAX_CHARS)} characters.`)
  }
  if (a.intro.length < 1 || a.intro.length > ARTICLE_INTRO_MAX_PARAGRAPHS) {
    problems.push(`The intro has ${String(a.intro.length)} paragraphs. Write 1 or 2.`)
  }
  const introWords = a.intro
    .join(' ')
    .split(/\s+/)
    .filter((w) => w !== '').length
  if (introWords > ARTICLE_INTRO_MAX_WORDS) {
    problems.push(
      `The intro has ${String(introWords)} words. The limit is ${String(ARTICLE_INTRO_MAX_WORDS)}.`,
    )
  }
  for (const p of a.intro) {
    if (/^\s*[QA]:/.test(p)) problems.push('An intro paragraph starts with "Q:" or "A:".')
    if (QUOTE_MARKS.test(p)) {
      problems.push('The intro has quotation marks. The intro quotes nobody.')
    }
  }
  problems.push(...lineProblems(a.headline, 'headline', ctx, allowed))
  problems.push(...lineProblems(a.dek, 'dek', ctx, allowed))
  for (const p of a.intro) problems.push(...lineProblems(p, 'intro', ctx, allowed))

  const minimum = Math.min(INTERVIEW_ARTICLE_MIN_ANSWERS, offered.length)
  if (a.answers.length < minimum) {
    problems.push(`Print at least ${String(minimum)} answers.`)
  }
  let last = 0
  for (const p of a.answers) {
    const answer = offered[p.n - 1]
    if (!Number.isInteger(p.n) || answer === undefined) {
      problems.push(`Answer ${String(p.n)} is not one of the listed answers.`)
      continue
    }
    if (p.n <= last) problems.push('List the answers once each, in interview order.')
    last = Math.max(last, p.n)
    if (!isCutOf(p.text, answer.answer)) {
      problems.push(
        `Answer ${String(p.n)} is not the player's words: print them as said, shortened only by cutting with "…".`,
      )
    }
    if (words(p.text).length < 2) problems.push(`Answer ${String(p.n)} needs at least two words.`)
    if (STRONG_WORDS.test(collapse(p.text))) {
      problems.push(`Answer ${String(p.n)} has a word the desk never prints. Cut it with "…".`)
    }
    if (ctx.forbiddenNames.some((n) => containsName(collapse(p.text), n))) {
      problems.push(FORBIDDEN_NAME_PROBLEM)
    }
  }
  return [...new Set(problems)]
}

function parseArticle(v: unknown): InterviewArticle {
  const o = closed(v, ['headline', 'dek', 'intro', 'answers'])
  const intro = o['intro']
  if (!Array.isArray(intro)) fail('intro', 'is not a list')
  const answers = o['answers']
  if (!Array.isArray(answers)) fail('answers', 'is not a list')
  return {
    headline: nonEmpty(o['headline'], 'headline'),
    dek: nonEmpty(o['dek'], 'dek'),
    intro: intro.map((p, i) => nonEmpty(p, `intro[${String(i)}]`)),
    answers: answers.map((x, i) => {
      const a = closed(x, ['n', 'text'])
      const n = a['n']
      if (typeof n !== 'number' || !Number.isInteger(n))
        fail(`answers[${String(i)}].n`, 'is not an integer')
      return { n, text: nonEmpty(a['text'], `answers[${String(i)}].text`) }
    }),
  }
}

/** The stored body of an article: the intro, then each printed answer under its question. */
export function articleBody(a: InterviewArticle, offered: readonly OfferedAnswer[]): string {
  return interviewBody(
    a.intro,
    a.answers.map((p) => ({ question: offered[p.n - 1]!.question, answer: p.text })),
  )
}

/**
 * Write the Q&A article: the code check (`articleProblems`) and the review
 * (the answers as trusted material; jokes marked). Fewer than 3 offered
 * answers never gets here. `{ ok: false }` when the writer gives up.
 */
export async function writeInterviewArticle(
  call: ModelCall,
  ctx: Pick<
    InterviewContext,
    'facts' | 'forbiddenNames' | 'player' | 'topic' | 'reporter' | 'takes'
  >,
  offered: readonly OfferedAnswer[],
  record: Recorder,
): Promise<{ ok: true; article: InterviewArticle } | { ok: false; reason: string }> {
  const reporter = REPORTERS[ctx.reporter]
  try {
    const r = await writeChecked({
      call,
      system: articleSystemPrompt(ctx.reporter),
      user: articlePrompt(ctx, offered),
      schema: ARTICLE_SCHEMA,
      parse: parseArticle,
      check: (out) => {
        const problems = articleProblems(out, ctx, offered)
        return problems.length === 0 ? { ok: true } : { ok: false, problems }
      },
      textForReview: (out) =>
        [`By ${reporter.name}`, out.headline, out.dek, '', articleBody(out, offered)].join('\n'),
      criticizedForReview: () => [],
      takesForReview: [],
      reviewRules: [
        'This text is a Q&A interview. Paragraphs that start with "Q:" are the reporter\'s questions as asked: they were checked when they were asked, so do not judge them. Paragraphs that start with "A:" are the player\'s answers: each must be words of one listed answer, shortened only by cutting ("…" marks a cut), never changed, added to or given a new meaning; a joke answer must not be presented as fact.',
        ...easyRules(ctx),
      ],
      trusted: {
        gmNotes: [],
        answers: offered.map((a) => ({
          player: ctx.player.name,
          question: a.question,
          answer: a.answer,
          usability: a.usability,
        })),
      },
      maxWrites: ARTICLE_MAX_WRITES,
      facts: ctx.facts,
      record,
    })
    return r.ok ? { ok: true, article: r.out } : { ok: false, reason: r.reason }
  } catch (err: unknown) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
