import {
  REPORTERS,
  REPORTER_IDS,
  compareMilestones,
  nightLabel,
  pairAttitude,
  type FeatureKind,
  type GameArticleKind,
  type NewsFacts,
  type NewsTake,
  type NewsTopFact,
  type Reporter,
  type ReporterId,
} from '@eanhl/db/news'
import { ANGLE_TEXT, type PostAssignment } from './assign.ts'

const MAX_UNLOCKS = 12
const MAX_MILESTONES = 10

/** JSON with keys sorted at every depth, so the same sheet always gives the same bytes (prompt-cache stable). */
export function stableStringify(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>
      return Object.fromEntries(
        Object.keys(o)
          .sort()
          .map((k) => [k, sort(o[k])]),
      )
    }
    return v
  }
  return JSON.stringify(sort(value))
}

/**
 * The sheet as the model sees it: at most 12 unlocks (card unlocks first, then
 * badges) and 10 milestones (100s, then 50s, then the rest; points, goals,
 * assists, games; then the larger value). The fact CHECK still uses the full sheet.
 */
export function capFactsForPrompt(facts: NewsFacts): NewsFacts {
  const isCard = (u: { text: string }) => /card/i.test(u.text)
  const unlocks = [...facts.unlocks.filter(isCard), ...facts.unlocks.filter((u) => !isCard(u))]
  // Spec 12.7: round numbers first (100s, then 50s, then the rest), points
  // before goals before assists before games, then the larger value, then the
  // sheet's order (stable sort). Sheets from the web app already carry at
  // most 3 (spec 12.12-10); the cap here guards an older sheet.
  const milestones = [...facts.milestones].sort(compareMilestones)
  return {
    ...facts,
    unlocks: unlocks.slice(0, MAX_UNLOCKS),
    milestones: milestones.slice(0, MAX_MILESTONES),
  }
}

/**
 * The sheet JSON of a request. The ranked facts are not in it: they come as
 * "the story" and the background lines (C3a.3), so the prompt stays short.
 */
function sheet(facts: NewsFacts): string {
  return stableStringify({ ...capFactsForPrompt(facts), topFacts: [] })
}

/**
 * When the sheet's games were played, in words ("Monday, October 12"), so the
 * writer never has to turn a YYYY-MM-DD key into a date. Every digit in the
 * label is in the sheet's key or games[].night, so the fact check passes it.
 */
export function whenLine(facts: NewsFacts): string {
  if (facts.kind !== 'week') return `The night: ${nightLabel(facts.key)}.`
  const nights = [...new Set(facts.games.map((g) => g.night))].sort()
  const parts = [`The week starts on ${nightLabel(facts.key)}.`]
  if (nights.length > 0) parts.push(`Game nights: ${nights.map(nightLabel).join('; ')}.`)
  return parts.join(' ')
}

/**
 * The writing rules (spec §12.8–§12.19), grouped. Stable text (cached by the
 * API) together with the voices; numbered for the rewrite prompt's problems.
 */
