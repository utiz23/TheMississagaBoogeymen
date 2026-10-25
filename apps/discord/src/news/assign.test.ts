import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assignFeature,
  assignGamePosts,
  assignNightRecap,
  isAllowed,
  nextFeatureKind,
  REACTION_SITUATIONS,
  type Activity,
  type ActivityKind,
} from './assign.ts'
import { oct12Facts } from './test-fixtures.ts'
import { FEATURE_REPORTER, type FeatureKind, type NewsFacts, type ReporterId } from '@eanhl/db/news'
import type { GameSituation } from './situation.ts'

const NOW = new Date('2026-10-13T04:00:00.000Z')
const NIGHT = '2026-10-12'
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)
const act = (
  reporter: ReporterId,
  kind: ActivityKind,
  createdAt: Date,
  night: string | null = null,
): Activity[number] => ({ reporter, kind, night, createdAt })

// ── Frequency limits ────────────────────────────────────────────────────────

void test('Rink: 10 days ago is not allowed, 15 days ago is', () => {
  assert.equal(isAllowed('rink', NOW, NIGHT, [act('rink', 'night', daysAgo(10))]), false)
  assert.equal(isAllowed('rink', NOW, NIGHT, [act('rink', 'night', daysAgo(15))]), true)
  assert.equal(isAllowed('rink', NOW, NIGHT, []), true)
})

void test('Mercer: one per night, three per 7 days', () => {
  const other = '2026-10-10'
  assert.equal(
    isAllowed('mercer', NOW, NIGHT, [act('mercer', 'recap', daysAgo(0.1), NIGHT)]),
    false,
  )
  const three: Activity = [1, 2, 3].map((d) => act('mercer', 'recap', daysAgo(d), `x${String(d)}`))
  assert.equal(isAllowed('mercer', NOW, other, three), false)
  assert.equal(isAllowed('mercer', NOW, other, three.slice(1)), true)
  const old: Activity = [8, 9, 10].map((d) => act('mercer', 'recap', daysAgo(d), `y${String(d)}`))
  assert.equal(isAllowed('mercer', NOW, other, old), true)
  assert.equal(isAllowed('barlow', NOW, NIGHT, three), true)
})

// ── Game posts: recap + optional reaction ───────────────────────────────────

void test('a second post only for ot_win, ot_loss, blowout_loss and goalie_steal (rev 2, B1)', () => {
  assert.deepEqual([...REACTION_SITUATIONS].sort(), [
    'blowout_loss',
    'goalie_steal',
    'ot_loss',
    'ot_win',
  ])
  for (const s of ['loss', 'routine_win', 'quiet_win'] as const) {
    assert.equal(assignGamePosts(s, NOW, NIGHT, []).second, null, s)
  }
  for (const s of REACTION_SITUATIONS) {
    const r = assignGamePosts(s, NOW, NIGHT, [])
    assert.notEqual(r.second, null, s)
    assert.notEqual(r.second, r.first, s)
  }
})

void test('clean record: the first fitting reporter writes the recap, the next one reacts', () => {
  assert.deepEqual(assignGamePosts('blowout_loss', NOW, NIGHT, []), {
    first: 'mercer',
    second: 'quill',
    secondIsReply: false,
  })
  const ot = assignGamePosts('ot_loss', NOW, NIGHT, [])
  assert.deepEqual(ot, { first: 'mercer', second: 'barlow', secondIsReply: true }) // Barlow answers Mercer
  assert.equal(assignGamePosts('routine_win', NOW, NIGHT, []).first, 'barlow')
  assert.equal(assignGamePosts('quiet_win', NOW, NIGHT, []).first, 'quill')
  assert.equal(assignGamePosts('loss', NOW, NIGHT, []).first, 'barlow')
})

