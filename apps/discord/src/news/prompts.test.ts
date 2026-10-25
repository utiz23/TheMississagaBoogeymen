import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTERS, REPORTER_IDS, type NewsFacts } from '@eanhl/db/news'
import {
  buildArticleUserPrompt,
  buildGameUserPrompt,
  buildReviewPrompt,
  buildSystemPrompt,
  capFactsForPrompt,
  stableStringify,
  whenLine,
} from './prompts.ts'
import { oct12Facts } from './test-fixtures.ts'

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
  const p = buildGameUserPrompt({
    facts: f,
    first: REPORTERS.mercer,
    second: REPORTERS.barlow,
    secondIsReply: true,
    relationship: 'Wade Barlow thinks Dex Mercer is a fraud with good timing.',
  })
  assert.ok(p.includes(stableStringify(capFactsForPrompt(f))))
  assert.ok(p.includes('Dex Mercer'))
  assert.ok(p.includes('Wade Barlow'))
  assert.ok(p.includes('fraud with good timing'))
  assert.ok(p.includes('280'))
  assert.ok(!p.includes('forbiddenNames'))
  assert.ok(!p.includes('Hidden Hank'))
})

void test('game prompt with one reporter says so', () => {
  const p = buildGameUserPrompt({
    facts: oct12Facts(),
    first: REPORTERS.barlow,
    second: null,
    secondIsReply: false,
    relationship: null,
  })
  assert.ok(p.includes('Wade Barlow'))
  assert.ok(/exactly one post/i.test(p))
})

void test('article prompt: reporter, kind, word range, own recent pieces', () => {
  const p = buildArticleUserPrompt({
    facts: oct12Facts('night'),
    reporter: REPORTERS.quill,
    kind: 'night',
    ownRecent: [{ headline: 'Old Headline', summary: 'Old summary.', night: '2026-10-05' }],
  })
  assert.ok(p.includes('Mara Quill'))
  assert.ok(p.includes('250'))
  assert.ok(p.includes('450'))
  assert.ok(p.includes('Old Headline'))
  assert.ok(p.includes('2026-10-05'))
  const w = buildArticleUserPrompt({
    facts: oct12Facts('week'),
    reporter: REPORTERS.quill,
    kind: 'week',
    ownRecent: [],
  })
  assert.ok(/week/i.test(w))
  assert.ok(!w.includes('Old Headline'))
})

void test('review prompt: the text, the sheet, the three checks', () => {
  const p = buildReviewPrompt({ facts: oct12Facts(), text: 'Some text to review.' })
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
    'a tactical point drawn from the numbers on the sheet (shots, time on attack, passing %, power play, hits, period scores, goals for and against) and stated as what those numbers show, never as a described play, movement, lane, zone entry or sequence'
  assert.ok(s.includes(`Every piece includes ${numbersOnly}.`), 'Barlow')
  assert.ok(
    s.includes(`Her tactical points are ${numbersOnly.replace(/^a tactical point /, '')}.`),
    'Halberd',
  )
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
  const game = buildGameUserPrompt({
    facts: oct12Facts(),
    first: REPORTERS.barlow,
    second: null,
    secondIsReply: false,
    relationship: null,
  })
  assert.ok(game.includes('The night: Monday, October 12.'))
  const article = buildArticleUserPrompt({
    facts: oct12Facts('night'),
    reporter: REPORTERS.quill,
    kind: 'night',
    ownRecent: [],
  })
  assert.ok(article.includes('The night: Monday, October 12.'))
})

void test('article prompt: headline at most 120 characters, dek at most 160 (M7)', () => {
  const p = buildArticleUserPrompt({
    facts: oct12Facts('night'),
    reporter: REPORTERS.quill,
    kind: 'night',
    ownRecent: [],
  })
  assert.ok(p.includes('headline: a short headline, at most 120 characters.'))
  assert.ok(p.includes('dek: one line under the headline, at most 160 characters.'))
})

void test('review prompt: clubs only from games[].opponentName; off-ice places; feelings (M5, c2)', () => {
  const p = buildReviewPrompt({ facts: oct12Facts(), text: 'x' })
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
      'When a game has a goal timeline, you may say in which period and at which clock time a goal came, who scored it for us and who assisted, and that an opponent scored. clockMeaning says whether the clock counts up (elapsed) or down (remaining). Do not describe how a goal was scored — the timeline has no play details.',
    ),
  )
})

void test('review prompt: every reporter of the cast may be named (rev 2 fix)', () => {
  const p = buildReviewPrompt({ facts: oct12Facts(), text: 'x' })
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
  const p = buildReviewPrompt({ facts: oct12Facts(), text: 'x' })
  assert.ok(
    p.includes(
      'Facts from a game\'s "goals" timeline are allowed: the period and clock of a goal, who scored it for us, who assisted, and that an opponent scored. How a goal was scored is not on the sheet.',
    ),
  )
})
