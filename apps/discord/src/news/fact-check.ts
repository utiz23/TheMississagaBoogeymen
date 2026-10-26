import {
  AI_GOALIE_NAMES,
  LORE_NAMES,
  REPORTERS,
  REPORTER_IDS,
  SIGNATURE_WORDS,
  type FeatureKind,
  type NewsFacts,
  type ReporterId,
} from '@eanhl/db/news'

export type CheckResult = { ok: true } | { ok: false; problems: string[] }

const POST_MAX_CHARS = 280
const ARTICLE_MIN_WORDS = 250
const ARTICLE_MAX_WORDS = 450
/** Weekly features (rev 2, B3). */
const FEATURE_MIN_WORDS = 600
const FEATURE_MAX_WORDS = 900
const NOTES_MIN_ITEMS = 10
const NOTES_MAX_ITEMS = 15
/** A night with one game (spec §12.12-7). */
const SINGLE_NIGHT_MIN_WORDS = 120
const SINGLE_NIGHT_MAX_WORDS = 200
/** A big game's story (C3a.7). */
const GAME_STORY_MIN_WORDS = 200
const GAME_STORY_MAX_WORDS = 350
/** A big game's spotlight or column (C3a.7). */
const GAME_FEATURE_MIN_WORDS = 400
const GAME_FEATURE_MAX_WORDS = 700

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
 * Part C1: `lore` (world facts, never a source of numbers); the team norms'
 * `sampleGames` and the per-game `labels` (words only, no numbers to quote).
 * The per-game `patterns` are words: a run is quoted in words, never as a
 * new number (C1 fix 3). The norms' averages and lead % (`ours`, `theirs`,
 * `leadPct`) stay quotable.
 * Part C2: the player lines' `norm.labels`, `bests`, `form` and `firsts` are
 * words (no digits); `norm.perGame`, `norm.last10`, `norm.games`,
 * `approaching`, `streaks`, `seasonTotals`, `chemistry`, `records`,
 * `newRecords`, the context and the thread `summary` hold numbers a writer
 * may quote. Not stats: `stances` (a writer's earlier words), `threadKey`,
 * and inside `threads` the `key` (holds a player id) and `since` (a date).
 */
const NON_STAT_KEYS = new Set([
  'playerId',
  'matchId',
  'playedAt',
  'period',
  'clock',
  'weekStart',
  'lore',
  'sampleGames',
  'labels',
  'patterns',
  'stances',
  'threadKey',
  // C2.7 ranked facts: the text holds sheet numbers only; the id (match and
  // player ids) and the weight are not stats.
  'id',
  'weight',
])

/** Keys that are not stats only inside the named section (the sheet's own `key` stays a date it may quote). */
const NON_STAT_IN: Record<string, ReadonlySet<string>> = {
  threads: new Set(['key', 'since']),
}

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
  const walk = (v: unknown, section: string | null): void => {
    if (typeof v === 'number') {
      if (Number.isFinite(v)) out.add(Math.abs(v))
    } else if (typeof v === 'string') {
      for (const m of v.matchAll(DIGIT_RUN)) out.add(parseDigits(m[0]))
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x, section)
    } else if (typeof v === 'object' && v !== null) {
      const skip = section === null ? undefined : NON_STAT_IN[section]
      for (const [k, x] of Object.entries(v)) {
        if (NON_STAT_KEYS.has(k) || skip?.has(k) === true) continue
        walk(x, k in NON_STAT_IN ? k : section)
      }
    }
  }
  walk(facts, null)
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

type LengthRule =
  | 'post'
  | 'article'
  | 'night-single'
  | 'game-story'
  | 'game-feature'
  | 'feature'
  | 'none'

const WORD_RANGE: Partial<Record<LengthRule, [number, number]>> = {
  article: [ARTICLE_MIN_WORDS, ARTICLE_MAX_WORDS],
  'night-single': [SINGLE_NIGHT_MIN_WORDS, SINGLE_NIGHT_MAX_WORDS],
  'game-story': [GAME_STORY_MIN_WORDS, GAME_STORY_MAX_WORDS],
  'game-feature': [GAME_FEATURE_MIN_WORDS, GAME_FEATURE_MAX_WORDS],
  feature: [FEATURE_MIN_WORDS, FEATURE_MAX_WORDS],
}

/** What the writer listed with the text. `criticized` is checked only when given. */
export interface ListedOutput {
  mentions: string[]
  clubs: string[]
  criticized?: string[]
  /** C3a: players called out for a zero; checked only when given. */
  zeroCalled?: string[]
  /** C3a: stances on threads; checked only when given. */
  stances?: { threadKey: string; stance: string }[]
  /** C3a: ids of the reporter takes the piece voiced; checked only when given. */
  takesUsed?: number[]
}

/**
 * What the code checks need to know about the piece beyond the sheet (C3a.5).
 * Every field is optional: without `reporter` the signature-word check is
 * skipped and no mild swearing is allowed.
 */