void test('recap queue: the fitting reporter whose LAST recap is oldest writes (never = oldest)', () => {
  // loss fits barlow, mercer, quill, pettibone.
  const activity: Activity = [
    act('barlow', 'recap', daysAgo(1), '2026-10-11'),
    act('mercer', 'recap', daysAgo(3), '2026-10-09'),
    act('quill', 'recap', daysAgo(2), '2026-10-10'),
    act('pettibone', 'recap', daysAgo(0.5), '2026-10-12'),
  ]
  assert.equal(assignGamePosts('loss', NOW, NIGHT, activity).first, 'mercer')
  // Pettibone has never written a recap: he is the oldest.
  assert.equal(assignGamePosts('loss', NOW, NIGHT, activity.slice(0, 3)).first, 'pettibone')
  // A reaction or a night recap does not count in the recap queue.
  const other: Activity = [
    act('barlow', 'reaction', daysAgo(0.1), NIGHT),
    act('barlow', 'night', daysAgo(0.2), '2026-10-11'),
  ]
  assert.equal(assignGamePosts('routine_win', NOW, NIGHT, other).first, 'barlow')
})

void test('recap queue: Mercer and Rink limits still apply', () => {
  // Mercer wrote tonight already: not him, even with the oldest recap.
  const activity: Activity = [
    act('mercer', 'reaction', daysAgo(0.05), NIGHT),
    act('quill', 'recap', daysAgo(1), '2026-10-11'),
    act('voss', 'recap', daysAgo(2), '2026-10-10'),
    act('pettibone', 'recap', daysAgo(3), '2026-10-09'),
  ]
  assert.equal(assignGamePosts('blowout_loss', NOW, NIGHT, activity).first, 'pettibone')
  // Rink wrote 3 days ago: goalie_steal never gives him a slot.
  const rinkRecent: Activity = [
    act('rink', 'night', daysAgo(3), '2026-10-09'),
    act('voss', 'recap', daysAgo(1), '2026-10-11'),
    act('quill', 'recap', daysAgo(1), '2026-10-11'),
    act('bergstrom', 'recap', daysAgo(1), '2026-10-11'),
  ]
  const r = assignGamePosts('goalie_steal', NOW, NIGHT, rinkRecent)
  assert.notEqual(r.first, 'rink')
  assert.notEqual(r.second, 'rink')
})

void test('reaction queue: separate from the recap queue, never the recap writer', () => {
  const activity: Activity = [
    act('vale', 'recap', daysAgo(5), '2026-10-07'),
    act('barlow', 'reaction', daysAgo(1), '2026-10-11'),
  ]
  // ot_win fits vale, barlow, bergstrom, rink. Barlow, Bergstrom and Rink never wrote a
  // recap, so they are older than Vale; a tie goes by list order. Barlow's reaction does not count.
  const r = assignGamePosts('ot_win', NOW, NIGHT, activity)
  assert.equal(r.first, 'barlow')
  // Reaction: not barlow; vale, bergstrom and rink never reacted -> vale (list order).
  assert.equal(r.second, 'vale')
})

// ── Night recaps ────────────────────────────────────────────────────────────

function nightFacts(wins: number, losses: number, otl: number, games: number): NewsFacts {
  const f = oct12Facts('night')
  const g = f.games[0]!
  return {
    ...f,
    games: Array.from({ length: games }, () => g),
    nightTotals: { ...f.nightTotals, wins, losses, otl },
  }
}

void test('night recap by situation on a clean record', () => {
  assert.equal(assignNightRecap(nightFacts(3, 0, 0, 3), NOW, []), 'vale')
  assert.equal(assignNightRecap(nightFacts(2, 1, 0, 3), NOW, []), 'barlow')
  assert.equal(assignNightRecap(nightFacts(1, 1, 0, 2), NOW, []), 'halberd')
  assert.equal(assignNightRecap(nightFacts(1, 2, 0, 3), NOW, []), 'quill')
  assert.equal(assignNightRecap(nightFacts(0, 3, 0, 3), NOW, []), 'mercer')
  assert.equal(assignNightRecap(nightFacts(1, 0, 0, 1), NOW, []), 'barlow')
})