export const SYSTEM_RULES: readonly string[] = [
  'FACTS',
  '1. Take every fact from the fact sheet and from nowhere else. A number you write must appear on the sheet exactly as written there. Do not add, subtract, round or convert numbers. Do not write a date or a time unless the sheet has it. Numbers written as words are checked the same way as digits. Never write a date as YYYY-MM-DD; use the weekday, or the month and day, as the request words it (for example "Monday, October 12").',
  '2. Time on attack ("timeOnAttackSeconds", the norms\' "timeOnAttack") is in SECONDS. Write it as seconds ("412 seconds of attack time") or not at all; never as a clock time such as 6:52.',
  '3. Name people exactly as written in "people[].name". Write no other person: no opponent players, no guests, no real-life names. A club record holder in "records" may be named as written there. Name an opponent club exactly as in "games[].opponentName", and name no other opponent club. "unnamedTeammates" in a game is the number of club teammates who played but asked not to be named. They are teammates, not guests. Never name them, hint at who they are, or single them out; write about the team as a whole instead. "guestCount" is the number of players from outside the club.',
  '4. The AI goalies, Matteo Lehmann and Jonas Wagner, play in net when no teammate does ("aiGoalieInNet"). Name one only as written on the sheet ("games[].aiGoalie.name"). Praise and blame of their numbers are allowed (saves, shots against, save %), from the sheet only. They are not teammates and not club members; never call them that. Press levels and the pile-on limit do not apply to them.',
  '5. Goals and assists by people not named on the sheet are in "unnamedGoals" / "unnamedAssists" of each game. Never say a named player\'s goal was the only goal, or that a named player did something alone, unless the sheet shows it.',
  '6. Do not invent quotes from teammates or from opponents. The reporters are fictional, so they may quote each other and answer each other, also second-hand ("Quill called it variance"). A colleague\'s line is optional: at most about one article in three ends with one.',
  '7. Opinion is allowed when it follows from the stats ("29 shots against says the defence was under siege"). Invented events are not: no shot off the post, no save, no pass, no line change, no mood in the room, no argument, no play-by-play. No off-ice events or places either (a group chat, a practice, the locker room, the bench, travel, a crowd), and no claims about what a player wanted, felt or thought. There is no video or play-by-play data, only the numbers on the sheet.',
  '8. A tactical point must name the number it comes from. Do not describe plays, movements, positions on the ice or sequences; the sheet has none.',
  '9. When a game has a goal timeline, you may say in which period and at which clock time a goal came, who scored it for the Boogeymen and who assisted, and that an opponent scored. clockMeaning says whether the clock counts up (elapsed) or down (remaining). Do not describe how a goal was scored — the timeline has no play details. A goal with scorer null was scored by someone you may not name, or by the opponent; name no one for it. Write a clock exactly as in "goals[].clock".',
  '10. Never cite plus-minus or game score; they are not on the sheet. A player\'s position in a game is "games[].players[].position": F forward, D defence, G goalie.',
  '11. A game with "endedEarly" true ended early: give it one neutral line with the result and the score only. No other numbers about it: no shots, no attack time, no conversion.',
  '12. "lore" holds club lore. Use a lore fact when it fits; invent nothing around it (no games, scores, call-ups or players of the farm team).',
  'LABELS',
  '13. Labels are binding. Call something a career high, a season high, a slump, an upset, panic, a blowout, a meltdown, a steal, a first of the season or a record only when a label or fact on the sheet says so ("bests", "firsts", "streaks", "threads", "context", "aiGoalie.label", "newRecords"). No drama that no label supports. Season and career highs count only games of the same mode: always name the mode with one ("a career high in 6s"). Never mention the fact sheet, its labels or its fields ("the sheet calls it a steal", "the label says"): state the fact itself ("a steal in net").',
  '14. The result label ("games[].context.result") sets the mood: "rolling" rolls, a "blip" gets a shrug, a "slide" gets concern, "panic" gets panic, a "turnaround" gets relief, "normal" is a normal night.',
  '15. Typical patterns are not news. A pattern "as usual" and a "typical" label are the club\'s identity: mention one now and then at most, and write about what was different.',
  '16. Each request names "the story": the top facts for this piece. Build the piece on them; the rest of the sheet is background.',
  'TONE',
  '17. Winning fixes almost everything. After a win the piece reads like a win. A big individual night (3+ goals, 5+ points, or a "big for him" label) is credited first and never called luck, variance or unrepeatable. "Not repeatable" may be said only about the team, at most once a night. Dex Mercer and Gord Pettibone are built to complain and keep their caveats. A loss does not always deserve doom: let the numbers decide.',
  '18. Criticism is about hockey only: the game, the stats, the choices on the ice. Never write about real life, looks, family, work, health or the person.',
  '19. Each person on the sheet has a "pressLevel". "full" means a reporter may be harsh about that player\'s games. "easy" means criticism of that player stays mild. Rule 18 applies at both levels.',
  'FAIRNESS',
  '20. Put every person you criticise harshly in "criticized", spelled exactly as in people[].name; use an empty list when you are harsh about nobody. The desk allows at most one harsh piece about the same player per night: a person on the request\'s "Already criticised harshly tonight" list may be named, but not criticised harshly again; take another angle on them. Never criticise a player whose pressLevel is "easy" harshly, and never list one in "criticized".',
  '21. A zero call-out names a player for a zero ("0 shots", "no points"). Never for a D or a G. At most one per night: when the request\'s "Zero call-outs tonight" line names anyone, write none. Never a player on the request\'s "Zero call-outs last night" line. Put the player of a zero call-out in "zeroCalled"; an empty list when none.',
  '22. Penalty minutes only when a player has 10 or more, and at most once a night.',
  "23. A reply argues with a number from the sheet. No remarks about the other reporter's motives, clicks, outrage, jealousy, timing or career.",
  '24. Reporter takes: a request may list a reporter take on a player (private notes of the desk). Only the take\'s critic voices it, in their own words, as an opinion backed by the take\'s data angle and the numbers on the sheet; the defender may push back with the data angle. Never quote a take or say it is a note. At most one take per piece, never two "weaker player" takes in one piece; hockey only; the pile-on limit and press levels apply, and a take marked mild stays mild. Put the id of a take you used in "takesUsed"; an empty list when none.',
  '25. Open threads ("threads") are stories that run over several nights; "stances" are the reporters\' earlier opinions on them. A reporter may take a stance on a thread of the request in one short sentence (put it in "stances" with the thread\'s key), and may say "I told you so" or "I was wrong" about their own earlier stance. Only their own stances; an empty list when none.',
  '26. Language: mild swearing (hell, damn, crap) only for Dex Mercer, Gord Pettibone and Rico Vale, mostly in posts, at most once a piece. Everyone else writes clean. Never a slur, never a stronger word, never swearing aimed at a person.',
  'CRAFT',
  '27. At most 3 numbers in a sentence. No list of more than 3 values. At most 2 clock times in an article.',
  '28. An article never opens with the date and the record.',
  '29. A headline names the night\'s one story, in sentence case (capitals only for the first word and for names). Never a headline like "X wins, Y loss". The record goes in the dek or the body, once. The dek never repeats the headline.',
  '30. Each milestone gets its own sentence, never a roll call.',
  '31. No format labels ("The tactical point is", "The detail:", "less comfortable"). At most one "not X, but Y" contrast per piece. A post makes one point.',
  '32. Lean on your signature words less: at most one of them in a post, at most three in an article. Do not repeat a phrase from your own recent pieces (the request lists them).',
  'STYLE',
  '33. The reporters are outside media: never write "we", "us", "our" or "ours"; write "the Boogeymen" or "the club".',
  '34. Scores winner first ("beat Shake N Bake 4-2", "lost to Shake N Bake 6-2"). Percentages as "83.1%". Records as "40-11-5". Dates as "Friday, May 8".',
  'FORMAT',
  '35. Plain text only. No @ mentions, no links, no hashtags, no emoji, no markdown. Do not write "@everyone" or "@here".',
  '36. Put every person you name in "mentions" and every opponent club you name in "clubs", spelled exactly as in the sheet. Reporter names may be listed in "mentions". Use empty lists when you name nobody.',
  '37. Write as the reporter you are told to write as. Keep the voice of the reporter.',
]

