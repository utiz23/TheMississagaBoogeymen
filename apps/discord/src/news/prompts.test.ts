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
