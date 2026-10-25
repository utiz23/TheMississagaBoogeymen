import { REPORTERS, REPORTER_IDS, type NewsFacts } from '@eanhl/db/news'

export type CheckResult = { ok: true } | { ok: false; problems: string[] }

const POST_MAX_CHARS = 280
const ARTICLE_MIN_WORDS = 250
const ARTICLE_MAX_WORDS = 450

const DIGIT_RUN = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g

const UNIT_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
}
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const ONES = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const COMPOUND_WORD = new RegExp(`\\b(${TENS.join('|')})-(${ONES.join('|')})\\b`, 'gi')
const SINGLE_WORD = new RegExp(`\\b(${Object.keys(UNIT_WORDS).join('|')})\\b`, 'gi')

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseDigits(run: string): number {
  return Number(run.replace(/,/g, ''))
}

/** Keys whose numbers are identifiers or clock digits, never stats (R16; `clock` B1). */
const NON_STAT_KEYS = new Set(['playerId', 'matchId', 'playedAt', 'period', 'clock'])

/** A game clock in text, such as "3:58" or "03:58". */
const CLOCK = /\b(\d{1,2}):(\d{2})\b/g

const clockSeconds = (minutes: string, seconds: string): number =>
  Number(minutes) * 60 + Number(seconds)

/**
 * Game clocks in the text must be goal clocks on the sheet (compared by value,
 * so "3:58" equals "03:58"). Returns the problems and the text with every
 * clock removed, so clock digits are never checked as stats.
 */
function clockProblems(text: string, facts: NewsFacts): { problems: string[]; rest: string } {
  const onSheet = new Set<number>()
  for (const g of facts.games) {
    for (const goal of g.goals ?? []) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(goal.clock)
      if (m) onSheet.add(clockSeconds(m[1]!, m[2]!))
    }
  }
  const problems: string[] = []
  const rest = text.replace(CLOCK, (whole, minutes: string, seconds: string) => {
    if (!onSheet.has(clockSeconds(minutes, seconds))) {
      problems.push(`The game clock ${whole} is not on the fact sheet.`)
    }
    return ' '
  })
  return { problems, rest }
}

/**
 * Every number anywhere in the sheet (values and digits inside strings), plus
 * 0 and 1. Identifier and timestamp keys are skipped: a player id or a clock
 * digit must not make an invented stat pass.
 */
export function allowedNumbers(facts: NewsFacts): Set<number> {
  const out = new Set<number>([0, 1])
  const walk = (v: unknown): void => {
    if (typeof v === 'number') {
      if (Number.isFinite(v)) out.add(Math.abs(v))
    } else if (typeof v === 'string') {
      for (const m of v.matchAll(DIGIT_RUN)) out.add(parseDigits(m[0]))
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x)
    } else if (typeof v === 'object' && v !== null) {
      for (const [k, x] of Object.entries(v)) {
        if (!NON_STAT_KEYS.has(k)) walk(x)
      }
    }
  }
  walk(facts)
  return out
}

function numberProblems(text: string, allowed: Set<number>): string[] {
  const problems: string[] = []
  for (const m of text.matchAll(DIGIT_RUN)) {
    const n = parseDigits(m[0])
    if (!allowed.has(n)) problems.push(`The number ${m[0]} is not on the fact sheet.`)
  }
  // Number words. Compounds first ("twenty-five"), then single words in what is left.
  const rest = text.replace(COMPOUND_WORD, (whole, tens: string, ones: string) => {
    const n = UNIT_WORDS[tens.toLowerCase()]! + UNIT_WORDS[ones.toLowerCase()]!
    if (!allowed.has(n))
      problems.push(`The number "${whole}" (${String(n)}) is not on the fact sheet.`)
    return ' '
  })
  for (const m of rest.matchAll(SINGLE_WORD)) {
    const n = UNIT_WORDS[m[0].toLowerCase()]!
    if (!allowed.has(n))
      problems.push(`The number "${m[0]}" (${String(n)}) is not on the fact sheet.`)
  }
  return [...new Set(problems)]
}