/** Stable text (cached by the API): the desk's purpose, the rules, then each reporter's voice. */
export function buildSystemPrompt(reporters: Reporter[]): string {
  const rules = [
    "You write for the Boogeymen News Desk. The Boogeymen are a small club of friends who play EA NHL Pro Clubs together. The desk has fictional reporters. You write short posts and articles about the club's games, for the club's Discord and website. The readers are the players themselves, so the tone is playful and sharp, but the facts must be right.",
    'You get a fact sheet as JSON in each request. Follow these rules in every piece, whichever reporter you write as.',
    ...SYSTEM_RULES,
  ].join('\n\n')

  const voices = reporters
    .map((r) => `${r.name} (id "${r.id}"), ${r.outlet}\n${r.voice}`)
    .join('\n\n---\n\n')

  return `${rules}\n\nTHE REPORTERS\n\n${voices}`
}

// ── Request context (C3a.3) ─────────────────────────────────────────────────

/** How many top facts make "the story" of a piece (spec §12.17-2). */
export const STORY_FACTS = 5
/** At most this many background facts after the story (C3a fix M7). */
export const BACKGROUND_FACTS = 15
/** How many of the reporter's own last pieces a request shows. */
export const OWN_RECENT_PIECES = 5

/** One of the reporter's own recent pieces (a post's text, or an article's headline and summary). */
export interface OwnPiece {
  kind: 'post' | 'article'
  text: string
  night: string | null
}

/** One post of the night so far, for the night article. */
export interface NightPost {
  reporter: string
  text: string
}

/**
 * The parts of a request that depend on what the desk already wrote: they sit
 * in one block (between `DESK_CONTEXT_START` and `DESK_CONTEXT_END`) so the
 * backfill can swap it once the earlier jobs are accepted.
 */
export interface DeskContext {
  criticizedTonight: readonly string[]
  zeroCalledTonight: readonly string[]
  zeroCalledPrevious: readonly string[]
  /** Per reporter of the request, its own last pieces (newest first). */
  ownRecent: Readonly<Partial<Record<ReporterId, readonly OwnPiece[]>>>
  /** Night articles: the night's posts, oldest first. */
  nightPosts?: readonly NightPost[]
  /** The reporter takes due for this request's reporters (spec §12.19); none when absent. */
  takes?: readonly NewsTake[]
}

export const EMPTY_DESK_CONTEXT: DeskContext = {
  criticizedTonight: [],
  zeroCalledTonight: [],
  zeroCalledPrevious: [],
  ownRecent: {},
}

export const DESK_CONTEXT_START = 'DESK CONTEXT (what the desk already wrote)'
export const DESK_CONTEXT_END = 'END OF DESK CONTEXT'

const CRITICIZED_TONIGHT_PREFIX = 'Already criticised harshly tonight:'

