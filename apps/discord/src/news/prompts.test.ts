import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTERS, REPORTER_IDS, pairAttitude, type NewsFacts } from '@eanhl/db/news'
import { REPLY_JABS } from './fact-check.ts'
import {
  buildArticleUserPrompt,
  buildFeatureUserPrompt,
  spotlightPlayer,
  buildGameUserPrompt,
  buildReviewPrompt,
  buildSystemPrompt,
  capFactsForPrompt,
  criticizedTonightLine,
  setCriticizedTonight,
  EMPTY_DESK_CONTEXT,
  BACKGROUND_FACTS,
  DESK_CONTEXT_END,
  DESK_CONTEXT_START,
  buildGameArticleUserPrompt,
  deskContextBlock,
  setDeskContext,
  storyFacts,
  stableStringify,
  whenLine,
} from './prompts.ts'
import { oct12Facts } from './test-fixtures.ts'
import type { PostAssignment } from './assign.ts'

const recap = (reporter: PostAssignment['reporter']): PostAssignment => ({
  reporter,
  angle: 'recap',
  replyTo: null,
  factId: null,
  takeId: null,
})
const one = (reporter: PostAssignment['reporter']) => [recap(reporter)]
const reply = (reporter: PostAssignment['reporter'], to: number): PostAssignment => ({
  reporter,
  angle: 'reply',
  replyTo: to,
  factId: null,
  takeId: null,
})

const all = REPORTER_IDS.map((id) => REPORTERS[id])

void test('stableStringify sorts keys at every depth, keeps array order', () => {
  assert.equal(
    stableStringify({ b: 1, a: { d: [3, 1], c: null } }),
    '{"a":{"c":null,"d":[3,1]},"b":1}',
  )
})

void test('system prompt: stable, has the rules and every voice', () => {
  const s = buildSystemPrompt(all)
  assert.equal(s, buildSystemPrompt(all))
  for (const r of all) {
    assert.ok(s.includes(r.name))
    assert.ok(s.includes(r.voice))
  }
  for (const needle of [
    'fact sheet',
    'quote',
    'invent',
    'easy',
    'no @',
    'hashtag',
    'emoji',
    'hockey',
    'people',
  ]) {
    assert.ok(s.toLowerCase().includes(needle.toLowerCase()), needle)
  }
})

void test('capFactsForPrompt: 12 unlocks (card first), 10 milestones; originals untouched', () => {
  const f = oct12Facts()
  const unlocks = Array.from({ length: 20 }, (_, i) => ({
    playerId: 1,
    name: 'Skater A',
    text: i === 15 ? 'Elite Card level 3' : `Badge number ${String(i)}`,
  }))
  const milestones = Array.from({ length: 15 }, (_, i) => ({
    playerId: 1,
    name: 'Skater A',
    stat: 'goals' as const,
    value: i,
  }))
  const big: NewsFacts = { ...f, unlocks, milestones }
  const capped = capFactsForPrompt(big)
  assert.equal(capped.unlocks.length, 12)
  assert.equal(capped.unlocks[0]!.text, 'Elite Card level 3')
  assert.equal(capped.milestones.length, 10)
  assert.equal(big.unlocks.length, 20)
  assert.equal(big.milestones.length, 15)
})

void test('capFactsForPrompt: round milestones survive the cap; ties keep sheet order (A5)', () => {
  const f = oct12Facts()
  const m = (stat: 'goals' | 'assists' | 'points' | 'games', value: number, playerId = 1) => ({
    playerId,
    name: playerId === 1 ? 'Skater A' : 'Skater B',
    stat,
    value,
  })
  // Twelve small ones first in sheet order, then the round numbers that must survive the cap.
  const small = Array.from({ length: 12 }, (_, i) => m('goals', 25, i % 2 === 0 ? 1 : 2))
  const big: NewsFacts = {
    ...f,
    milestones: [
      ...small,
      m('games', 100),
      m('assists', 50),
      m('points', 100),
      m('goals', 100, 2),
      m('points', 50, 2),
    ],
  }
  const capped = capFactsForPrompt(big)
  assert.equal(capped.milestones.length, 10)
  assert.deepEqual(
    capped.milestones.slice(0, 5).map((x) => [x.stat, x.value, x.playerId]),
    [
      ['points', 100, 1],
      ['goals', 100, 2],
      ['games', 100, 1],
      ['points', 50, 2],
      ['assists', 50, 1],
    ],
  )
  // (Spec 12.7 tiers give the same head here: 100s, then 50s, points first.)
  // Ties keep the sheet order.
  assert.deepEqual(
    capped.milestones.slice(5).map((x) => x.playerId),
    [1, 2, 1, 2, 1],
  )
  // The sheet itself is untouched.
  assert.equal(big.milestones[0]!.value, 25)
})