export interface PieceContext {
  reporter?: ReporterId
  /** A reply post: the bible's jabs are blocked and it must argue with a number. */
  isReply?: boolean
  /** Zero call-outs already made tonight (spec §12.12-5: at most one per night). */
  zeroCalledTonight?: readonly string[]
  /** Zero call-outs of the previous night (never the same player twice in a row). */
  zeroCalledPrevious?: readonly string[]
  /** Ids of the reporter takes this piece was offered; `takesUsed` must be among them. */
  offeredTakes?: readonly number[]
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

/**
 * The AI goalie names the text may use (spec §12.8): game lines and week
 * totals, and both in-game names (`AI_GOALIE_NAMES`) whenever a game of the
 * sheet had an AI goalie in net, also without a line (C2.12).
 */
export function aiGoalieNames(facts: NewsFacts): string[] {
  const names = [
    ...facts.games.flatMap((g) => (g.aiGoalie === null ? [] : [g.aiGoalie.name])),
    ...facts.aiGoalieWeek.map((a) => a.name),
    ...(facts.games.some((g) => g.aiGoalieInNet) ? AI_GOALIE_NAMES : []),
  ]
  return [...new Set(names)]
}

// ── C3a.5: style and craft checks ───────────────────────────────────────────

/** Signature words per piece (spec §12.9): a post at most 1, an article at most 3. */
export const POST_MAX_SIGNATURE_WORDS = 1
export const ARTICLE_MAX_SIGNATURE_WORDS = 3

/** Format labels the writer must not use (spec §12.12-8). */
export const FORMAT_LABELS = /\b(the tactical point( is)?|less comfortable|the detail:)/i

/** Jabs a reply must not use (spec §12.12-6: argue with a number, not with motives). */
export const REPLY_JABS = /\b(clicks|outrage|jealous|clipboard|shows up|timing)\b/i

/** Reporters are outside media (spec §12.12-11). */
export const OUR_PRONOUNS = /\b(we|us|our|ours)\b/i

/** Plus-minus and game score are not on the sheet (spec §12.12-4). */
const PLUS_MINUS = /\bplus[- ]?minus\b|\+\/-|\bgame[- ]scores?\b/i
const MINUS_SKATER = /(?:^|[\s(])[-−–]\d+\s+skaters?\b|\bskaters?\b[^.!?]{0,12}?(?:^|\s)[-−–]\d+\b/i

/** A headline like "Two wins, one loss" (spec §12.12-9). */
const SCORELINE_HEADLINE = /^\S+ wins?,\s*\S+ loss/i

/** At most this many "not X ... Y" contrasts per piece (spec §12.12-8). */
export const MAX_CONTRAST = 1
/** "It was not luck, it was structure", "not X, but Y", "wasn't X. It was Y". */
const CONTRAST = [
  /\bnot\b[^.!?;,]{1,60},\s*but\b/gi,
  /\b(?:is|was|were|are|it's|that's|isn't|wasn't|weren't|aren't)\s*(?:not\b|n't\b)?[^.!?]{0,60}?(?:not|n't)\b[^.!?]{1,60}?[.;:,—–]\s*(?:it|this|that|they|he|she)\s+(?:was|is|were|are)\b/gi,
]

/**
 * The "not X ... Y" contrasts of a text, one per sentence that starts one. A
 * sentence is read together with the next, so the two-sentence form "It
 * wasn't luck. It was structure." counts once (C3a fix S2); the patterns
 * overlap, so sentences are counted, not matches.
 */
export function contrastCount(text: string): number {
  const list = sentences(collapse(text))
  let n = 0
  list.forEach((x, i) => {
    const pair = `${x} ${list[i + 1] ?? ''}`
    const hit = CONTRAST.some((re) => {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
      return [...pair.matchAll(g)].some((m) => (m.index ?? 0) < x.length)
    })
    if (hit) n++
  })
  return n
}

/** At most 3 numbers per sentence; at most 2 clock times per article (spec §12.12-7). */
export const MAX_NUMBERS_PER_SENTENCE = 3
export const MAX_ARTICLE_CLOCKS = 2

/** Always blocked (spec §12.18-5): strong words and slurs, for every reporter. */
const STRONG_WORDS =
  /\b(fuck\w*|shit\w*|bullshit|bitch\w*|bastard\w*|asshole\w*|dickhead\w*|cunt\w*|goddamn\w*|motherf\w*|twat\w*|wank\w*|prick\w*|pissed|retard\w*|f[a@]g\w*)\b/i
/** Mild words: only Mercer, Pettibone and Vale, at most one per piece. */
const MILD_WORDS = /\b(hell|damn|damned|crap|crappy)\b/gi
/** At most this many mild swear words in one piece of a reporter allowed to swear. */
export const MAX_MILD_SWEARS = 1

/** A zero in a sentence ("0 shots", "zero points", "no hits"): a zero call-out when a person is named. */
const ZERO_STAT =
  /\b(?:0|zero|no|without an?|without any)\s+(?:shots?|points?|hits?|goals?|assists?)\b/i

/** Penalty minutes are news from 10 (spec §12.12-5). */
const PIM_MENTION = /\b(\d+)\s*(?:penalty minutes|pim|minutes in the box)\b/gi
const PIM_MIN = 10

const sentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => x !== '')

/**
 * The numbers of one sentence: a hyphen-joined run ("4-2", "40-11-5") and a
 * percentage count once, a clock once, every number word once.
 */
export function numberTokens(sentence: string): number {
  const digits =
    sentence.match(/\d{1,2}:\d{2}|\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)*%?/g) ?? []
  const words =
    sentence
      .replace(COMPOUND_WORD, ' n ')
      .match(new RegExp(SINGLE_WORD.source, 'gi'))
      ?.filter((w) => !/^(one|zero)$/i.test(w)) ?? []
  const compounds = sentence.match(COMPOUND_WORD) ?? []
  return digits.length + words.length + compounds.length
}

function countMatches(text: string, re: RegExp): number {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  return [...text.matchAll(g)].length
}