function containsName(haystack: string, name: string): boolean {
  const n = collapse(name)
  if (n === '') return false
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(n)}(?![\\p{L}\\p{N}_])`, 'iu')
  return re.test(haystack)
}

/** The one problem text for any forbidden name (it never contains the name). */
export const FORBIDDEN_NAME_PROBLEM = 'The text names a person who is not on the fact sheet.'

type LengthRule = 'post' | 'article' | 'none'

/** What the writer listed with the text. `criticized` is checked only when given. */
export interface ListedOutput {
  mentions: string[]
  clubs: string[]
  criticized?: string[]
}

const sameName = (a: string, b: string) => collapse(a).toLowerCase() === collapse(b).toLowerCase()

/**
 * The people the writer criticises harshly (rev 2, B4): each must be on the
 * sheet, never at press level "easy", and never one already criticised
 * harshly tonight (the pile-on limit: one harsh piece per player per night).
 */
function criticizedProblems(
  criticized: readonly string[],
  facts: NewsFacts,
  forbiddenNames: string[],
  tonight: readonly string[],
): string[] {
  const problems: string[] = []
  for (const c of criticized) {
    const person = facts.people.find((p) => sameName(p.name, c))
    if (person === undefined) {
      const isForbidden = forbiddenNames.some((name) => containsName(collapse(c), name))
      problems.push(
        isForbidden
          ? FORBIDDEN_NAME_PROBLEM
          : `"${c}" in criticized is not a person on the fact sheet.`,
      )
      continue
    }
    if (person.pressLevel === 'easy') {
      problems.push(
        `${person.name} is at press level "easy": criticism of ${person.name} must stay mild.`,
      )
    }
    if (tonight.some((t) => sameName(t, person.name))) {
      problems.push(`${person.name} was already criticised harshly tonight — take another angle.`)
    }
  }
  return problems
}

function check(
  text: string,
  facts: NewsFacts,
  forbiddenNames: string[],
  out: ListedOutput,
  length: LengthRule,
  tonight: readonly string[] = [],
): string[] {
  const clocks = clockProblems(text, facts)
  const problems = [...clocks.problems, ...numberProblems(clocks.rest, allowedNumbers(facts))]

  // The problem text never repeats the name: it goes back to the model in the
  // rewrite prompt, into news_jobs.last_error and into the logs.
  const flat = collapse(text)
  if (forbiddenNames.some((name) => containsName(flat, name))) {
    problems.push(FORBIDDEN_NAME_PROBLEM)
  }

  const allowedNames = new Set<string>([
    ...facts.people.map((p) => p.name),
    ...REPORTER_IDS.map((id) => REPORTERS[id].name),
  ])
  for (const m of out.mentions) {
    if (allowedNames.has(m)) continue
    // A forbidden name listed in mentions gets the same name-free problem text.
    const isForbidden = forbiddenNames.some((name) => containsName(collapse(m), name))
    problems.push(
      isForbidden ? FORBIDDEN_NAME_PROBLEM : `"${m}" is not a person on the fact sheet.`,
    )
  }

  problems.push(...criticizedProblems(out.criticized ?? [], facts, forbiddenNames, tonight))

  const clubs = new Set(facts.games.map((g) => collapse(g.opponentName).toLowerCase()))
  for (const c of out.clubs) {
    if (!clubs.has(collapse(c).toLowerCase())) {
      problems.push(`"${c}" is not an opponent club on the fact sheet.`)
    }
  }

  if (length === 'post') {
    const chars = Array.from(text).length
    if (chars > POST_MAX_CHARS) {
      problems.push(
        `The post has ${String(chars)} characters. The limit is ${String(POST_MAX_CHARS)}.`,
      )
    }
  } else if (length === 'article') {
    const words = flat === '' ? 0 : flat.split(' ').length
    if (words < ARTICLE_MIN_WORDS || words > ARTICLE_MAX_WORDS) {
      problems.push(
        `The article body has ${String(words)} words. It must have ${String(ARTICLE_MIN_WORDS)} to ${String(ARTICLE_MAX_WORDS)}.`,
      )
    }
  }
  return [...new Set(problems)]
}

/**
 * Checks one piece of text against the fact sheet: numbers (digits and words),
 * names, club names, the people it criticises harshly, and length. A `game`
 * sheet means a post (at most 280 characters); `night` and `week` sheets mean
 * an article body (250 to 450 words, paragraphs joined by blank lines).
 * `criticizedTonight`: the names the night's earlier items criticised harshly.
 */
export function checkFacts(
  text: string,
  facts: NewsFacts,
  forbiddenNames: string[],
  out: ListedOutput,
  criticizedTonight: readonly string[] = [],
): CheckResult {
  const problems = check(
    text,
    facts,
    forbiddenNames,
    out,
    facts.kind === 'game' ? 'post' : 'article',
    criticizedTonight,
  )
  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}

/**
 * The whole article: the body gets the length rule; the headline, dek and
 * summary get the number, name and club rules but no length rule.
 */
export function checkArticleFacts(
  article: {
    headline: string
    dek: string
    paragraphs: string[]
    summary: string
    mentions: string[]
    clubs: string[]
    criticized: string[]
  },
  facts: NewsFacts,
  forbiddenNames: string[],
  criticizedTonight: readonly string[] = [],
): CheckResult {
  const out = { mentions: article.mentions, clubs: article.clubs, criticized: article.criticized }
  const problems = [
    ...check(
      article.paragraphs.join('\n\n'),
      facts,
      forbiddenNames,
      out,
      'article',
      criticizedTonight,
    ),
    ...check(
      [article.headline, article.dek, article.summary].join('\n'),
      facts,
      forbiddenNames,
      { mentions: [], clubs: [] },
      'none',
    ),
  ]
  const unique = [...new Set(problems)]
  return unique.length === 0 ? { ok: true } : { ok: false, problems: unique }
}

/**
 * The fact check of a game's posts (each post as `checkFacts`). The pile-on
 * limit counts the night's earlier items and the earlier post of the same game.
 */
export function checkGamePosts(
  posts: readonly { text: string; mentions: string[]; clubs: string[]; criticized: string[] }[],
  facts: NewsFacts,
  forbiddenNames: string[],
  criticizedTonight: readonly string[] = [],
): CheckResult {
  const problems: string[] = []
  posts.forEach((p, i) => {
    const r = checkFacts(p.text, facts, forbiddenNames, p, [
      ...criticizedTonight,
      ...posts.slice(0, i).flatMap((q) => q.criticized),
    ])
    if (!r.ok) problems.push(...r.problems)
  })
  const unique = [...new Set(problems)]
  return unique.length === 0 ? { ok: true } : { ok: false, problems: unique }
}