void test('game prompt: sheet JSON, both reporters, reply note, no forbidden data', () => {
  const f = oct12Facts()
  const p = buildGameUserPrompt({ facts: f, posts: [recap('mercer'), reply('barlow', 0)] })
  assert.ok(p.includes(stableStringify({ ...capFactsForPrompt(f), topFacts: [] })))
  assert.ok(p.includes('Dex Mercer'))
  assert.ok(p.includes('Wade Barlow'))
  assert.ok(p.includes("Dex Mercer's takes rarely survive the numbers"))
  assert.ok(p.includes('280'))
  assert.ok(!p.includes('forbiddenNames'))
  assert.ok(!p.includes('Hidden Hank'))
})

void test('game prompt with one reporter says so', () => {
  const p = buildGameUserPrompt({ facts: oct12Facts(), posts: one('barlow') })
  assert.ok(p.includes('Wade Barlow'))
  assert.ok(/exactly one post/i.test(p))
})

void test('article prompt: reporter, kind, word range, own recent pieces', () => {
  const p = buildArticleUserPrompt({
    facts: oct12Facts('night'),
    reporter: REPORTERS.quill,
    ctx: {
      ...EMPTY_DESK_CONTEXT,
      ownRecent: {
        quill: [{ kind: 'article', text: 'Old Headline — Old summary.', night: '2026-10-05' }],
      },
    },
  })
  assert.ok(p.includes('Mara Quill'))
  assert.ok(p.includes('250'))
  assert.ok(p.includes('450'))
  assert.ok(p.includes('Old Headline'))
  assert.ok(p.includes('2026-10-05'))
  // A one-game night is shorter (spec §12.12-7).
  const single = oct12Facts('night')
  single.games = [single.games[0]!]
  assert.ok(
    buildArticleUserPrompt({ facts: single, reporter: REPORTERS.quill }).includes('120 to 200'),
  )
})

void test('review prompt: the text, the sheet, the three checks', () => {
  const p = buildReviewPrompt({
    facts: oct12Facts(),
    text: 'Some text to review.',
    criticized: [],
  })
  assert.ok(p.includes('Some text to review.'))
  assert.ok(p.includes(stableStringify(capFactsForPrompt(oct12Facts()))))
  for (const needle of ['quote', 'event', 'personal'])
    assert.ok(p.toLowerCase().includes(needle), needle)
  // R16 follow-up: the reviewer checks unlisted names and stats written in words
  assert.ok(p.includes('who is not in the sheet'))
  assert.ok(p.includes('people[].name'))
  assert.ok(p.includes('Wade Barlow'))
  assert.ok(p.includes('hat trick'))
  assert.ok(p.includes('shutout'))
  assert.ok(!p.includes('were already checked by a program'))
})

void test('system prompt: unnamed teammates are teammates, never named or singled out (F1)', () => {
  const s = buildSystemPrompt(all)
  assert.ok(s.includes('"unnamedTeammates"'))
  assert.ok(s.includes('They are teammates, not guests'))
  assert.ok(s.includes('Never name them, hint at who they are, or single them out'))
  assert.ok(s.includes('"guestCount" is the number of players from outside the club'))
})

void test('system prompt: goals by people not on the sheet are in unnamedGoals / unnamedAssists (T1)', () => {
  const s = buildSystemPrompt(all)
  assert.ok(
    s.includes(
      'Goals and assists by people not named on the sheet are in "unnamedGoals" / "unnamedAssists" of each game. Never say a named player\'s goal was the only goal, or that a named player did something alone, unless the sheet shows it.',
    ),
  )
})

void test('system prompt: a tactical point must name its number; no described plays (T2)', () => {
  const s = buildSystemPrompt(all)
  assert.ok(
    s.includes(
      'A tactical point must name the number it comes from. Do not describe plays, movements, positions on the ice or sequences; the sheet has none.',
    ),
  )
})

void test('voices: tactical points come from the numbers, never from described plays (T2)', () => {
  const s = buildSystemPrompt(all)
  const numbersOnly =
    'drawn from the numbers on the sheet (shots, time on attack, passing %, power play, hits, period scores, goals for and against) and stated as what those numbers show, never as a described play, movement, lane, zone entry or sequence'
  assert.ok(s.includes(`Every article makes one point about tactics ${numbersOnly}.`), 'Barlow')
  assert.ok(s.includes(`Her tactical points are ${numbersOnly}.`), 'Halberd')
  assert.ok(!s.includes('one tactical observation'))
  assert.ok(!s.includes('sequence breakdown'))
  assert.ok(!REPORTERS.halberd.voice.includes('pressure release'))
  assert.ok(!REPORTERS.halberd.voice.includes('rotation'))
  assert.ok(!REPORTERS.halberd.voice.includes('coverage'))
})