function wordRe(word: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(word)}(?![\\p{L}\\p{N}_])`, 'giu')
}

/** How many DIFFERENT signature words of the reporter the text uses (C3a fix S3). */
export function signatureWordCount(text: string, reporter: ReporterId): number {
  return SIGNATURE_WORDS[reporter].filter((w) => countMatches(text, wordRe(w)) > 0).length
}

const NUMBER_TOKEN =
  '(\\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)'
const SHOT_PAIR = new RegExp(
  `\\b${NUMBER_TOKEN}\\s+(?:goals?\\s+|saves?\\s+)?(?:of|on)\\s+${NUMBER_TOKEN}\\s+shots?\\b`,
  'gi',
)
const tokenValue = (t: string): number =>
  /^\d+$/.test(t) ? Number(t) : (UNIT_WORDS[t.toLowerCase()] ?? Number.NaN)

/**
 * The real goals/shots pairs of the sheet ("3 on 14 shots", "19 of 21 shots"):
 * the club's and the opponent's goals on shots, saves of shots against (the
 * team, each goalie, the AI goalie), each player's goals on shots, the night
 * and week totals.
 */
export function shotPairs(facts: NewsFacts): Set<string> {
  const out = new Set<string>()
  const add = (x: number | null | undefined, y: number | null | undefined) => {
    if (typeof x === 'number' && typeof y === 'number') out.add(`${String(x)}/${String(y)}`)
  }
  for (const g of facts.games) {
    if (g.team !== null) {
      add(g.scoreFor, g.team.shotsFor)
      add(g.scoreAgainst, g.team.shotsAgainst)
      add(g.team.shotsAgainst - g.scoreAgainst, g.team.shotsAgainst)
      add(g.team.shotsFor - g.scoreFor, g.team.shotsFor)
    }
    for (const p of g.players) {
      add(p.goals, p.shots)
      if (p.saves !== null && p.goalsAgainst !== null) {
        add(p.saves, p.saves + p.goalsAgainst)
        add(p.goalsAgainst, p.saves + p.goalsAgainst)
      }
    }
    if (g.aiGoalie !== null) {
      add(g.aiGoalie.saves, g.aiGoalie.shotsAgainst)
      add(g.aiGoalie.goalsAgainst, g.aiGoalie.shotsAgainst)
    }
  }
  const t = facts.nightTotals
  add(t.goalsFor, t.shotsFor)
  add(t.goalsAgainst, t.shotsAgainst)
  add(t.shotsAgainst - t.goalsAgainst, t.shotsAgainst)
  for (const p of facts.weekPlayers) add(p.goals, p.shots)
  for (const a of facts.aiGoalieWeek) {
    add(a.saves, a.shotsAgainst)
    add(a.goalsAgainst, a.shotsAgainst)
  }
  return out
}

/** Numbers an ended-early game's post may hold: the score and the date's digits (spec §12.12-3). */
function endedEarlyNumbers(facts: NewsFacts): Set<number> | null {
  if (facts.kind !== 'game' || !facts.games.some((g) => g.endedEarly)) return null
  const out = new Set<number>()
  for (const g of facts.games) {
    out.add(g.scoreFor)
    out.add(g.scoreAgainst)
  }
  const [y, , d] = facts.key.split('-').map(Number)
  out.add(y!)
  out.add(d!)
  return out
}

/** Every name the sheet allows: people, record holders, AI goalies, reporters, clubs, titles, lore. */
function sheetNames(facts: NewsFacts): string[] {
  return [
    ...facts.people.map((p) => p.name),
    ...facts.records.flatMap((r) => (r.holder === null ? [r.title] : [r.holder, r.title])),
    ...aiGoalieNames(facts),
    ...REPORTER_IDS.map((id) => REPORTERS[id].name),
    ...facts.games.map((g) => g.opponentName),
    ...facts.games.map((g) => g.gameTitleName),
    facts.gameTitleName,
    ...LORE_NAMES,
  ].filter((n) => collapse(n) !== '')
}

/**
 * The text with every sheet name replaced by "X" (longest first), so digits
 * inside a name never count as numbers (C3a fix M3). Word-bounded; one space
 * stands for any spacing inside a name.
 */
export function withoutSheetNames(text: string, facts: NewsFacts): string {
  let out = text
  const names = [...new Set(sheetNames(facts))].sort((a, b) => b.length - a.length)
  for (const n of names) {
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}_])${collapse(n).split(' ').map(escapeRegExp).join('\\s+')}(?![\\p{L}\\p{N}_])`,
      'giu',
    )
    out = out.replace(re, 'X')
  }
  return out
}

/** The person a name means (case and spacing ignored), or undefined. */
function personOf(facts: NewsFacts, name: string) {
  return facts.people.find((p) => sameName(p.name, name))
}

/** Whether the player has a forward line on the sheet (zero call-outs: never D or G). */
function hasForwardLine(facts: NewsFacts, playerId: number): boolean {
  return facts.games.some((g) =>
    g.players.some((p) => p.playerId === playerId && p.position === 'F'),
  )
}