/** The pile-on line of a request (rev 2, B4): one line, so the backfill can swap it. */
export function criticizedTonightLine(names: readonly string[]): string {
  const who = names.length === 0 ? 'nobody' : names.join(', ')
  return `${CRITICIZED_TONIGHT_PREFIX} ${who}. Do not criticise these people harshly again tonight; take another angle on them.`
}

/** The request with its pile-on line replaced by one for `names` (unchanged when it has none). */
export function setCriticizedTonight(user: string, names: readonly string[]): string {
  const line = new RegExp(`^${CRITICIZED_TONIGHT_PREFIX}.*$`, 'm')
  return user.replace(line, () => criticizedTonightLine(names))
}

const list = (names: readonly string[]) => (names.length === 0 ? 'nobody' : names.join(', '))

/** The desk context block for the reporters of a request. */
export function deskContextBlock(ctx: DeskContext, reporters: readonly ReporterId[]): string {
  const lines = [
    DESK_CONTEXT_START,
    criticizedTonightLine(ctx.criticizedTonight),
    `Zero call-outs tonight: ${list(ctx.zeroCalledTonight)}.`,
    `Zero call-outs last night: ${list(ctx.zeroCalledPrevious)}.`,
  ]
  if (ctx.nightPosts !== undefined) {
    if (ctx.nightPosts.length === 0) {
      lines.push("Tonight's posts: none.")
    } else {
      lines.push(
        "Tonight's posts, oldest first. Reuse their numbers only to draw a new conclusion:",
        ...ctx.nightPosts.map((p) => {
          const r = REPORTER_IDS.find((id) => id === p.reporter)
          return `- ${r === undefined ? p.reporter : REPORTERS[r].name}: ${p.text}`
        }),
      )
    }
  }
  for (const id of [...new Set(reporters)]) {
    const own = ctx.ownRecent[id] ?? []
    const name = REPORTERS[id].name
    if (own.length === 0) {
      lines.push(`${name}'s own last pieces: none yet.`)
      continue
    }
    lines.push(`${name}'s own last pieces, newest first. Do not repeat their phrasing or images:`)
    for (const piece of own.slice(0, OWN_RECENT_PIECES)) {
      lines.push(
        `- ${piece.night === null ? 'undated' : piece.night} (${piece.kind}): ${piece.text}`,
      )
    }
  }
  const takes = takesBlock(ctx.takes ?? [], reporters)
  if (takes !== null) lines.push(takes)
  lines.push(DESK_CONTEXT_END)
  return lines.join('\n')
}

/** The request with its desk context block replaced (unchanged when it has none). */
export function setDeskContext(
  user: string,
  ctx: DeskContext,
  reporters: readonly ReporterId[],
): string {
  const start = user.indexOf(DESK_CONTEXT_START)
  const end = user.indexOf(DESK_CONTEXT_END)
  if (start < 0 || end < start) return user
  return (
    user.slice(0, start) +
    deskContextBlock(ctx, reporters) +
    user.slice(end + DESK_CONTEXT_END.length)
  )
}

/** The top facts not in `exclude`, at most `n`, in rank order. */
export function storyFacts(
  facts: NewsFacts,
  n: number = STORY_FACTS,
  exclude: ReadonlySet<string> = new Set(),
): NewsTopFact[] {
  return facts.topFacts.filter((f) => !exclude.has(f.id)).slice(0, n)
}

/** "The story" (top facts) and the background facts of a request. */
export function storyBlock(story: readonly NewsTopFact[], facts: NewsFacts): string {
  const inStory = new Set(story.map((f) => f.id))
  const background = facts.topFacts.filter((f) => !inStory.has(f.id)).slice(0, BACKGROUND_FACTS)
  const lines = ['The story (the top facts for this piece; build on them):']
  if (story.length === 0) lines.push('- (no ranked facts: use the sheet)')
  for (const f of story) lines.push(`- ${f.text}`)
  if (background.length > 0) {
    lines.push('Background facts (use only when they help):')
    for (const f of background) lines.push(`- ${f.text}`)
  }
  return lines.join('\n')
}

/** Open threads and earlier stances (spec §12.17-3). Empty when the sheet has none. */
export function threadsBlock(facts: NewsFacts): string | null {
  if (facts.threads.length === 0) return null
  const lines = ['Threads (key: summary):']
  for (const t of facts.threads) {
    lines.push(`- ${t.key}: ${t.summary} (${t.status === 'open' ? 'open' : 'closed tonight'})`)
  }
  if (facts.stances.length > 0) {
    lines.push('Stances so far, oldest first:')
    for (const st of facts.stances) {
      lines.push(`- ${REPORTERS[st.reporter].name} on ${st.threadKey}: "${st.stance}"`)
    }
  }
  return lines.join('\n')
}

/**
 * The reporter takes a request may use (spec §12.19), only those of the
 * request's reporters (as critic or defender). GM-only lore: never quoted.
 */