void test('night recap: never the writer of the previous night recap', () => {
  // even fits halberd, quill. Halberd wrote the last one; Quill's is older but he wrote before.
  const activity: Activity = [
    act('quill', 'night', daysAgo(5), '2026-10-07'),
    act('halberd', 'night', daysAgo(1), '2026-10-11'),
  ]
  assert.equal(assignNightRecap(nightFacts(1, 1, 0, 2), NOW, activity), 'quill')
  // sweep fits vale, barlow, bergstrom; Barlow wrote the last one, Vale's is the oldest.
  const sweep: Activity = [
    act('vale', 'night', daysAgo(3), '2026-10-09'),
    act('bergstrom', 'night', daysAgo(2), '2026-10-10'),
    act('barlow', 'night', daysAgo(1), '2026-10-11'),
  ]
  assert.equal(assignNightRecap(nightFacts(3, 0, 0, 3), NOW, sweep), 'vale')
})

void test('night recap: Rink on a long sweep or winless night, only if allowed', () => {
  assert.equal(assignNightRecap(nightFacts(4, 0, 0, 4), NOW, []), 'rink')
  assert.equal(assignNightRecap(nightFacts(0, 4, 0, 4), NOW, []), 'rink')
  const recent: Activity = [act('rink', 'night', daysAgo(5), '2026-10-07')]
  assert.equal(assignNightRecap(nightFacts(4, 0, 0, 4), NOW, recent), 'vale')
  assert.equal(assignNightRecap(nightFacts(0, 4, 0, 4), NOW, recent), 'mercer')
})

void test('night recap: Mercer already wrote tonight ⇒ the next fitting reporter', () => {
  const activity: Activity = [act('mercer', 'recap', daysAgo(0.05), NIGHT)]
  assert.equal(assignNightRecap(nightFacts(0, 3, 0, 3), NOW, activity), 'barlow')
})

// ── A simulated season ──────────────────────────────────────────────────────

const SITUATIONS: readonly GameSituation[] = [
  'routine_win',
  'loss',
  'quiet_win',
  'blowout_loss',
  'ot_win',
  'routine_win',
  'goalie_steal',
  'ot_loss',
  'loss',
]

/** 30 nights, one every day; 1-4 games each; deterministic. */
function simulate(): { recaps: ReporterId[]; nights: ReporterId[]; activity: Activity } {
  const activity: Activity = []
  const recaps: ReporterId[] = []
  const nights: ReporterId[] = []
  const start = Date.parse('2026-09-01T02:00:00.000Z')
  let k = 0
  for (let n = 0; n < 30; n++) {
    const night = new Date(start + n * 86_400_000).toISOString().slice(0, 10)
    const games = 1 + (n % 4)
    let wins = 0
    for (let g = 0; g < games; g++) {
      const s = SITUATIONS[k++ % SITUATIONS.length]!
      if (s.endsWith('win') || s === 'goalie_steal') wins++
      const at = new Date(start + n * 86_400_000 + g * 3_600_000)
      const a = assignGamePosts(s, at, night, activity)
      recaps.push(a.first)
      activity.push({ reporter: a.first, kind: 'recap', night, createdAt: at })
      if (a.second !== null) {
        activity.push({
          reporter: a.second,
          kind: 'reaction',
          night,
          createdAt: new Date(at.getTime() + 1000),
        })
      }
    }
    const at = new Date(start + n * 86_400_000 + games * 3_600_000 + 5_400_000)
    const r = assignNightRecap(nightFacts(wins, games - wins, 0, games), at, activity)
    nights.push(r)
    activity.push({ reporter: r, kind: 'night', night, createdAt: at })
  }
  return { recaps, nights, activity }
}

