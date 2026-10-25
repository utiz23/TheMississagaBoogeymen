import { REPORTERS, REPORTER_IDS, type FeatureKind, type NewsFacts } from '@eanhl/db/news'

export type CheckResult = { ok: true } | { ok: false; problems: string[] }

const POST_MAX_CHARS = 280
const ARTICLE_MIN_WORDS = 250
const ARTICLE_MAX_WORDS = 450
/** Weekly features (rev 2, B3). */
const FEATURE_MIN_WORDS = 600
const FEATURE_MAX_WORDS = 900
const NOTES_MIN_ITEMS = 10
const NOTES_MAX_ITEMS = 15

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

/**
 * Keys whose numbers are identifiers, clock digits or dates, never stats (R16;
 * `clock` B1; rev 2: `weekStart`, the dates of the week sheet's history, so an
 * invented stat cannot pass on a date digit. The sheet's own `key` stays).
 */
const NON_STAT_KEYS = new Set(['playerId', 'matchId', 'playedAt', 'period', 'clock', 'weekStart'])

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

type LengthRule = 'post' | 'article' | 'feature' | 'none'

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
  } else if (length === 'article' || length === 'feature') {
    const [min, max] =
      length === 'article'
        ? [ARTICLE_MIN_WORDS, ARTICLE_MAX_WORDS]
        : [FEATURE_MIN_WORDS, FEATURE_MAX_WORDS]
    const words = flat === '' ? 0 : flat.split(' ').length
    if (words < min || words > max) {
      problems.push(
        `The article body has ${String(words)} words. It must have ${String(min)} to ${String(max)}.`,
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

/** Number words beyond the counted ones, banned in a prediction too. */
const OTHER_NUMBER_WORDS = /\b(dozens?|twice|thrice|thousands?|millions?)\b/i

/** The first digit run or number word in `text`, or null. */
function firstNumber(text: string): string | null {
  const found = [
    text.match(new RegExp(DIGIT_RUN.source)),
    text.match(new RegExp(COMPOUND_WORD.source, 'i')),
    text.match(new RegExp(SINGLE_WORD.source, 'i')),
    text.match(OTHER_NUMBER_WORDS),
  ].filter((m): m is RegExpMatchArray => m !== null)
  if (found.length === 0) return null
  return found.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0]![0]
}

function sentenceCount(text: string): number {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter((x) => x !== '').length
}

/**
 * The whole weekly feature (rev 2, B3): the body gets the 600-900 word rule
 * (a notes column also 10-15 items, one paragraph each); headline, dek,
 * summary, receipt and prediction get the number, name and club rules; the
 * prediction has no digits and no number words at all; the receipt is one or
 * two sentences when there was a previous prediction, else empty.
 */
export function checkFeatureFacts(
  feature: {
    headline: string
    dek: string
    paragraphs: string[]
    summary: string
    mentions: string[]
    clubs: string[]
    criticized: string[]
    prediction: string
    receipt: string
  },
  facts: NewsFacts,
  forbiddenNames: string[],
  rules: { kind: FeatureKind; previousPrediction: string | null },
  criticizedTonight: readonly string[] = [],
): CheckResult {
  const out = { mentions: feature.mentions, clubs: feature.clubs, criticized: feature.criticized }
  const problems = [
    ...check(
      feature.paragraphs.join('\n\n'),
      facts,
      forbiddenNames,
      out,
      'feature',
      criticizedTonight,
    ),
    ...check(
      [feature.headline, feature.dek, feature.summary, feature.receipt, feature.prediction]
        .filter((x) => x.trim() !== '')
        .join('\n'),
      facts,
      forbiddenNames,
      { mentions: [], clubs: [] },
      'none',
    ),
  ]
  if (rules.kind === 'notes') {
    const items = feature.paragraphs.length
    if (items < NOTES_MIN_ITEMS || items > NOTES_MAX_ITEMS) {
      problems.push(
        `The notes column has ${String(items)} items. It must have ${String(NOTES_MIN_ITEMS)} to ${String(NOTES_MAX_ITEMS)}, one paragraph each.`,
      )
    }
  }
  const number = firstNumber(feature.prediction)
  if (number !== null) {
    problems.push(`The prediction must have no numbers or number words; it has "${number}".`)
  }
  const receipt = feature.receipt.trim()
  if (rules.previousPrediction === null) {
    if (receipt !== '') {
      problems.push('There was no previous prediction, so the receipt must be an empty string.')
    }
  } else if (receipt === '') {
    problems.push(
      "The receipt is empty. Say in one or two sentences whether last week's prediction came true.",
    )
  } else {
    const n = sentenceCount(receipt)
    if (n > 2) problems.push(`The receipt has ${String(n)} sentences. It must have one or two.`)
  }
  const unique = [...new Set(problems)]
  return unique.length === 0 ? { ok: true } : { ok: false, problems: unique }
}