void test('system prompt: never a YYYY-MM-DD date; weekday or month and day (c1)', () => {
  const s = buildSystemPrompt(all)
  assert.ok(s.includes('Never write a date as YYYY-MM-DD; use the weekday, or the month and day'))
  assert.ok(s.includes('off-ice events or places'))
  assert.ok(s.includes('what a player wanted, felt or thought'))
})

void test('whenLine: the night in words; a week names its start and its game nights (c1)', () => {
  const g = oct12Facts('game')
  assert.equal(whenLine(g), 'The night: Monday, October 12.')
  assert.equal(whenLine(oct12Facts('night')), 'The night: Monday, October 12.')
  const w: NewsFacts = {
    ...oct12Facts('week'),
    key: '2026-10-12',
    games: [
      { ...g.games[0]!, night: '2026-10-15' },
      { ...g.games[0]!, night: '2026-10-13' },
      { ...g.games[0]!, night: '2026-10-15' },
    ],
  }
  assert.equal(
    whenLine(w),
    'The week starts on Monday, October 12. Game nights: Tuesday, October 13; Thursday, October 15.',
  )
})

void test('game and article prompts carry the night label, never only the ISO key (c1)', () => {
  const game = buildGameUserPrompt({ facts: oct12Facts(), posts: one('barlow') })
  assert.ok(game.includes('The night: Monday, October 12.'))
  const article = buildArticleUserPrompt({ facts: oct12Facts('night'), reporter: REPORTERS.quill })
  assert.ok(article.includes('The night: Monday, October 12.'))
})

void test('article prompt: headline at most 120 characters, dek at most 160 (M7)', () => {
  const p = buildArticleUserPrompt({ facts: oct12Facts('night'), reporter: REPORTERS.quill })
  assert.ok(p.includes('headline: a short headline, at most 120 characters, in sentence case'))
  assert.ok(p.includes('dek: one line under the headline, at most 160 characters'))
})

void test('review prompt: clubs only from games[].opponentName; off-ice places; feelings (M5, c2)', () => {
  const p = buildReviewPrompt({ facts: oct12Facts(), text: 'x', criticized: [] })
  assert.ok(!p.includes('Opponent club names are fine'))
  assert.ok(p.includes('A club that is not in games[].opponentName'))
  for (const needle of ['group chat', 'practice', 'locker room', 'the bench', 'travel']) {
    assert.ok(p.includes(needle), needle)
  }
  assert.ok(p.includes('A claim about what a player wanted, felt or thought.'))
})

void test('system prompt: the goal timeline may be used, with no play details (B1)', () => {
  const s = buildSystemPrompt(all)
  assert.ok(
    s.includes(
      'When a game has a goal timeline, you may say in which period and at which clock time a goal came, who scored it for the Boogeymen and who assisted, and that an opponent scored. clockMeaning says whether the clock counts up (elapsed) or down (remaining). Do not describe how a goal was scored — the timeline has no play details.',
    ),
  )
})

void test('review prompt: every reporter of the cast may be named (rev 2 fix)', () => {
  const p = buildReviewPrompt({ facts: oct12Facts(), text: 'x', criticized: [] })
  for (const id of REPORTER_IDS) assert.ok(p.includes(REPORTERS[id].name), id)
  assert.ok(p.includes('Gord Pettibone'))
  assert.ok(p.includes('Lyle Bergstrom'))
  assert.ok(!/seven reporters/.test(p))
})