function zeroCalledProblems(
  text: string,
  facts: NewsFacts,
  zeroCalled: readonly string[] | undefined,
  ctx: PieceContext,
): string[] {
  const problems: string[] = []
  if (zeroCalled === undefined) return problems
  const tonight = ctx.zeroCalledTonight ?? []
  const previous = ctx.zeroCalledPrevious ?? []
  if (zeroCalled.length > 1) {
    problems.push('A piece may call out at most one player for a zero.')
  }
  for (const z of zeroCalled) {
    const person = personOf(facts, z)
    if (person === undefined) {
      problems.push(`"${z}" in zeroCalled is not a person on the fact sheet.`)
      continue
    }
    if (!hasForwardLine(facts, person.playerId)) {
      problems.push(`${person.name} played D or G: no zero call-out for a defenceman or a goalie.`)
    }
    if (tonight.length > 0) {
      problems.push('There was already a zero call-out tonight: at most one per night.')
    }
    if (previous.some((p) => sameName(p, person.name))) {
      problems.push(
        `${person.name} was called out for a zero last night: never two nights in a row.`,
      )
    }
  }
  if (zeroCalled.length === 0) {
    for (const sentence of sentences(text)) {
      const named = zeroSubject(sentence, facts)
      if (named !== null) {
        problems.push(
          `"${sentence}" calls out ${named} for a zero: list the player in "zeroCalled", or drop the zero.`,
        )
      }
    }
  }
  return problems
}

/** Words before a zero that make it a goal or shot conceded, not a player's zero (C3a fix I5). */
const CONCEDED_BEFORE =
  /\b(allowed|allowing|allows|conceded|conceding|concedes|gave up|giving up|gives up|surrendered|let in|faced|facing)\b[^.!?;]{0,15}$/i
const CONCEDED_AFTER = /^\s*(against|allowed|conceded)\b/i
/** A subject between the player and the zero (the opponent, "they"): the zero is not his. */
const OTHER_SUBJECT = /\b(opponents?|they|them|their|the other side)\b/i

/**
 * The player a sentence calls out for a zero, or null: a zero stat ("0
 * shots", "no points") whose subject is a named player — his name comes
 * before it with no other subject (the opponent, an opponent club, "they")
 * in between, and it is not a goal or shot allowed ("allowed no goals", "no
 * goals against").
 */
export function zeroSubject(sentence: string, facts: NewsFacts): string | null {
  const re = new RegExp(ZERO_STAT.source, 'gi')
  for (const m of sentence.matchAll(re)) {
    const at = m.index ?? 0
    const before = sentence.slice(0, at)
    const after = sentence.slice(at + m[0].length)
    if (CONCEDED_BEFORE.test(before) || CONCEDED_AFTER.test(after)) continue
    let last: { name: string; end: number } | null = null
    for (const p of facts.people) {
      const nameRe = new RegExp(
        `(?<![\\p{L}\\p{N}_])${escapeRegExp(collapse(p.name))}(?![\\p{L}\\p{N}_])`,
        'giu',
      )
      for (const n of before.matchAll(nameRe)) {
        const end = (n.index ?? 0) + n[0].length
        if (last === null || end > last.end) last = { name: p.name, end }
      }
    }
    if (last === null) continue
    const between = before.slice(last.end)
    if (OTHER_SUBJECT.test(between)) continue
    if (facts.games.some((g) => containsName(between, g.opponentName))) continue
    return last.name
  }
  return null
}

/**
 * The style and craft rules of spec §12.12 / §12.18-5 that the code can
 * check (C3a.5). `body` is true for an article body (the clock limit and
 * the opening rule apply).
 */