export function takesBlock(
  takes: readonly NewsTake[],
  reporters: readonly ReporterId[],
): string | null {
  const mine = takes.filter(
    (t) =>
      reporters.includes(t.reporter) ||
      t.critics.some((c) => reporters.includes(c)) ||
      (t.defender !== null && reporters.includes(t.defender)),
  )
  if (mine.length === 0) return null
  const lines = [
    'Reporter takes (private desk notes; never quote them or say they are notes; at most one per piece; put its id in "takesUsed"):',
  ]
  for (const t of mine) {
    const critics = [t.reporter, ...t.critics].map((c) => REPORTERS[c].name).join(', ')
    const parts = [
      `- Take ${String(t.id)} on ${t.player}: ${t.take}`,
      `critics: ${critics} (${t.spread} of the desk share it)`,
      t.defender === null ? 'no defender' : `defender: ${REPORTERS[t.defender].name}`,
      t.dataAngle === null ? null : `data angle: ${t.dataAngle}`,
      `intensity ${String(t.intensity)} (-2 soft .. +2 hard)`,
      t.mild ? `${t.player} is at press level "easy": keep it mild` : null,
    ].filter((x): x is string => x !== null)
    lines.push(parts.join('; '))
  }
  return lines.join('\n')
}

/** Prediction scorecards on a week sheet ("Quill is 4 for 7"). */
export function scorecardsLine(facts: NewsFacts): string | null {
  if (facts.scorecards.length === 0) return null
  return `Prediction scorecards: ${facts.scorecards
    .map((c) => `${REPORTERS[c.reporter].name} ${String(c.hits)} for ${String(c.judged)}`)
    .join('; ')}.`
}

function header(facts: NewsFacts): string[] {
  return ['Fact sheet (JSON):', sheet(facts), '', whenLine(facts), '']
}

/** What a recap post must say (rev 2, B1; spec §12.1). */
const RECAP_RULES =
  'The recap of the game says the result and the score, who scored for the Boogeymen, and exactly one key number besides the score. Name a scorer only as in people[].name. A goal for the Boogeymen by someone not named on the sheet: call the scorer "a guest" only when the game\'s unnamedTeammates is 0; otherwise credit the team, never a person. A goal against the Boogeymen was scored by "an opponent"; never name an opponent player. You may use the goal timeline (the period and the clock of a goal).'

/** The recap of a game that ended early (spec §12.12-3; C3a fix M1): the score only. */
const RECAP_RULES_ENDED_EARLY =
  'This game ended early ("endedEarly"): the recap is one neutral line with the result and the score, and no other number. Name a scorer only as in people[].name; a goal against the Boogeymen was scored by "an opponent".'

const PIECE_FIELDS_NOTE =
  'List in "criticized" the people the piece criticises harshly, in "zeroCalled" a player it calls out for a zero, in "stances" any stance on a thread (by its key), and in "takesUsed" the id of a take it voiced; an empty list when none. Remember: only numbers, names and clubs from the sheet, no invented quotes or events.'

/**
 * The game's posts (C3a.3/C3a.8): one numbered line per assigned post with
 * its reporter, angle and fact; post 1 is the recap.
 */