void test('simulated month: no two night recaps in a row by one reporter; Halberd gets turns; limits hold', () => {
  const { recaps, nights, activity } = simulate()
  for (let i = 1; i < nights.length; i++) {
    assert.notEqual(nights[i], nights[i - 1], `night recaps ${String(i - 1)} and ${String(i)}`)
  }
  assert.ok(recaps.includes('halberd'), 'Halberd writes game recaps')
  assert.ok(nights.includes('halberd'), 'Halberd writes night recaps')
  assert.ok(recaps.includes('pettibone'), 'Pettibone writes game recaps')
  assert.ok(nights.includes('bergstrom') || recaps.includes('bergstrom'), 'Bergstrom gets turns')
  // No reporter has more than half the recaps.
  const counts = new Map<ReporterId, number>()
  for (const r of recaps) counts.set(r, (counts.get(r) ?? 0) + 1)
  for (const [r, c] of counts) assert.ok(c <= recaps.length / 2, `${r}: ${String(c)} recaps`)
  // Mercer: one item a night, three in any 7 days. Rink: one in 14 days.
  const mercer = activity.filter((a) => a.reporter === 'mercer')
  for (const a of mercer) {
    assert.equal(mercer.filter((b) => b.night === a.night).length, 1)
    const week = mercer.filter(
      (b) =>
        b.createdAt <= a.createdAt &&
        b.createdAt.getTime() > a.createdAt.getTime() - 7 * 86_400_000,
    )
    assert.ok(week.length <= 3)
  }
  const rink = activity.filter((a) => a.reporter === 'rink').map((a) => a.createdAt.getTime())
  for (let i = 1; i < rink.length; i++) assert.ok(rink[i]! - rink[i - 1]! >= 14 * 86_400_000)
  // Deterministic.
  assert.deepEqual(simulate().nights, nights)
  assert.deepEqual(simulate().recaps, recaps)
})

// ── Weekly feature kinds ────────────────────────────────────────────────────

void test('feature kind: trend → spotlight → notes → bigpicture → rink (if allowed) → trend', () => {
  assert.equal(nextFeatureKind(null, true), 'trend')
  assert.equal(nextFeatureKind('trend', true), 'spotlight')
  assert.equal(nextFeatureKind('spotlight', true), 'notes')
  assert.equal(nextFeatureKind('notes', true), 'bigpicture')
  assert.equal(nextFeatureKind('bigpicture', true), 'rink')
  assert.equal(nextFeatureKind('bigpicture', false), 'trend')
  assert.equal(nextFeatureKind('rink', true), 'trend')
  // Ten weeks in a row with Rink always allowed: rink every 5th feature.
  const seq: FeatureKind[] = []
  let last: FeatureKind | null = null
  for (let i = 0; i < 10; i++) {
    last = nextFeatureKind(last, true)
    seq.push(last)
  }
  assert.deepEqual(seq, [
    'trend',
    'spotlight',
    'notes',
    'bigpicture',
    'rink',
    'trend',
    'spotlight',
    'notes',
    'bigpicture',
    'rink',
  ])
})

void test('assignFeature: the kind decides the reporter; Rink only when his 14-day limit allows', () => {
  assert.deepEqual(assignFeature(null, NOW, []), { kind: 'trend', reporter: 'quill' })
  assert.deepEqual(assignFeature('trend', NOW, []), { kind: 'spotlight', reporter: 'voss' })
  assert.deepEqual(assignFeature('spotlight', NOW, []), { kind: 'notes', reporter: 'pettibone' })
  assert.deepEqual(assignFeature('notes', NOW, []), { kind: 'bigpicture', reporter: 'bergstrom' })
  assert.deepEqual(assignFeature('bigpicture', NOW, []), { kind: 'rink', reporter: 'rink' })
  const rinkRecent: Activity = [act('rink', 'night', daysAgo(10), '2026-10-03')]
  assert.deepEqual(assignFeature('bigpicture', NOW, rinkRecent), {
    kind: 'trend',
    reporter: 'quill',
  })
  for (const k of ['trend', 'spotlight', 'notes', 'bigpicture', 'rink'] as const) {
    const next = assignFeature(k, NOW, [])
    assert.equal(next.reporter, FEATURE_REPORTER[next.kind])
  }
})