void test('capFactsForPrompt: 100s, then 50s, then the rest; points first; then value (spec 12.7)', () => {
  const m = (stat: 'goals' | 'assists' | 'points' | 'games', value: number) => ({
    playerId: 1,
    name: 'Skater A',
    stat,
    value,
  })
  const ten: NewsFacts = {
    ...oct12Facts(),
    milestones: [
      m('games', 125),
      m('goals', 75),
      m('goals', 50),
      m('games', 200),
      m('points', 100),
      m('points', 75),
      m('assists', 150),
      m('points', 150),
      m('goals', 100),
      m('assists', 25),
    ],
  }
  const label = (x: { stat: string; value: number }) => `${x.stat} ${String(x.value)}`
  const order = capFactsForPrompt(ten).milestones.map(label)
  assert.deepEqual(order, [
    'points 100',
    'goals 100',
    'games 200',
    'points 150',
    'goals 50',
    'assists 150',
    'points 75',
    'goals 75',
    'assists 25',
    'games 125',
  ])
  assert.ok(order.indexOf('games 125') > order.indexOf('points 100'))
  assert.ok(order.indexOf('games 125') > order.indexOf('goals 50'))
  // Over the cap, the plain ones go first: games 125 is dropped, every 100 and 50 stays.
  const twelve: NewsFacts = {
    ...ten,
    milestones: [...ten.milestones, m('points', 25), m('goals', 25)],
  }
  const capped = capFactsForPrompt(twelve).milestones.map(label)
  assert.equal(capped.length, 10)
  assert.ok(!capped.includes('games 125'))
  for (const keep of [
    'points 100',
    'goals 100',
    'games 200',
    'points 150',
    'goals 50',
    'assists 150',
  ]) {
    assert.ok(capped.includes(keep), keep)
  }
})

void test('review prompt: goal timeline facts are allowed (B1)', () => {
  const p = buildReviewPrompt({ facts: oct12Facts(), text: 'x', criticized: [] })
  assert.ok(
    p.includes(
      'Facts from a game\'s "goals" timeline are allowed: the period and clock of a goal, who scored it for the Boogeymen, who assisted, and that an opponent scored. How a goal was scored is not on the sheet.',
    ),
  )
})

void test('game prompt: the first post is the recap — result, score, scorers, one key number (rev 2, B1)', () => {
  const p = buildGameUserPrompt({ facts: oct12Facts(), posts: one('barlow') })
  assert.ok(/exactly one post/i.test(p))
  assert.ok(p.includes('the recap of the game'))
  assert.ok(p.includes('the result and the score'))
  assert.ok(p.includes('who scored for the Boogeymen'))
  assert.ok(p.includes('"a guest"'))
  assert.ok(p.includes('"an opponent"'))
  assert.ok(p.includes('exactly one key number'))
  assert.ok(p.includes('goal timeline'))
})

void test('game prompt: the second post reacts or replies and does not repeat the recap (rev 2, B1)', () => {
  const standalone = buildGameUserPrompt({
    facts: oct12Facts(),
    posts: [recap('vale'), { ...recap('barlow'), angle: 'number' }],
  })
  assert.ok(standalone.includes('1. The recap, as Rico Vale'))
  assert.ok(
    standalone.includes('2. As Wade Barlow (id "barlow") of Boogeymen Beat, angle "number"'),
  )
  assert.ok(standalone.includes('do not repeat the score line or the list of scorers'))
  const replied = buildGameUserPrompt({
    facts: oct12Facts(),
    posts: [recap('mercer'), reply('barlow', 0)],
  })
  assert.ok(replied.includes('angle "reply": a reply to the post named below'))
  assert.ok(replied.includes('It answers post 1 by Dex Mercer directly'))
  assert.ok(replied.includes("Wade Barlow thinks Dex Mercer's takes rarely survive the numbers."))
})

void test('prompts carry the pile-on line; the review checks unlisted harsh criticism (rev 2, B4)', () => {
  assert.equal(
    criticizedTonightLine([]),
    'Already criticised harshly tonight: nobody. Do not criticise these people harshly again tonight; take another angle on them.',
  )
  assert.equal(
    criticizedTonightLine(['Skater A', 'Goalie G']),
    'Already criticised harshly tonight: Skater A, Goalie G. Do not criticise these people harshly again tonight; take another angle on them.',
  )
  const game = buildGameUserPrompt({
    facts: oct12Facts(),
    posts: one('barlow'),
    ctx: { ...EMPTY_DESK_CONTEXT, criticizedTonight: ['Skater A'] },
  })
  assert.ok(game.includes(criticizedTonightLine(['Skater A'])))
  const article = buildArticleUserPrompt({ facts: oct12Facts('night'), reporter: REPORTERS.quill })
  assert.ok(article.includes(criticizedTonightLine([])))
  assert.ok(article.includes('- criticized, zeroCalled, stances, takesUsed: '))
  // The backfill swaps the line once the earlier items of the night are known.
  assert.equal(
    setCriticizedTonight(game, ['Goalie G']).split(criticizedTonightLine(['Goalie G'])).length,
    2,
  )
  assert.ok(!setCriticizedTonight(game, ['Goalie G']).includes(criticizedTonightLine(['Skater A'])))
  assert.equal(setCriticizedTonight('no line here', ['Goalie G']), 'no line here')

  const sys = buildSystemPrompt(all)
  assert.ok(sys.includes('"criticized"'))
  assert.ok(sys.includes('at most one harsh piece about the same player per night'))

  const r = buildReviewPrompt({ facts: oct12Facts(), text: 'x', criticized: ['Skater A'] })
  assert.ok(r.includes('The writer listed these people as criticised harshly: Skater A.'))
  assert.ok(r.includes('Harsh criticism of a player who is not on that list'))
  const none = buildReviewPrompt({ facts: oct12Facts(), text: 'x', criticized: [] })
  assert.ok(none.includes('The writer listed these people as criticised harshly: nobody.'))
})