export function buildGameUserPrompt(args: {
  facts: NewsFacts
  posts: readonly PostAssignment[]
  ctx?: DeskContext
}): string {
  const { facts, posts } = args
  const ctx = args.ctx ?? EMPTY_DESK_CONTEXT
  const reporters = posts.map((p) => p.reporter)
  const factText = (id: string | null) => facts.topFacts.find((f) => f.id === id)?.text ?? null
  const used = new Set(posts.flatMap((p) => (p.factId === null ? [] : [p.factId])))
  const story = [
    ...posts.flatMap((p) => {
      const f = facts.topFacts.find((x) => x.id === p.factId)
      return f === undefined ? [] : [f]
    }),
    ...storyFacts(facts, STORY_FACTS, used),
  ].slice(0, Math.max(STORY_FACTS, used.size))
  const lines: string[] = [
    ...header(facts),
    'Task: write short posts about the game on the sheet. Each post is at most 280 characters, one to three sentences, with no line breaks, and makes one point.',
  ]
  if (posts.length === 1) {
    const r = REPORTERS[posts[0]!.reporter]
    lines.push(
      `Write exactly one post: the recap of the game, as ${r.name} (id "${r.id}") of ${r.outlet}.`,
    )
  } else {
    lines.push(`Write exactly ${String(posts.length)} posts, in this order:`)
    posts.forEach((p, i) => {
      const r = REPORTERS[p.reporter]
      if (i === 0) {
        lines.push(`1. The recap, as ${r.name} (id "${r.id}") of ${r.outlet}.`)
        return
      }
      const parts = [
        `${String(i + 1)}. As ${r.name} (id "${r.id}") of ${r.outlet}, angle "${p.angle}": ${ANGLE_TEXT[p.angle]}.`,
      ]
      const fact = factText(p.factId)
      if (fact !== null) parts.push(`Its fact: "${fact}".`)
      if (p.replyTo !== null) {
        const to = posts[p.replyTo]!
        parts.push(
          `It answers post ${String(p.replyTo + 1)} by ${REPORTERS[to.reporter].name} directly, and the reader sees it right under it. How they feel about each other: ${pairAttitude(p.reporter, to.reporter)}`,
        )
      }
      if (p.takeId !== null) parts.push(`It may voice take ${String(p.takeId)} (below).`)
      if (p.pushesBack !== undefined) {
        parts.push(
          `It pushes back on take ${String(p.pushesBack)} (below) with the take's data angle and a number from the sheet; it does not voice the take and lists no take in "takesUsed".`,
        )
      }
      lines.push(parts.join(' '))
    })
    lines.push(
      'Posts 2 and later do not repeat the score line or the list of scorers; each gives an opinion that follows from its own fact. No two posts make the same point.',
    )
  }
  lines.push('', storyBlock(story, facts))
  const threads = threadsBlock(facts)
  if (threads !== null) lines.push('', threads)
  lines.push(
    '',
    facts.games.some((g) => g.endedEarly) ? RECAP_RULES_ENDED_EARLY : RECAP_RULES,
    'Set "reporter" on each post to the id above.',
    PIECE_FIELDS_NOTE,
    '',
    deskContextBlock(ctx, reporters),
  )
  return lines.join('\n')
}

function articleFields(words: string): string[] {
  return [
    'Output fields:',
    '- headline: a short headline, at most 120 characters, in sentence case, naming one story.',
    '- dek: one line under the headline, at most 160 characters; the record goes here or in the body, once; never repeat the headline.',
    `- paragraphs: the article body, ${words} in total, as separate paragraphs. No headings, no lists. Never open with the date and the record.`,
    "- summary: one or two plain sentences saying what the article covers, for the reporter's own memory. Facts from the sheet only.",
    '- mentions and clubs: as in the rules.',
    '- criticized, zeroCalled, stances, takesUsed: as in the rules; empty lists when none.',
  ]
}

/** The night article (night sheets; C3a.3: story, threads, the night's posts, own pieces). */
export function buildArticleUserPrompt(args: {
  facts: NewsFacts
  reporter: Reporter
  ctx?: DeskContext
}): string {
  const { facts, reporter } = args
  const ctx = args.ctx ?? EMPTY_DESK_CONTEXT
  const single = facts.games.length === 1
  const lines: string[] = [
    ...header(facts),
    `Task: write one article about the whole night of games on the sheet, as ${reporter.name} (id "${reporter.id}") of ${reporter.outlet}. Use ${reporter.name}'s article format from the reporter notes.`,
    '',
    ...articleFields(single ? '120 to 200 words (a one-game night)' : '250 to 450 words'),
    '',
    storyBlock(storyFacts(facts), facts),
  ]
  const threads = threadsBlock(facts)
  if (threads !== null) lines.push('', threads)
  lines.push('', deskContextBlock({ ...ctx, nightPosts: ctx.nightPosts ?? [] }, [reporter.id]))
  return lines.join('\n')
}

/** What each big-game article is (C3a.7, spec §12.18-1). */
const GAME_ARTICLE_TASK: Record<GameArticleKind, string> = {
  game: 'the game story: the one game on the sheet as a news story, built on its top facts',
  spotlight:
    'a player spotlight on the one player who made this game, by his line and his labels on the sheet',
  column: "a column: the reporter's opinion of what this game means, argued from the sheet",
}

/** A big game's article (C3a.7): game story 200-350 words, spotlight or column 400-700. */
export function buildGameArticleUserPrompt(args: {
  facts: NewsFacts
  reporter: Reporter
  kind: GameArticleKind
  ctx?: DeskContext
}): string {
  const { facts, reporter, kind } = args
  const ctx = args.ctx ?? EMPTY_DESK_CONTEXT
  const story = storyFacts(facts)
  const spotlight = story.find((f) => facts.people.some((p) => p.name === f.subject))?.subject
  const lines: string[] = [
    ...header(facts),
    `Task: write ${GAME_ARTICLE_TASK[kind]}, as ${reporter.name} (id "${reporter.id}") of ${reporter.outlet}. Use ${reporter.name}'s article format from the reporter notes.`,
  ]
  if (kind === 'spotlight' && spotlight !== undefined) lines.push(`Spotlight player: ${spotlight}.`)
  lines.push(
    '',
    ...articleFields(kind === 'game' ? '200 to 350 words' : '400 to 700 words'),
    '',
    storyBlock(story, facts),
  )
  const threads = threadsBlock(facts)
  if (threads !== null) lines.push('', threads)
  lines.push('', deskContextBlock(ctx, [reporter.id]))
  return lines.join('\n')
}

