import { nightLabel, type NewsFacts, type Reporter } from '@eanhl/db/news'

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
 * badges) and 10 milestones. The fact CHECK still uses the full sheet.
 */
export function capFactsForPrompt(facts: NewsFacts): NewsFacts {
  const isCard = (u: { text: string }) => /card/i.test(u.text)
  const unlocks = [...facts.unlocks.filter(isCard), ...facts.unlocks.filter((u) => !isCard(u))]
  return {
    ...facts,
    unlocks: unlocks.slice(0, MAX_UNLOCKS),
    milestones: facts.milestones.slice(0, MAX_MILESTONES),
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

/** Stable text (cached by the API): the desk's purpose, the rules, then each reporter's voice. */
export function buildSystemPrompt(reporters: Reporter[]): string {
  const rules = [
    "You write for the Boogeymen News Desk. The Boogeymen are a small club of friends who play EA NHL Pro Clubs together. The desk has fictional reporters. You write short posts and articles about the club's games, for the club's Discord and website. The readers are the players themselves, so the tone is playful and sharp, but the facts must be right.",
    'You get a fact sheet as JSON in each request. Follow these rules in every piece, whichever reporter you write as.',
    'FACTS',
    '1. Take every fact from the fact sheet and from nowhere else. A number you write must appear on the sheet exactly as written there. Do not add, subtract, round or convert numbers. Do not write a date or a time unless the sheet has it. Numbers written as words are checked the same way as digits. Never write a date as YYYY-MM-DD; use the weekday, or the month and day, as the request words it (for example "Monday, October 12").',
    '2. Name people exactly as written in "people[].name". Write no other person: no opponent players, no guests, no AI goalies, no real-life names. The two AI goalies are not teammates and get no praise or blame. If the sheet says "aiGoalieInNet", the club played with an AI goalie. Name an opponent club exactly as in "games[].opponentName", and name no other opponent club. "unnamedTeammates" in a game is the number of club teammates who played but asked not to be named. They are teammates, not guests. Never name them, hint at who they are, or single them out; write about the team as a whole instead. "guestCount" is the number of players from outside the club.',
    '3. Goals and assists by people not named on the sheet are in "unnamedGoals" / "unnamedAssists" of each game. Never say a named player\'s goal was the only goal, or that a named player did something alone, unless the sheet shows it.',
    '4. Do not invent quotes from teammates or from opponents. The reporters are fictional, so they may quote each other and answer each other.',
    '5. Opinion is allowed when it follows from the stats ("29 shots against says the defence was under siege"). Invented events are not: no shot off the post, no save, no pass, no line change, no mood in the room, no argument, no play-by-play. No off-ice events or places either (a group chat, a practice, the locker room, the bench, travel), and no claims about what a player wanted, felt or thought. There is no video or play-by-play data, only the numbers on the sheet.',
    '6. A win does not always deserve praise. A loss does not always deserve doom. Let the numbers decide.',
    'TONE',
    '7. Criticism is about hockey only: the game, the stats, the choices on the ice. Never write about real life, looks, family, work, health or the person.',
    '8. Each person on the sheet has a "pressLevel". "full" means a reporter may be harsh about that player\'s games. "easy" means criticism of that player stays mild. Rule 7 applies at both levels.',
    'FORMAT',
    '9. Plain text only. No @ mentions, no links, no hashtags, no emoji, no markdown. Do not write "@everyone" or "@here".',
    '10. Put every person you name in "mentions" and every opponent club you name in "clubs", spelled exactly as in the sheet. Reporter names may be listed in "mentions". Use empty lists when you name nobody.',
    "11. Write as the reporter you are told to write as. Keep the voice of the reporter. Do not repeat a phrase from that reporter's recent pieces.",
  ].join('\n\n')

  const voices = reporters
    .map((r) => `${r.name} (id "${r.id}"), ${r.outlet}\n${r.voice}`)
    .join('\n\n---\n\n')

  return `${rules}\n\nTHE REPORTERS\n\n${voices}`
}

export function buildGameUserPrompt(args: {
  facts: NewsFacts
  first: Reporter
  second: Reporter | null
  secondIsReply: boolean
  relationship: string | null
}): string {
  const { facts, first, second, secondIsReply, relationship } = args
  const lines: string[] = [
    'Fact sheet (JSON):',
    sheet(facts),
    '',
    whenLine(facts),
    '',
    'Task: write short posts about the game or games on the sheet. Each post is at most 280 characters, one to three sentences, with no line breaks.',
  ]
  if (second === null) {
    lines.push(`Write exactly one post, as ${first.name} (id "${first.id}") of ${first.outlet}.`)
  } else {
    lines.push(
      `Write exactly two posts, in this order:`,
      `1. As ${first.name} (id "${first.id}") of ${first.outlet}.`,
    )
    if (secondIsReply) {
      lines.push(
        `2. As ${second.name} (id "${second.id}") of ${second.outlet}. This post is a reply to the first post, and the reader sees it right under it. Answer ${first.name} directly, in ${second.name}'s own voice.`,
      )
      if (relationship !== null) lines.push(`How they feel about each other: ${relationship}`)
    } else {
      lines.push(
        `2. As ${second.name} (id "${second.id}") of ${second.outlet}. This post stands alone. Take a different angle than the first post.`,
      )
    }
  }
  lines.push(
    'Set "reporter" on each post to the id above. Remember: only numbers, names and clubs from the sheet, no invented quotes or events.',
  )
  return lines.join('\n')
}

export function buildArticleUserPrompt(args: {
  facts: NewsFacts
  reporter: Reporter
  kind: 'night' | 'week'
  ownRecent: { headline: string; summary: string; night: string | null }[]
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

export function buildReviewPrompt(args: { facts: NewsFacts; text: string }): string {
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
    'Find these problems:',
    '1. An invented quote from a teammate or an opponent. (A fictional reporter quoting another reporter is fine.)',
    '2. An invented event: a shot off the post, a save, a pass, a line change, a mood or argument in the room, any play-by-play that the sheet does not support. Opinion that follows from the stats is fine.',
    '3. Personal criticism: anything about real life, looks, family, work, health or the person instead of their hockey. Also: harsh criticism of a player whose pressLevel is "easy", and praise or blame for an AI goalie as if it were a teammate.',
    "4. A person named in the text who is not in the sheet's people[].name list and is not one of the seven reporters (Wade Barlow, Talia Voss, Dex Mercer, June Halberd, Rico Vale, Mara Quill, Father Rink). Opponent players, guests and real-life names are problems.",
    '5. A stat stated in words that the program does not read, such as "hat trick", "dozen", "twice", "shutout", "brace", that the sheet does not support.',
    '6. A club that is not in games[].opponentName. Only those clubs (and the Boogeymen) are allowed.',
    '7. A reference to an off-ice event or place that the sheet does not support: a group chat, a practice, the locker room, the bench, travel.',
    '8. A claim about what a player wanted, felt or thought.',
    '',
    'Answer ok = true when you find none of them. Otherwise answer ok = false and list each problem in one short sentence in "problems", naming the words that cause it.',
  ].join('\n')
}