// ── Weekly features (rev 2, B3) ─────────────────────────────────────────────

function weekPlayer(name: string, playerId: number, points: number) {
  return {
    playerId,
    name,
    games: 2,
    goals: points,
    assists: 0,
    points,
    shots: 5,
    hits: 1,
    titleGoals: 10,
    titleAssists: 10,
    titlePoints: 20,
    titleGames: 30,
  }
}

void test('spotlight: the named player with a milestone this week, else the most points', () => {
  const w = oct12Facts('week')
  assert.equal(spotlightPlayer(w), 'Skater B') // goals 25 milestone
  const noMilestone: NewsFacts = {
    ...w,
    milestones: [],
    weekPlayers: [weekPlayer('Skater A', 1, 3), weekPlayer('Goalie G', 3, 5)],
  }
  assert.equal(spotlightPlayer(noMilestone), 'Goalie G')
  assert.equal(spotlightPlayer({ ...w, milestones: [], weekPlayers: [] }), null)
  // The biggest milestone first, as the prompt cap orders them.
  const two: NewsFacts = {
    ...w,
    milestones: [
      { playerId: 2, name: 'Skater B', stat: 'goals', value: 25 },
      { playerId: 1, name: 'Skater A', stat: 'points', value: 100 },
    ],
  }
  assert.equal(spotlightPlayer(two), 'Skater A')
})

void test('feature prompt: kind instructions, 600-900 words, prediction and receipt (rev 2, B3)', () => {
  const facts = oct12Facts('week')
  const base = { facts, previousPrediction: null }
  const trend = buildFeatureUserPrompt({ ...base, reporter: REPORTERS.quill, kind: 'trend' })
  assert.ok(trend.includes(stableStringify({ ...capFactsForPrompt(facts), topFacts: [] })))
  assert.ok(trend.includes('The week starts on Monday, October 12.'))
  assert.ok(trend.includes('as Mara Quill (id "quill")'))
  assert.ok(trend.includes('"history"'))
  assert.ok(trend.includes('600 to 900 words'))
  assert.ok(trend.includes('- prediction: '))
  assert.ok(trend.includes('no digits and no number words'))
  assert.ok(trend.includes("Last week's prediction: none."))
  assert.ok(trend.includes('- receipt: an empty string'))
  assert.ok(trend.includes('- receiptVerdict: "none".'))

  const spot = buildFeatureUserPrompt({ ...base, reporter: REPORTERS.voss, kind: 'spotlight' })
  assert.ok(spot.includes('Spotlight player: Skater B.'))
  assert.ok(spot.includes('"weekPlayers"'))
  const notes = buildFeatureUserPrompt({ ...base, reporter: REPORTERS.pettibone, kind: 'notes' })
  assert.ok(notes.includes('10 to 15 short separate items'))
  assert.ok(notes.includes('each item is one paragraph'))
  const big = buildFeatureUserPrompt({ ...base, reporter: REPORTERS.bergstrom, kind: 'bigpicture' })
  assert.ok(big.includes('the big picture, then the evidence'))
  assert.ok(big.includes('a firm verdict'))
  const rink = buildFeatureUserPrompt({ ...base, reporter: REPORTERS.rink, kind: 'rink' })
  assert.ok(rink.includes('Father Rink'))

  const withPrev = buildFeatureUserPrompt({
    ...base,
    reporter: REPORTERS.quill,
    kind: 'trend',
    previousPrediction: 'Someone finally beats the goalie.',
  })
  assert.ok(withPrev.includes(`Last week's prediction: "Someone finally beats the goalie."`))
  assert.ok(
    withPrev.includes("- receipt: one or two sentences that restate last week's prediction"),
  )
  assert.ok(withPrev.includes('only from this sheet'))
  assert.ok(
    withPrev.includes(
      '- receiptVerdict: "hit" when the prediction came true, "miss" when it did not.',
    ),
  )
})