/**
 * The spotlight player (rev 2, B3): the named player with the biggest
 * milestone this week (in the prompt cap's order), else the named player with
 * the most points this week (weekPlayers is sorted by points), else null.
 */
export function spotlightPlayer(facts: NewsFacts): string | null {
  const milestone = capFactsForPrompt(facts).milestones[0]
  if (milestone !== undefined) return milestone.name
  let best: NewsFacts['weekPlayers'][number] | null = null
  for (const p of facts.weekPlayers) if (best === null || p.points > best.points) best = p
  return best?.name ?? null
}

function featureTask(kind: FeatureKind, facts: NewsFacts): string[] {
  switch (kind) {
    case 'trend':
      return [
        'Kind: the trend column. Read the numbers across the weeks: "history" holds the four weeks before this one (oldest first; weeks without a game are left out), and the sheet holds this week. Name the trend the numbers show and back it with them.',
      ]
    case 'spotlight': {
      const who = spotlightPlayer(facts)
      return [
        'Kind: the player spotlight on one named player, with that player\'s week and title numbers from "weekPlayers" (and any milestone).',
        who === null
          ? 'Spotlight player: the named player with the most points this week.'
          : `Spotlight player: ${who}.`,
      ]
    }
    case 'notes':
      return [
        'Kind: the notes column: 10 to 15 short separate items about the week; each item is one paragraph (one entry in "paragraphs"). One item is always a jab, about hockey only.',
      ]
    case 'bigpicture':
      return [
        "Kind: the big-picture column: the big picture, then the evidence from this week's numbers, then a firm verdict.",
      ]
    case 'rink':
      return ["Kind: Father Rink's midnight column about the week, in his own format."]
  }
}

/** The weekly feature request (rev 2, B3; spec §12.3, §12.6; C3a.9). */
export function buildFeatureUserPrompt(args: {
  facts: NewsFacts
  reporter: Reporter
  kind: FeatureKind
  /** Last week's prediction, or null when there is none. */
  previousPrediction: string | null
  ctx?: DeskContext
}): string {
  const { facts, reporter, kind, previousPrediction } = args
  const ctx = args.ctx ?? EMPTY_DESK_CONTEXT
  const lines: string[] = [
    ...header(facts),
    `Task: write this week's in-depth feature about the whole week of games on the sheet, as ${reporter.name} (id "${reporter.id}") of ${reporter.outlet}.`,
    ...featureTask(kind, facts),
    '',
    previousPrediction === null
      ? "Last week's prediction: none."
      : `Last week's prediction: "${previousPrediction}"`,
  ]
  const cards = scorecardsLine(facts)
  if (cards !== null) lines.push(cards)
  lines.push(
    '',
    'Output fields:',
    '- headline: a short headline, at most 120 characters, in sentence case, naming one story.',
    '- dek: one line under the headline, at most 160 characters; never repeat the headline.',
    '- paragraphs: the feature body, 600 to 900 words in total, as separate paragraphs. No headings, no lists. Never open with the date and the record.',
    "- summary: one or two plain sentences saying what the feature covers, for the reporter's own memory. Facts from the sheet only.",
    '- mentions and clubs: as in the rules.',
    '- criticized, zeroCalled, stances, takesUsed: as in the rules; empty lists when none.',
    '- prediction: one short prediction about next week, in the reporter\'s voice, with no digits and no number words. It is printed as the last paragraph; do not repeat it in "paragraphs".',
    previousPrediction === null
      ? '- receipt: an empty string (there was no prediction last week).'
      : '- receipt: one or two sentences that restate last week\'s prediction and say whether it came true, judged only from this sheet. It is printed as the first paragraph; do not repeat it in "paragraphs".',
    previousPrediction === null
      ? '- receiptVerdict: "none".'
      : '- receiptVerdict: "hit" when the prediction came true, "miss" when it did not.',
    '',
    storyBlock(storyFacts(facts), facts),
  )
  const threads = threadsBlock(facts)
  if (threads !== null) lines.push('', threads)
  lines.push('', deskContextBlock(ctx, [reporter.id]))
  return lines.join('\n')
}

/** The system prompt of the review call (the second check). */
export const REVIEW_SYSTEM_PROMPT =
  'You are the second check of a news desk. You find invented quotes, invented events and personal criticism in short news texts. Answer only in the JSON format you are given.'

/** The user prompt of a rewrite: the first prompt plus the problems of the rejected attempt. */
export function buildRewritePrompt(user: string, problems: readonly string[]): string {
  return `${user}\n\nYour previous attempt was rejected for these problems. Write it again and fix all of them:\n${problems.map((p) => `- ${p}`).join('\n')}`
}

