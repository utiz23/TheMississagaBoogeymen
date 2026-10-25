import {
  REPORTERS,
  REPORTER_IDS,
  compareMilestones,
  nightLabel,
  type FeatureKind,
  type NewsFacts,
  type Reporter,
} from '@eanhl/db/news'

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

function sheet(facts: NewsFacts): string {
  return stableStringify(capFactsForPrompt(facts))
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
  '13. Labels are binding. Call something a career high, a season high, a slump, an upset, panic, a blowout, a meltdown, a steal, a first of the season or a record only when a label or fact on the sheet says so ("bests", "firsts", "streaks", "threads", "context", "aiGoalie.label", "newRecords"). No drama that no label supports.',
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

/** What a recap post must say (rev 2, B1; spec §12.1). */
const RECAP_RULES =
  'The recap of the game says the result and the score, who scored for the Boogeymen, and exactly one key number besides the score. Name a scorer only as in people[].name. A goal for the Boogeymen by someone not named on the sheet: call the scorer "a guest" only when the game\'s unnamedTeammates is 0; otherwise credit the team, never a person. A goal against the Boogeymen was scored by "an opponent"; never name an opponent player. You may use the goal timeline (the period and the clock of a goal).'

export function buildGameUserPrompt(args: {
  facts: NewsFacts
  first: Reporter
  second: Reporter | null
  secondIsReply: boolean
  relationship: string | null
  /** Names the night's earlier items criticised harshly. */
  criticizedTonight: readonly string[]
}): string {
  const { facts, first, second, secondIsReply, relationship } = args
  const lines: string[] = [
    'Fact sheet (JSON):',
    sheet(facts),
    '',
    whenLine(facts),
    '',
    'Task: write short posts about the game on the sheet. Each post is at most 280 characters, one to three sentences, with no line breaks.',
  ]
  if (second === null) {
    lines.push(
      `Write exactly one post: the recap of the game, as ${first.name} (id "${first.id}") of ${first.outlet}.`,
    )
  } else {
    lines.push(
      `Write exactly two posts, in this order:`,
      `1. The recap, as ${first.name} (id "${first.id}") of ${first.outlet}.`,
    )
    if (secondIsReply) {
      lines.push(
        `2. A reply, as ${second.name} (id "${second.id}") of ${second.outlet}. This post answers the recap, and the reader sees it right under it. Answer ${first.name} directly, in ${second.name}'s own voice.`,
      )
      if (relationship !== null) lines.push(`How they feel about each other: ${relationship}`)
    } else {
      lines.push(
        `2. A reaction, as ${second.name} (id "${second.id}") of ${second.outlet}. This post stands alone and reacts to the game from a different angle.`,
      )
    }
    lines.push(
      'Do not repeat the score line or the list of scorers in post 2; give an opinion that follows from one number on the sheet.',
    )
  }
  lines.push(
    RECAP_RULES,
    criticizedTonightLine(args.criticizedTonight),
    'Set "reporter" on each post to the id above. List in "criticized" the people the post criticises harshly (an empty list when none). Remember: only numbers, names and clubs from the sheet, no invented quotes or events.',
  )
  return lines.join('\n')
}

export function buildArticleUserPrompt(args: {
  facts: NewsFacts
  reporter: Reporter
  kind: 'night' | 'week'
  ownRecent: { headline: string; summary: string; night: string | null }[]
  /** Names the night's earlier items criticised harshly. */
  criticizedTonight: readonly string[]
}): string {
  const { facts, reporter, kind, ownRecent } = args
  const what =
    kind === 'night'
      ? 'one article about the whole night of games on the sheet'
      : 'one weekly piece about the whole week of games on the sheet (the sheet lists the games of the week)'
  const lines: string[] = [
    'Fact sheet (JSON):',
    sheet(facts),
    '',
    whenLine(facts),
    '',
    `Task: write ${what}, as ${reporter.name} (id "${reporter.id}") of ${reporter.outlet}. Use ${reporter.name}'s article format from the reporter notes.`,
    '',
    'Output fields:',
    '- headline: a short headline, at most 120 characters.',
    '- dek: one line under the headline, at most 160 characters.',
    '- paragraphs: the article body, 250 to 450 words in total, as separate paragraphs. No headings, no lists.',
    "- summary: one or two plain sentences saying what the article covers, for the reporter's own memory. Facts from the sheet only.",
    '- mentions and clubs: as in the rules.',
    '- criticized: the people the article criticises harshly, spelled as in people[].name; an empty list when none.',
    '',
    criticizedTonightLine(args.criticizedTonight),
  ]
  if (ownRecent.length > 0) {
    lines.push(
      '',
      `${reporter.name}'s own recent pieces, newest first. Refer back to them if it helps. Do not repeat their images or lines:`,
    )
    for (const r of ownRecent) {
      lines.push(`- ${r.night === null ? 'undated' : r.night}: "${r.headline}" - ${r.summary}`)
    }
  }
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

/** The weekly feature request (rev 2, B3; spec §12.3, §12.6). */
export function buildFeatureUserPrompt(args: {
  facts: NewsFacts
  reporter: Reporter
  kind: FeatureKind
  ownRecent: { headline: string; summary: string; night: string | null }[]
  /** Last week's prediction, or null when there is none. */
  previousPrediction: string | null
}): string {
  const { facts, reporter, kind, ownRecent, previousPrediction } = args
  const lines: string[] = [
    'Fact sheet (JSON):',
    sheet(facts),
    '',
    whenLine(facts),
    '',
    `Task: write this week's in-depth feature about the whole week of games on the sheet, as ${reporter.name} (id "${reporter.id}") of ${reporter.outlet}.`,
    ...featureTask(kind, facts),
    '',
    previousPrediction === null
      ? "Last week's prediction: none."
      : `Last week's prediction: "${previousPrediction}"`,
    '',
    'Output fields:',
    '- headline: a short headline, at most 120 characters.',
    '- dek: one line under the headline, at most 160 characters.',
    '- paragraphs: the feature body, 600 to 900 words in total, as separate paragraphs. No headings, no lists.',
    "- summary: one or two plain sentences saying what the feature covers, for the reporter's own memory. Facts from the sheet only.",
    '- mentions and clubs: as in the rules.',
    '- criticized: the people the feature criticises harshly, spelled as in people[].name; an empty list when none.',
    '- prediction: one short prediction about next week, in the reporter\'s voice, with no digits and no number words. It is printed as the last paragraph; do not repeat it in "paragraphs".',
    previousPrediction === null
      ? '- receipt: an empty string (there was no prediction last week).'
      : '- receipt: one or two sentences saying whether last week\'s prediction came true, judged only from this sheet. It is printed as the first paragraph; do not repeat it in "paragraphs".',
  ]
  if (ownRecent.length > 0) {
    lines.push(
      '',
      `${reporter.name}'s own recent pieces, newest first. Refer back to them if it helps. Do not repeat their images or lines:`,
    )
    for (const r of ownRecent) {
      lines.push(`- ${r.night === null ? 'undated' : r.night}: "${r.headline}" - ${r.summary}`)
    }
  }
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
}): string {
  const listed = args.criticized.length === 0 ? 'nobody' : args.criticized.join(', ')
  return [
    'You are the second check of a news desk. A fictional reporter wrote the text below from the fact sheet. A program already checked the digits and number words in the text, the names the reporter listed, and the club names the reporter listed. It did not read the text for other names or for stats written in other ways. Check what the program cannot check.',
    '',
    'Fact sheet (JSON):',
    sheet(args.facts),
    '',
    'Text to review:',
    '"""',
    args.text,
    '"""',
    '',
    `The writer listed these people as criticised harshly: ${listed}.`,
    '',
    'Find these problems:',
    '1. An invented quote from a teammate or an opponent. (A fictional reporter quoting another reporter is fine.)',
    '2. An invented event: a shot off the post, a save, a pass, a line change, a mood or argument in the room, any play-by-play that the sheet does not support. Opinion that follows from the stats is fine. Facts from a game\'s "goals" timeline are allowed: the period and clock of a goal, who scored it for us, who assisted, and that an opponent scored. How a goal was scored is not on the sheet.',
    '3. Personal criticism: anything about real life, looks, family, work, health or the person instead of their hockey. Also: harsh criticism of a player whose pressLevel is "easy", and praise or blame for an AI goalie as if it were a teammate.',
    `4. A person named in the text who is not in the sheet's people[].name list and is not one of the desk's reporters (${REPORTER_IDS.map((id) => REPORTERS[id].name).join(', ')}). Opponent players, guests and real-life names are problems.`,
    '5. A stat stated in words that the program does not read, such as "hat trick", "dozen", "twice", "shutout", "brace", that the sheet does not support.',
    '6. A club that is not in games[].opponentName. Only those clubs (and the Boogeymen) are allowed.',
    '7. A reference to an off-ice event or place that the sheet does not support: a group chat, a practice, the locker room, the bench, travel.',
    '8. A claim about what a player wanted, felt or thought.',
    '9. Harsh criticism of a player who is not on that list. Mild criticism is fine.',
    '',
    'Answer ok = true when you find none of them. Otherwise answer ok = false and list each problem in one short sentence in "problems", naming the words that cause it.',
  ].join('\n')
}