void test('system prompt (C3a.2): every writing rule of spec §12.8-§12.19', () => {
  const s = buildSystemPrompt(all)
  for (const needle of [
    // AI goalies: named, praise/blame allowed, not teammates.
    'Matteo Lehmann and Jonas Wagner',
    'Praise and blame of their numbers are allowed',
    'They are not teammates and not club members',
    // Labels.
    'Labels are binding.',
    'No drama that no label supports.',
    'The result label ("games[].context.result") sets the mood',
    'Typical patterns are not news.',
    // Ended early, plus-minus, positions, TOA in seconds.
    'give it one neutral line with the result and the score only',
    'Never cite plus-minus or game score',
    '"games[].players[].position": F forward, D defence, G goalie',
    'is in SECONDS',
    'never as a clock time',
    // Fairness.
    'Never for a D or a G. At most one per night',
    '"zeroCalled"',
    'Penalty minutes only when a player has 10 or more, and at most once a night.',
    "A reply argues with a number from the sheet. No remarks about the other reporter's motives, clicks",
    '"takesUsed"',
    'never two "weaker player" takes in one piece',
    '"stances"',
    // Craft and style.
    'At most 3 numbers in a sentence. No list of more than 3 values. At most 2 clock times in an article.',
    'An article never opens with the date and the record.',
    'sentence case',
    'The dek never repeats the headline.',
    'Each milestone gets its own sentence',
    'never write "we", "us", "our" or "ours"',
    'Scores winner first',
    '"83.1%"',
    '"40-11-5"',
    '"Friday, May 8"',
    'lore',
    'invent nothing around it',
    'mild swearing (hell, damn, crap) only for Dex Mercer, Gord Pettibone and Rico Vale',
    'Never a slur',
    'Winning fixes almost everything.',
    'never called luck',
    'keep their caveats',
    'at most about one article in three ends with one',
  ]) {
    assert.ok(s.includes(needle), needle)
  }
  // The old "no praise or blame" AI goalie rule is gone, and no rule says "us".
  assert.ok(!s.includes('get no praise or blame'))
  assert.ok(!/for us\b|against us\b/.test(s))
})

// ── C3a.3: prompt context ───────────────────────────────────────────────────

function ranked(n: number): NewsFacts {
  const f = oct12Facts('game')
  f.topFacts = Array.from({ length: n }, (_, i) => ({
    id: `f${String(i)}`,
    text: `Ranked fact ${String(i)}`,
    weight: 100 - i,
    subject: i === 0 ? 'Skater A' : null,
  }))
  return f
}

void test('C3a.3 story: the top 5 facts are the story, the rest background; the sheet JSON has no topFacts', () => {
  const f = ranked(8)
  const p = buildArticleUserPrompt({ facts: { ...f, kind: 'night' }, reporter: REPORTERS.quill })
  const story = p.slice(p.indexOf('The story'), p.indexOf('Background facts'))
  for (let i = 0; i < 5; i++) assert.ok(story.includes(`Ranked fact ${String(i)}`), String(i))
  assert.ok(!story.includes('Ranked fact 5'))
  assert.ok(p.slice(p.indexOf('Background facts')).includes('Ranked fact 7'))
  assert.ok(!p.includes('"topFacts":[{'))
  assert.deepEqual(
    storyFacts(f, 5, new Set(['f0', 'f2'])).map((x) => x.id),
    ['f1', 'f3', 'f4', 'f5', 'f6'],
  )
})

void test("C3a.3 game posts: each extra post names its own fact; the story starts with the posts' facts", () => {
  const f = ranked(10)
  const p = buildGameUserPrompt({
    facts: f,
    posts: [
      { ...recap('barlow'), factId: 'f0' },
      { reporter: 'quill', angle: 'number', replyTo: null, factId: 'f1', takeId: null },
      { reporter: 'vale', angle: 'joke', replyTo: null, factId: 'f2', takeId: null },
    ],
  })
  assert.ok(
    p.includes(
      'angle "number": one number on the sheet and what it says. Its fact: "Ranked fact 1".',
    ),
  )
  assert.ok(p.includes('angle "joke"'))
  assert.ok(p.includes('Its fact: "Ranked fact 2".'))
  assert.ok(p.includes('Write exactly 3 posts, in this order:'))
})