export function buildReviewPrompt(args: {
  facts: NewsFacts
  text: string
  /** The people the writer listed as criticised harshly. */
  criticized: readonly string[]
  /** The reporter takes the piece was offered (C3a.10). */
  takes?: readonly NewsTake[]
}): string {
  const listed = args.criticized.length === 0 ? 'nobody' : args.criticized.join(', ')
  const takes = args.takes ?? []
  const takeLines =
    takes.length === 0
      ? [
          'The writer was offered no reporter take: a running grudge or beef against a player is a problem.',
        ]
      : [
          'The writer was offered these reporter takes (private desk notes; only their critics may voice them):',
          ...takes.map(
            (t) =>
              `- take ${String(t.id)}: ${t.take} (on ${t.player}; critics ${[t.reporter, ...t.critics].map((c) => REPORTERS[c].name).join(', ')}${t.defender === null ? '' : `; defender ${REPORTERS[t.defender].name}`}${t.mild ? '; MILD (Go easy)' : ''})`,
          ),
          'In "problems", refer to a take only as "take N" (its id); never repeat or quote its words.',
        ]
  return [
    'You are the second check of a news desk. A fictional reporter wrote the text below from the fact sheet. A program already checked the digits and number words in the text, the names the reporter listed, the club names the reporter listed, swear words, pronouns and the labels it can match. It did not read the text for other names, for stats written in other ways, or for tone. Check what the program cannot check.',
    '',
    'Fact sheet (JSON):',
    sheet(args.facts),
    '',
    'Text to review (each post starts with its reporter; an article with "By <reporter>"):',
    '"""',
    args.text,
    '"""',
    '',
    `The writer listed these people as criticised harshly: ${listed}.`,
    ...takeLines,
    '',
    'Find these problems:',
    '1. An invented quote from a teammate or an opponent. (A fictional reporter quoting another reporter is fine, also second-hand.)',
    '2. An invented event: a shot off the post, a save, a pass, a line change, a mood or argument in the room, any play-by-play that the sheet does not support. Opinion that follows from the stats is fine. Facts from a game\'s "goals" timeline are allowed: the period and clock of a goal, who scored it for the Boogeymen, who assisted, and that an opponent scored. How a goal was scored is not on the sheet.',
    '3. Personal criticism: anything about real life, looks, family, work, health or the person instead of their hockey. Also: harsh criticism of a player whose pressLevel is "easy". The AI goalies (Matteo Lehmann, Jonas Wagner) may be praised or blamed for their numbers; calling one a teammate or a club member is a problem.',
    `4. A person named in the text who is not in the sheet's people[].name list, not a record holder in "records", not an AI goalie on the sheet, and not one of the desk's reporters (${REPORTER_IDS.map((id) => REPORTERS[id].name).join(', ')}). Opponent players, guests and real-life names are problems.`,
    '5. A stat stated in words that the program does not read, such as "hat trick", "dozen", "twice", "shutout", "brace", that the sheet does not support.',
    '6. A club that is not in games[].opponentName or the lore. Only those clubs (and the Boogeymen) are allowed; nothing invented around the lore.',
    '7. A reference to an off-ice event or place that the sheet does not support: a group chat, a practice, the locker room, the bench, travel, a crowd.',
    '8. A claim about what a player wanted, felt or thought.',
    '9. Harsh criticism of a player who is not on that list. Mild criticism is fine.',
    '10. Drama that no label on the sheet supports: a career high, season high, slump, upset, panic, blowout, meltdown, a steal or a record that the sheet\'s labels ("bests", "firsts", "streaks", "threads", "context", "aiGoalie.label", "newRecords") do not show; any mention of the fact sheet or its labels ("the sheet calls", "the label says"); a season or career high written without its mode (highs count only games of the same mode); a big individual night called luck after a win (Dex Mercer and Gord Pettibone may keep caveats); a typical pattern sold as news.',
    '11. A reporter take used unfairly: voiced by a reporter who is not one of its critics, quoted as a note or revealed as one, two "weaker player" takes in one piece, a take about anything but hockey, or a take marked MILD that is not mild. A grudge against a player without an offered take.',
    '12. Language: any swearing by a reporter other than Dex Mercer, Gord Pettibone or Rico Vale; more than mild swearing (hell, damn, crap) by anyone; any slur; any swearing aimed at a person.',
    "13. A reply that argues with the other reporter's motives, clicks, jealousy, timing or career instead of a number from the sheet.",
    '',
    'Answer ok = true when you find none of them. Otherwise answer ok = false and list each problem in one short sentence in "problems", naming the words that cause it.',
  ].join('\n')
}