function styleProblems(
  text: string,
  facts: NewsFacts,
  out: ListedOutput,
  length: LengthRule,
  ctx: PieceContext,
): string[] {
  const problems: string[] = []
  const flat = collapse(text)
  if (flat === '') return problems
  const isArticle = length !== 'post' && length !== 'none'

  if (FORMAT_LABELS.test(flat)) {
    problems.push(
      `Drop the format label "${FORMAT_LABELS.exec(flat)![0]}": write the point, not its label.`,
    )
  }
  const contrasts = contrastCount(flat)
  if (contrasts > MAX_CONTRAST) {
    problems.push(
      `The text has ${String(contrasts)} "not X ... Y" contrasts. Use at most ${String(MAX_CONTRAST)}.`,
    )
  }
  if (ctx.isReply === true) {
    const jab = REPLY_JABS.exec(flat)
    if (jab) {
      problems.push(
        `A reply argues with a number from the sheet, not with motives: drop "${jab[0]}".`,
      )
    }
    if (firstNumber(flat) === null) {
      problems.push('A reply argues with a number from the sheet: name one.')
    }
  }
  const pronoun = OUR_PRONOUNS.exec(flat)
  if (pronoun) {
    problems.push(
      `The reporters are outside media: never "${pronoun[0]}". Write "the Boogeymen" or "the club".`,
    )
  }
  // Names on the sheet ("NHL 27", a gamertag or club with digits) are not numbers (C3a fix M3).
  const unnamed = withoutSheetNames(text, facts)
  for (const [i, sentence] of sentences(text).entries()) {
    const n = numberTokens(sentences(unnamed)[i] ?? sentence)
    if (n > MAX_NUMBERS_PER_SENTENCE) {
      problems.push(
        `"${sentence}" has ${String(n)} numbers. Use at most ${String(MAX_NUMBERS_PER_SENTENCE)} in a sentence.`,
      )
    }
  }
  if (isArticle) {
    const clocks = countMatches(text, CLOCK)
    if (clocks > MAX_ARTICLE_CLOCKS) {
      problems.push(
        `The article has ${String(clocks)} clock times. Use at most ${String(MAX_ARTICLE_CLOCKS)}.`,
      )
    }
  }
  const pairs = shotPairs(facts)
  for (const m of text.matchAll(SHOT_PAIR)) {
    const x = tokenValue(m[1]!)
    const y = tokenValue(m[2]!)
    if (!pairs.has(`${String(x)}/${String(y)}`)) {
      problems.push(`"${m[0]}" is not a goals-and-shots pair on the fact sheet.`)
    }
  }
  const early = endedEarlyNumbers(facts)
  if (early !== null) {
    for (const m of collapse(unnamed).replace(CLOCK, ' ').matchAll(DIGIT_RUN)) {
      if (!early.has(parseDigits(m[0]))) {
        problems.push(
          `The game ended early: give it one neutral line with the score only, no other numbers (${m[0]}).`,
        )
        break
      }
    }
  }
  if (PLUS_MINUS.test(flat) || MINUS_SKATER.test(flat)) {
    problems.push('Plus-minus and game score are not on the sheet: never cite them.')
  }
  for (const m of flat.matchAll(PIM_MENTION)) {
    if (Number(m[1]) < PIM_MIN) {
      problems.push(`Penalty minutes only from ${String(PIM_MIN)}: drop "${m[0]}".`)
    }
  }
  if (STRONG_WORDS.test(flat)) {
    problems.push('The text uses a word the desk never prints. Keep the language clean.')
  }
  const mild = countMatches(flat, MILD_WORDS)
  if (mild > 0) {
    const allowed = ctx.reporter !== undefined && REPORTERS[ctx.reporter].language === 'mild'
    if (!allowed) {
      problems.push(
        'Only Dex Mercer, Gord Pettibone and Rico Vale may swear (mildly); write clean.',
      )
    } else if (mild > MAX_MILD_SWEARS) {
      problems.push(
        `The text has ${String(mild)} mild swear words. Use at most ${String(MAX_MILD_SWEARS)}.`,
      )
    }
  }
  if (ctx.reporter !== undefined && length !== 'none') {
    const max = length === 'post' ? POST_MAX_SIGNATURE_WORDS : ARTICLE_MAX_SIGNATURE_WORDS
    const n = signatureWordCount(flat, ctx.reporter)
    if (n > max) {
      problems.push(
        `The text uses ${String(n)} of ${REPORTERS[ctx.reporter].name}'s signature words (${SIGNATURE_WORDS[ctx.reporter].join(', ')}). Lean less on your signature words: at most ${String(max)}.`,
      )
    }
  }
  problems.push(...labelClaims(flat, facts))
  problems.push(...zeroCalledProblems(text, facts, out.zeroCalled, ctx))
  if (out.stances !== undefined) {
    const keys = new Set(facts.threads.map((t) => t.key))
    for (const st of out.stances) {
      if (!keys.has(st.threadKey)) {
        problems.push(`The stance's threadKey "${st.threadKey}" is not a thread on the fact sheet.`)
      }
    }
  }
  if (out.takesUsed !== undefined) {
    const offered = new Set(ctx.offeredTakes ?? [])
    if (out.takesUsed.length > 1) problems.push('A piece may voice at most one reporter take.')
    for (const id of out.takesUsed) {
      if (!offered.has(id)) problems.push(`Take ${String(id)} was not offered to this piece.`)
    }
  }
  return problems
}

/** The weekday-and-date of a sentence ("Friday, May 8", "May 8"), for the opening rule. */
const DATE_WORDS =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/i
const WLO_RECORD = /\b\d+-\d+-\d+\b/