void test('C3a.3 threads and stances; takes only for the request reporters, mild for Go easy', () => {
  const f = oct12Facts('game')
  f.threads = [
    {
      key: 'pp-drought@2026-10-08',
      kind: 'pp-drought',
      subject: null,
      since: '2026-10-08',
      status: 'open',
      summary: 'No PP goal in 3 games.',
    },
  ]
  f.stances = [
    {
      threadKey: 'pp-drought@2026-10-08',
      reporter: 'quill',
      stance: 'It ends soon.',
      night: '2026-10-08',
    },
  ]
  const take = {
    id: 9,
    reporter: 'mercer' as const,
    critics: ['pettibone' as const],
    defender: 'quill' as const,
    playerId: 2,
    player: 'Skater B',
    take: 'Invented: he hides in the big games.',
    spread: 'a few' as const,
    dataAngle: 'points in one-goal games',
    intensity: 1,
    mild: true,
  }
  const p = buildGameUserPrompt({
    facts: f,
    posts: one('pettibone'),
    ctx: { ...EMPTY_DESK_CONTEXT, takes: [take] },
  })
  assert.ok(p.includes('- pp-drought@2026-10-08: No PP goal in 3 games. (open)'))
  assert.ok(p.includes('- Mara Quill on pp-drought@2026-10-08: "It ends soon."'))
  assert.ok(p.includes('- Take 9 on Skater B: Invented: he hides in the big games.'))
  assert.ok(p.includes('critics: Dex Mercer, Gord Pettibone (a few of the desk share it)'))
  assert.ok(p.includes('defender: Mara Quill'))
  assert.ok(p.includes('data angle: points in one-goal games'))
  assert.ok(p.includes('Skater B is at press level "easy": keep it mild'))
  // Not for a reporter who neither holds nor answers it.
  const other = buildGameUserPrompt({
    facts: f,
    posts: one('barlow'),
    ctx: { ...EMPTY_DESK_CONTEXT, takes: [take] },
  })
  assert.ok(!other.includes('Take 9'))
})

void test('C3a.3 desk context: own last 5 pieces, zero call-outs, the night posts; swapped as one block', () => {
  const own = Array.from({ length: 7 }, (_, i) => ({
    kind: 'post' as const,
    text: `Old post ${String(i)}`,
    night: '2026-10-05',
  }))
  const ctx = {
    criticizedTonight: ['Skater A'],
    zeroCalledTonight: [],
    zeroCalledPrevious: ['Skater B'],
    ownRecent: { quill: own },
    nightPosts: [{ reporter: 'barlow', text: 'Barlow said 14 shots.' }],
  }
  const block = deskContextBlock(ctx, ['quill'])
  assert.ok(block.startsWith(DESK_CONTEXT_START))
  assert.ok(block.endsWith(DESK_CONTEXT_END))
  assert.ok(
    block.includes("Mara Quill's own last pieces, newest first. Do not repeat their phrasing"),
  )
  assert.ok(block.includes('Old post 4'))
  assert.ok(!block.includes('Old post 5'), 'at most 5')
  assert.ok(block.includes('Zero call-outs tonight: nobody.'))
  assert.ok(block.includes('Zero call-outs last night: Skater B.'))
  assert.ok(
    block.includes(
      "Tonight's posts, oldest first. Reuse their numbers only to draw a new conclusion:",
    ),
  )
  assert.ok(block.includes('- Wade Barlow: Barlow said 14 shots.'))
  const night = buildArticleUserPrompt({ facts: oct12Facts('night'), reporter: REPORTERS.quill })
  assert.ok(night.includes("Tonight's posts: none."))
  const swapped = setDeskContext(night, ctx, ['quill'])
  assert.ok(swapped.includes('Barlow said 14 shots.'))
  assert.equal(swapped.split(DESK_CONTEXT_START).length, 2)
  assert.equal(setDeskContext('no block', ctx, ['quill']), 'no block')
})

void test('C3a.7 game article prompts: story 200-350 words, spotlight/column 400-700, the spotlight player', () => {
  const f = ranked(6)
  const story = buildGameArticleUserPrompt({ facts: f, reporter: REPORTERS.barlow, kind: 'game' })
  assert.ok(story.includes('the game story'))
  assert.ok(story.includes('200 to 350 words'))
  const spot = buildGameArticleUserPrompt({ facts: f, reporter: REPORTERS.voss, kind: 'spotlight' })
  assert.ok(spot.includes('400 to 700 words'))
  assert.ok(spot.includes('Spotlight player: Skater A.'))
  const col = buildGameArticleUserPrompt({
    facts: f,
    reporter: REPORTERS.bergstrom,
    kind: 'column',
  })
  assert.ok(col.includes('a column'))
  assert.ok(col.includes(DESK_CONTEXT_START))
})