/** Headline and dek rules (spec §12.12-9) and the opening rule (§12.12-7). */
function headlineProblems(article: {
  headline: string
  dek: string
  paragraphs: string[]
}): string[] {
  const problems: string[] = []
  const headline = collapse(article.headline)
  const dek = collapse(article.dek)
  if (SCORELINE_HEADLINE.test(headline)) {
    problems.push(`The headline names the night's one story, not a tally like "X wins, Y loss".`)
  }
  if (headline.toLowerCase() === dek.toLowerCase()) {
    problems.push('The dek repeats the headline. Say something new in it.')
  }
  const record = WLO_RECORD.exec(headline)
  if (record !== null && dek.includes(record[0])) {
    problems.push(`The record ${record[0]} is in both the headline and the dek: give it once.`)
  }
  const first = sentences(article.paragraphs[0] ?? '')[0] ?? ''
  if (DATE_WORDS.test(first) && WLO_RECORD.test(first)) {
    problems.push('The article opens with the date and the record. Open with the story.')
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
  ctx: PieceContext = {},
): string[] {
  const clocks = clockProblems(text, facts)
  const problems = [...clocks.problems, ...numberProblems(clocks.rest, allowedNumbers(facts))]

  // The problem text never repeats the name: it goes back to the model in the
  // rewrite prompt, into news_jobs.last_error and into the logs.
  const flat = collapse(text)
  if (forbiddenNames.some((name) => containsName(flat, name))) {
    problems.push(FORBIDDEN_NAME_PROBLEM)
  }

  // AI goalies on the sheet may be named (spec §12.8); they are not people,
  // so `criticized` (people only) still rejects them. Nor are record holders.
  const allowedNames = new Set<string>([
    ...facts.people.map((p) => p.name),
    ...REPORTER_IDS.map((id) => REPORTERS[id].name),
    ...aiGoalieNames(facts),
    // Club record holders (C2.4): members the sheet may name, also when they did not play.
    ...facts.records.flatMap((r) => (r.holder === null ? [] : [r.holder])),
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

  // Opponents on the sheet, and the lore's club names (spec §12.13: the farm team).
  const clubs = new Set(
    [...facts.games.map((g) => g.opponentName), ...LORE_NAMES].map((c) =>
      collapse(c).toLowerCase(),
    ),
  )
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
  } else {
    const range = WORD_RANGE[length]
    if (range !== undefined) {
      const [min, max] = range
      const words = flat === '' ? 0 : flat.split(' ').length
      if (words < min || words > max) {
        problems.push(
          `The article body has ${String(words)} words. It must have ${String(min)} to ${String(max)}.`,
        )
      }
    }
  }
  problems.push(...styleProblems(text, facts, out, length, ctx))
  return [...new Set(problems)]
}

/** The body's length rule of a night or week sheet: a one-game night is shorter (spec §12.12-7). */
function articleLength(facts: NewsFacts): LengthRule {
  return facts.kind === 'night' && facts.games.length === 1 ? 'night-single' : 'article'
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
  ctx: PieceContext = {},
): CheckResult {
  const problems = check(
    text,
    facts,
    forbiddenNames,
    out,
    facts.kind === 'game' ? 'post' : articleLength(facts),
    criticizedTonight,
    ctx,
  )
  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}

/**
 * The whole article: the body gets the length rule; the headline, dek and
 * summary get the number, name and club rules but no length rule.
 */
export interface ArticleContext extends PieceContext {
  /**
   * A big game's article (C3a.7): `game-story` 200-350 words, `game-feature`
   * (spotlight or column) 400-700. Default: the night article (250-450, a
   * one-game night 120-200).
   */
  length?: 'game-story' | 'game-feature'
}

/** The C3a fields of an output, as `ListedOutput` takes them. */
function listed(a: {
  mentions: string[]
  clubs: string[]
  criticized: string[]
  zeroCalled?: string[]
  stances?: { threadKey: string; stance: string }[]
  takesUsed?: number[]
}): ListedOutput {
  return {
    mentions: a.mentions,
    clubs: a.clubs,
    criticized: a.criticized,
    ...(a.zeroCalled === undefined ? {} : { zeroCalled: a.zeroCalled }),
    ...(a.stances === undefined ? {} : { stances: a.stances }),
    ...(a.takesUsed === undefined ? {} : { takesUsed: a.takesUsed }),
  }
}

/** Headline, dek, summary and stance texts: number, name and club rules, no length (and no signature count). */
function sideText(parts: (string | undefined)[]): string {
  return parts.filter((x): x is string => x !== undefined && x.trim() !== '').join('\n')
}

export function checkArticleFacts(
  article: {
    headline: string
    dek: string
    paragraphs: string[]
    summary: string
    mentions: string[]
    clubs: string[]
    criticized: string[]
    zeroCalled?: string[]
    stances?: { threadKey: string; stance: string }[]
    takesUsed?: number[]
  },
  facts: NewsFacts,
  forbiddenNames: string[],
  criticizedTonight: readonly string[] = [],
  ctx: ArticleContext = {},
): CheckResult {
  const problems = [
    ...check(
      article.paragraphs.join('\n\n'),
      facts,
      forbiddenNames,
      listed(article),
      ctx.length ?? articleLength(facts),
      criticizedTonight,
      ctx,
    ),
    ...check(
      sideText([
        article.headline,
        article.dek,
        article.summary,
        ...(article.stances ?? []).map((st) => st.stance),
      ]),
      facts,
      forbiddenNames,
      { mentions: [], clubs: [] },
      'none',
      [],
      ctx.reporter === undefined ? {} : { reporter: ctx.reporter },
    ),
    ...headlineProblems(article),
  ]
  const unique = [...new Set(problems)]
  return unique.length === 0 ? { ok: true } : { ok: false, problems: unique }
}

/**
 * The fact check of a game's posts (each post as `checkFacts`). The pile-on
 * limit counts the night's earlier items and the earlier post of the same game.
 */
export interface GamePostsContext {
  /** Per post: whether it is a reply (in post order). */
  replies?: readonly boolean[]
  zeroCalledTonight?: readonly string[]
  zeroCalledPrevious?: readonly string[]
  /** Per post: the ids of the takes it was offered (in post order). */
  offeredTakes?: readonly (readonly number[])[]
}

export function checkGamePosts(
  posts: readonly {
    reporter?: ReporterId
    text: string
    mentions: string[]
    clubs: string[]
    criticized: string[]
    zeroCalled?: string[]
    stances?: { threadKey: string; stance: string }[]
    takesUsed?: number[]
  }[],
  facts: NewsFacts,
  forbiddenNames: string[],
  criticizedTonight: readonly string[] = [],
  ctx: GamePostsContext = {},
): CheckResult {
  const problems: string[] = []
  posts.forEach((p, i) => {
    const earlier = posts.slice(0, i)
    const r = checkFacts(
      p.text,
      facts,
      forbiddenNames,
      listed(p),
      [...criticizedTonight, ...earlier.flatMap((q) => q.criticized)],
      {
        ...(p.reporter === undefined ? {} : { reporter: p.reporter }),
        isReply: ctx.replies?.[i] === true,
        zeroCalledTonight: [
          ...(ctx.zeroCalledTonight ?? []),
          ...earlier.flatMap((q) => q.zeroCalled ?? []),
        ],
        zeroCalledPrevious: ctx.zeroCalledPrevious ?? [],
        offeredTakes: ctx.offeredTakes?.[i] ?? [],
      },
    )
    if (!r.ok) problems.push(...r.problems)
    const side = sideText((p.stances ?? []).map((st) => st.stance))
    if (side !== '')
      problems.push(...check(side, facts, forbiddenNames, { mentions: [], clubs: [] }, 'none'))
  })
  const unique = [...new Set(problems)]
  return unique.length === 0 ? { ok: true } : { ok: false, problems: unique }
}

/** A prediction or receipt of at least this many words must not come back inside the body. */
const REPEAT_MIN_WORDS = 4

const normalizedText = (t: string): string =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

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
    zeroCalled?: string[]
    stances?: { threadKey: string; stance: string }[]
    takesUsed?: number[]
    prediction: string
    receipt: string
    /** C3a.4: checked when given (null = "none"). */
    receiptVerdict?: 'hit' | 'miss' | null
  },
  facts: NewsFacts,
  forbiddenNames: string[],
  rules: { kind: FeatureKind; previousPrediction: string | null },
  criticizedTonight: readonly string[] = [],
  ctx: PieceContext = {},
): CheckResult {
  const problems = [
    ...check(
      feature.paragraphs.join('\n\n'),
      facts,
      forbiddenNames,
      listed(feature),
      'feature',
      criticizedTonight,
      ctx,
    ),
    ...check(
      sideText([
        feature.headline,
        feature.dek,
        feature.summary,
        feature.receipt,
        feature.prediction,
        ...(feature.stances ?? []).map((st) => st.stance),
      ]),
      facts,
      forbiddenNames,
      { mentions: [], clubs: [] },
      'none',
      [],
      ctx.reporter === undefined ? {} : { reporter: ctx.reporter },
    ),
    ...headlineProblems(feature),
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
  // C3a.9: the receipt opens and the prediction closes the printed piece; the body never repeats them.
  const body = normalizedText(feature.paragraphs.join(' '))
  for (const [what, value] of [
    ['prediction', feature.prediction],
    ['receipt', feature.receipt],
  ] as const) {
    const v = normalizedText(value)
    if (v.split(' ').length >= REPEAT_MIN_WORDS && body.includes(v)) {
      problems.push(
        `The ${what} is printed on its own (${what === 'receipt' ? 'first' : 'last'} paragraph); do not repeat it in "paragraphs".`,
      )
    }
  }
  if (feature.receiptVerdict !== undefined) {
    if (rules.previousPrediction === null && feature.receiptVerdict !== null) {
      problems.push('There was no previous prediction, so receiptVerdict must be "none".')
    } else if (rules.previousPrediction !== null && feature.receiptVerdict === null) {
      problems.push(
        'receiptVerdict must be "hit" or "miss": say whether last week\'s prediction came true.',
      )
    }
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

/**
 * Drama a piece may claim only when a label or fact on the sheet supports it
 * (C2, spec §12.16: "no drama a label does not support"). Case-insensitive.
 * - "career high" (also "career-high"): a line's `bests` has a career high;
 * - "season high" (also "season-high"): a line's `bests` has a season or
 *   career high, or a team note is a season best ("… this season", "… of the
 *   season") (C2 fix I3);
 * - "slump" (slumps, slumped, slumping): a line's `noGoal` streak, a
 *   `player-slump` or `losing-streak` thread, or a `slide` / `panic` result
 *   (C2 fix I3);
 * - "upset" (upsets, "big upset"): a game whose `context.surprise` is not
 *   `expected` (also catches "upset" as a feeling: rephrase);
 * - "panic": a game whose `context.result` is `panic`;
 * - "blowout": a game whose `context.margin` is `blowout`;
 * - "meltdown" / "stole the game", "a steal": an AI goalie `label` (C2 fix M1);
 * - "first ... of the season" (up to 20 characters between, one sentence): a
 *   line's `firsts` or a title `debut`;
 * - "record" as an achievement ("club/team/franchise/all-time/new/single-season
 *   record", "record-breaking", "set/broke ... record"): a game's `newRecords`.
 *   A plain record such as "a 12-3-1 record" is not a claim, nor is a
 *   "team record" followed by a W-L-OTL record ("the team record now sits at
 *   12-3-1", C2 fix I3).
 * C3 wires this into the checks.
 */
export const LABEL_CLAIMS: readonly {
  phrase: string
  pattern: RegExp
  /** Tested on the text right after a match: when it matches, that match is no claim. */
  except?: RegExp
  /** Tested on the match's sentence: when true, that match is no claim (C3a). */
  exceptSentence?: (sentence: string, facts: NewsFacts) => boolean
  supported: (facts: NewsFacts) => boolean
  problem: string
}[] = [
  {
    phrase: 'career high',
    pattern: /\bcareer[- ]highs?\b/i,
    supported: (f) => lines(f).some((p) => p.bests.some((b) => b.startsWith('career high'))),
    problem: 'It says "career high", but no line on the fact sheet has a career high.',
  },
  {
    phrase: 'season high',
    pattern: /\bseason[- ]highs?\b/i,
    supported: (f) =>
      lines(f).some((p) => p.bests.length > 0) ||
      f.games.some((g) =>
        g.teamNotes.some((n) => /\b(this season|of the season)\b/.test(n) && !/streak/.test(n)),
      ),
    problem:
      'It says "season high", but no line or team note on the fact sheet has a season or career high.',
  },
  {
    phrase: 'slump',
    pattern: /\bslump(s|ed|ing)?\b/i,
    supported: (f) =>
      lines(f).some((p) => p.streaks.some((s) => s.kind === 'noGoal')) ||
      f.threads.some((t) => t.kind === 'player-slump' || t.kind === 'losing-streak') ||
      f.games.some((g) => g.context?.result === 'slide' || g.context?.result === 'panic'),
    problem: 'It says "slump", but the fact sheet has no slump (8+ games without a goal).',
  },
  {
    phrase: 'upset',
    pattern: /\bupsets?\b/i,
    supported: (f) => f.games.some((g) => g.context !== null && g.context.surprise !== 'expected'),
    problem: 'It says "upset", but no game on the fact sheet is labelled an upset.',
  },
  {
    phrase: 'panic',
    pattern: /\bpanic(s|ked|king)?\b/i,
    supported: (f) => f.games.some((g) => g.context?.result === 'panic'),
    problem: 'It says "panic", but no game on the fact sheet has the panic label.',
  },
  {
    phrase: 'blowout',
    pattern: /\bblow-?outs?\b/i,
    supported: (f) => f.games.some((g) => g.context?.margin === 'blowout'),
    problem: 'It says "blowout", but no game on the fact sheet is labelled a blowout.',
  },
  {
    phrase: 'meltdown',
    pattern: /\bmelt[- ]?downs?\b/i,
    supported: (f) => f.games.some((g) => g.aiGoalie?.label === 'meltdown'),
    problem: 'It says "meltdown", but no AI goalie line on the fact sheet has the meltdown label.',
  },
  {
    phrase: 'steal',
    // Goalie context only (C2 re-review): "stole the game", "a steal in net",
    // or an AI goalie's name within a few words; a hockey takeaway ("a
    // steal and a goal") is no claim.
    pattern:
      /\b(stole|steals?|stealing) (the|a|this) (game|win|night)\b|\ba steal (in net|in goal|between the pipes)\b|\b(win|game|night) was a steal\b|\b(Lehmann|Wagner)\b\W+(?:\w+\W+){0,4}?(stole|steals?|stealing)\b|\b(stole|steals?|stealing|steal)\b\W+(?:\w+\W+){0,4}?(Matteo Lehmann|Jonas Wagner|Lehmann|Wagner)\b/i,
    supported: (f) => f.games.some((g) => g.aiGoalie?.label === 'steal'),
    problem:
      'It says the AI goalie stole the game, but no AI goalie line on the fact sheet has the steal label.',
  },
  {
    phrase: 'first ... of the season',
    pattern: /\bfirst\b[^.!?]{0,20}\bof the season\b/i,
    supported: (f) => lines(f).some((p) => p.firsts.length > 0 || p.debut === 'title'),
    problem:
      'It says "first ... of the season", but no line on the fact sheet has a season first or a title debut.',
  },
  {
    phrase: 'record',
    pattern:
      /\b(club|team|franchise|all-time|new|single-season)\s+records?\b|\brecord[- ](breaking|setting|breaker)\b|\b(set|sets|setting|broke|breaks|breaking|smashed|smashes|tied|ties)\s+(a|the|his|their)\s+(\w+\s+){0,2}records?\b/i,
    // "team record now sits at 12-3-1": a three-part W-L-OTL record right
    // after "record (now) sits / stands / is / at ..." is no claim; a score
    // ("an 11-2 rout") never cancels it (C2 re-review).
    except:
      /^\s*(?:now\s+)?(?:sits|stands|is|was|at|of|reads|moves|moved|improves|improved|falls|fell|drops|dropped|goes|went|to)\b[^.!?\d]{0,20}\d+-\d+-\d+\b/i,
    // "Old Sniper set the record with 61 in NHL 24": the sheet's record holder
    // and his old record (the sentence opens with a holder, no "new"/"broke").
    exceptSentence: (sentence, f) =>
      f.records.some(
        (r) =>
          r.holder !== null &&
          sentence.toLowerCase().startsWith(r.holder.toLowerCase()) &&
          /\b(set|sets|holds|owns|has)\b/i.test(sentence) &&
          !/\b(new|broke|breaks|breaking|smashed|smashes|tied|ties)\b/i.test(sentence),
      ),
    supported: (f) => f.games.some((g) => g.newRecords.length > 0),
    problem: 'It claims a record, but no new club record is on the fact sheet.',
  },
]

function lines(f: NewsFacts) {
  return f.games.flatMap((g) => g.players)
}

/** The problems for drama the sheet's labels do not support (`LABEL_CLAIMS`). */
export function labelClaims(text: string, facts: NewsFacts): string[] {
  return LABEL_CLAIMS.filter((c) => claimed(c, text, facts) && !c.supported(facts)).map(
    (c) => c.problem,
  )
}

/** Whether `text` makes the claim: a match not followed by the claim's `except`. */
function claimed(c: (typeof LABEL_CLAIMS)[number], text: string, facts: NewsFacts): boolean {
  const re = new RegExp(
    c.pattern.source,
    c.pattern.flags.includes('g') ? c.pattern.flags : `${c.pattern.flags}g`,
  )
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    const after = text.slice(at + m[0].length)
    if (c.except !== undefined && c.except.test(after)) continue
    if (c.exceptSentence !== undefined) {
      const start = Math.max(0, ...['.', '!', '?'].map((p) => text.lastIndexOf(p, at) + 1))
      const end = text.slice(at).search(/[.!?](\s|$)/)
      const sentence = text.slice(start, end < 0 ? undefined : at + end + 1).trim()
      if (c.exceptSentence(sentence, facts)) continue
    }
    return true
  }
  return false
}