void test('C3a.9 feature prompt: scorecards and the receipt that restates the prediction', () => {
  const facts = oct12Facts('week')
  facts.scorecards = [{ reporter: 'quill', hits: 4, misses: 3, judged: 7 }]
  const p = buildFeatureUserPrompt({
    facts,
    reporter: REPORTERS.quill,
    kind: 'trend',
    previousPrediction: 'X.',
  })
  assert.ok(p.includes('Prediction scorecards: Mara Quill 4 for 7.'))
  assert.ok(p.includes("restate last week's prediction"))
})

void test('C3a.10 review prompt: labels, takes fairness, language level, AI goalies, replies', () => {
  const none = buildReviewPrompt({ facts: oct12Facts(), text: 'x', criticized: [] })
  for (const needle of [
    'Drama that no label on the sheet supports',
    'a big individual night called luck after a win',
    'A reporter take used unfairly',
    'A grudge against a player without an offered take',
    'any swearing by a reporter other than Dex Mercer, Gord Pettibone or Rico Vale',
    'any slur; any swearing aimed at a person',
    'The AI goalies (Matteo Lehmann, Jonas Wagner) may be praised or blamed',
    'calling one a teammate or a club member is a problem',
    "A reply that argues with the other reporter's motives, clicks",
    'Harsh criticism of a player who is not on that list',
    'The writer was offered no reporter take',
  ]) {
    assert.ok(none.includes(needle), needle)
  }
  assert.ok(!none.includes('as if it were a teammate'))
  const take = {
    id: 3,
    reporter: 'mercer' as const,
    critics: ['pettibone' as const],
    defender: 'quill' as const,
    playerId: 2,
    player: 'Skater B',
    take: 'Invented take.',
    spread: 'some' as const,
    dataAngle: null,
    intensity: 0,
    mild: true,
  }
  const withTake = buildReviewPrompt({
    facts: oct12Facts(),
    text: 'x',
    criticized: [],
    takes: [take],
  })
  assert.ok(
    withTake.includes(
      '- take 3: Invented take. (on Skater B; critics Dex Mercer, Gord Pettibone; defender Mara Quill; MILD (Go easy))',
    ),
  )
  // C3a fix I1: the reviewer cites a take by its id only.
  assert.ok(
    withTake.includes('refer to a take only as "take N" (its id); never repeat or quote its words'),
  )
})

void test('C3a fix I4: a defender post pushes back on the take and does not voice it', () => {
  const p = buildGameUserPrompt({
    facts: oct12Facts(),
    posts: [
      recap('barlow'),
      { reporter: 'mercer', angle: 'take', replyTo: null, factId: null, takeId: 7 },
      { reporter: 'quill', angle: 'reply', replyTo: 1, factId: null, takeId: null, pushesBack: 7 },
    ],
  })
  assert.ok(p.includes('It may voice take 7 (below).'))
  assert.ok(
    p.includes(
      "It pushes back on take 7 (below) with the take's data angle and a number from the sheet; it does not voice the take",
    ),
  )
})

void test("C3a fix M1: an ended-early game's recap asks for the score only, no key number", () => {
  const f = oct12Facts('game')
  f.games = [{ ...f.games[0]!, endedEarly: true, team: null }]
  const p = buildGameUserPrompt({ facts: f, posts: one('barlow') })
  assert.ok(!p.includes('exactly one key number'))
  assert.ok(p.includes('one neutral line with the result and the score, and no other number'))
  assert.ok(
    buildGameUserPrompt({ facts: oct12Facts(), posts: one('barlow') }).includes(
      'exactly one key number',
    ),
  )
})

void test('C3a fix M2: reply prompts never carry a blocked jab word', () => {
  for (const from of REPORTER_IDS) {
    for (const to of REPORTER_IDS) {
      if (from === to) continue
      assert.ok(!REPLY_JABS.test(pairAttitude(from, to)), `${from} -> ${to}`)
      const p = buildGameUserPrompt({ facts: oct12Facts(), posts: [recap(to), reply(from, 0)] })
      const line = p.split('\n').find((l) => l.startsWith('2. '))!
      assert.ok(!REPLY_JABS.test(line), `${from} -> ${to}: ${line}`)
    }
  }
})

void test('C3a fix M7: at most 15 background facts after the story', () => {
  const p = buildArticleUserPrompt({
    facts: { ...ranked(30), kind: 'night' },
    reporter: REPORTERS.quill,
  })
  const bg = p
    .slice(p.indexOf('Background facts'))
    .split('\n')
    .filter((l) => l.startsWith('- Ranked fact'))
  assert.equal(bg.length, BACKGROUND_FACTS)
  assert.equal(BACKGROUND_FACTS, 15)
  assert.ok(p.includes('Ranked fact 19'))
  assert.ok(!p.includes('Ranked fact 20'))
})
