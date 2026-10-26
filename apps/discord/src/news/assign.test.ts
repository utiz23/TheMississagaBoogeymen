import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PAIR_WEIGHT_RECENT,
  PAIR_WEIGHT_RELATIONSHIP,
  assignFeature,
  assignGameArticles,
  assignGamePosts,
  assignNightRecap,
  assignRecap,
  isAllowed,
  nextFeatureKind,
  pairWeight,
  predictionToJudge,
  type Activity,
  type ActivityKind,
} from './assign.ts'
import { oct12Facts } from './test-fixtures.ts'
import {
  FEATURE_REPORTER,
  REPORTER_IDS,
  type FeatureKind,
  type NewsFacts,
  type NewsTake,
  type ReporterId,
} from '@eanhl/db/news'
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

// ── Game posts: the recap, then the buzz's extra posts (C3a.8) ──────────────

void test('clean record: the first fitting reporter writes the recap', () => {
  assert.equal(assignRecap('blowout_loss', NOW, NIGHT, []), 'mercer')
  assert.equal(assignRecap('ot_loss', NOW, NIGHT, []), 'mercer')
  assert.equal(assignRecap('routine_win', NOW, NIGHT, []), 'barlow')
  assert.equal(assignRecap('quiet_win', NOW, NIGHT, []), 'quill')
  assert.equal(assignRecap('loss', NOW, NIGHT, []), 'barlow')
  assert.equal(assignRecap('goalie_steal', NOW, NIGHT, []), 'voss')
})

void test('recap queue: the fitting reporter whose LAST recap is oldest writes (never = oldest)', () => {
  // loss fits barlow, mercer, quill, pettibone.
  const activity: Activity = [
    act('barlow', 'recap', daysAgo(1), '2026-10-11'),
    act('mercer', 'recap', daysAgo(3), '2026-10-09'),
    act('quill', 'recap', daysAgo(2), '2026-10-10'),
    act('pettibone', 'recap', daysAgo(0.5), '2026-10-12'),
  ]
  assert.equal(assignRecap('loss', NOW, NIGHT, activity), 'mercer')
  // Pettibone has never written a recap: he is the oldest.
  assert.equal(assignRecap('loss', NOW, NIGHT, activity.slice(0, 3)), 'pettibone')
  // A reaction or a night recap does not count in the recap queue.
  const other: Activity = [
    act('barlow', 'reaction', daysAgo(0.1), NIGHT),
    act('barlow', 'night', daysAgo(0.2), '2026-10-11'),
  ]
  assert.equal(assignRecap('routine_win', NOW, NIGHT, other), 'barlow')
})

void test('recap: Mercer limits apply; Rink is never on a game list unless the game is historic', () => {
  const activity: Activity = [
    act('mercer', 'reaction', daysAgo(0.05), NIGHT),
    act('quill', 'recap', daysAgo(1), '2026-10-11'),
    act('voss', 'recap', daysAgo(2), '2026-10-10'),
    act('pettibone', 'recap', daysAgo(3), '2026-10-09'),
  ]
  assert.equal(assignRecap('blowout_loss', NOW, NIGHT, activity), 'pettibone')
  // Historic waives the limits: Mercer's oldest recap wins again.
  assert.equal(assignRecap('blowout_loss', NOW, NIGHT, activity, true), 'mercer')
  // ot_win lists Rink; with everyone else's recap recent he still never gets a normal game ...
  const recent: Activity = ['vale', 'barlow', 'bergstrom'].map((r) =>
    act(r as ReporterId, 'recap', daysAgo(0.5), '2026-10-12'),
  )
  assert.notEqual(assignRecap('ot_win', NOW, NIGHT, recent), 'rink')
  // ... but he does on a historic one (his limit waived too).
  const rinkRecent = [...recent, act('rink', 'night', daysAgo(3), '2026-10-09')]
  assert.equal(assignRecap('ot_win', NOW, NIGHT, rinkRecent, true), 'rink')
})

function gameSetup(topFacts = 12) {
  const facts = oct12Facts('game')
  facts.topFacts = Array.from({ length: topFacts }, (_, i) => ({
    id: `f${String(i)}`,
    text: `Fact ${String(i)}`,
    weight: 100 - i,
    subject: null,
  }))
  return { facts, game: facts.games[0]! }
}

const posts = (
  level: 'quiet' | 'normal' | 'big' | 'huge' | 'historic',
  count: number,
  over: Partial<Parameters<typeof assignGamePosts>[0]> = {},
) => {
  const { facts, game } = gameSetup()
  return assignGamePosts({
    game,
    facts,
    situation: 'loss',
    plan: { level, posts: count },
    now: NOW,
    night: NIGHT,
    activity: [],
    ...over,
  })
}

void test('assignGamePosts: the buzz count, distinct reporters, distinct angles and top facts', () => {
  assert.deepEqual(
    posts('quiet', 1).map((p) => [p.reporter, p.angle, p.factId]),
    [['barlow', 'recap', 'f0']],
  )
  for (let id = 1; id < 40; id++) {
    const { facts, game } = gameSetup()
    const big = assignGamePosts({
      game: { ...game, matchId: id },
      facts,
      situation: 'loss',
      plan: { level: 'huge', posts: 8 },
      now: NOW,
      night: NIGHT,
      activity: [],
    })
    assert.equal(big.length, 8)
    assert.equal(new Set(big.map((p) => p.reporter)).size, 8)
    assert.equal(big[0]!.angle, 'recap')
    assert.equal(new Set(big.map((p) => p.angle)).size, 8, 'no two posts share an angle')
    const factIds = big.flatMap((p) => (p.factId === null ? [] : [p.factId]))
    assert.equal(new Set(factIds).size, factIds.length, 'no two posts share a top fact')
    assert.ok(!big.some((p) => p.reporter === 'rink'), 'Rink only on historic games')
    big.forEach((p, i) => {
      const reply = p.angle === 'reply' || p.angle === 'counterpoint'
      assert.equal(p.replyTo !== null, reply)
      if (p.replyTo !== null) assert.ok(p.replyTo < i)
    })
    // Seeded: the same game gives the same posts.
    assert.deepEqual(
      assignGamePosts({
        game: { ...game, matchId: id },
        facts,
        situation: 'loss',
        plan: { level: 'huge', posts: 8 },
        now: NOW,
        night: NIGHT,
        activity: [],
      }),
      big,
    )
  }
})

void test('assignGamePosts: a historic game gets all nine, Mercer and Rink limits waived', () => {
  const activity: Activity = [
    act('mercer', 'recap', daysAgo(0.1), NIGHT),
    act('rink', 'night', daysAgo(2), '2026-10-10'),
  ]
  const all = posts('historic', 9, { activity })
  assert.deepEqual([...all.map((p) => p.reporter)].sort(), [...REPORTER_IDS].sort())
  // A non-historic game with Mercer's item tonight leaves him out, and never has Rink.
  const big = posts('huge', 8, { activity })
  assert.ok(!big.some((p) => p.reporter === 'mercer' || p.reporter === 'rink'))
  assert.equal(big.length, 7) // only seven reporters are allowed
  // A benched reporter never writes.
  assert.ok(!posts('huge', 8, { disabled: ['vale'] }).some((p) => p.reporter === 'vale'))
})

void test('assignGamePosts: a due take gives its critic the take angle; at most one take per game', () => {
  const take: NewsTake = {
    id: 7,
    reporter: 'mercer',
    critics: REPORTER_IDS.filter((r) => r !== 'mercer'),
    defender: null,
    playerId: 1,
    player: 'Skater A',
    take: 'Invented take for a test.',
    spread: 'some',
    dataAngle: 'shots per game',
    intensity: 0,
    mild: false,
  }
  const p = posts('big', 4, { takes: [take] })
  const withTake = p.filter((x) => x.takeId !== null)
  assert.equal(withTake.length, 1)
  assert.equal(withTake[0]!.angle, 'take')
  assert.equal(withTake[0]!.takeId, 7)
  assert.equal(withTake[0]!.factId, null)
  // The recap never carries a take.
  assert.equal(p[0]!.takeId, null)
})

void test('pair weights: a written relationship 3x, a recent pair 0.2x, others 1', () => {
  const none = new Set<string>()
  assert.equal(pairWeight('barlow', 'mercer', none), PAIR_WEIGHT_RELATIONSHIP)
  assert.equal(pairWeight('halberd', 'vale', none), 1)
  assert.equal(pairWeight('barlow', 'mercer', new Set(['barlow>mercer'])), 3 * PAIR_WEIGHT_RECENT)
  assert.equal(PAIR_WEIGHT_RELATIONSHIP, 3)
  assert.equal(PAIR_WEIGHT_RECENT, 0.2)
})

void test('replies: relationship pairs answer more often; a recent pair less (seeded draw)', () => {
  const { facts, game } = gameSetup()
  const count = (activity: Activity) => {
    let pairs = 0
    for (let id = 1; id < 400; id++) {
      const p = assignGamePosts({
        game: { ...game, matchId: id },
        facts,
        situation: 'ot_loss', // recap: Mercer
        plan: { level: 'normal', posts: 2 },
        now: NOW,
        night: '2026-10-20',
        activity,
      })
      if (p[1]!.replyTo === 0 && p[1]!.reporter === 'barlow') pairs++
    }
    return pairs
  }
  const fresh = count([])
  const recent = count(
    Array.from({ length: 3 }, (_, i) => ({
      reporter: 'barlow' as const,
      night: '2026-10-11',
      createdAt: daysAgo(1 + i),
      kind: 'reaction' as const,
      replyTo: 'mercer' as const,
    })),
  )
  assert.ok(fresh > 0)
  assert.ok(recent <= fresh, `${String(recent)} <= ${String(fresh)}`)
})

void test('assignGameArticles: distinct writers; a game story, Voss spotlights, a columnist column', () => {
  const a = assignGameArticles({
    kinds: ['game', 'spotlight', 'column'],
    situation: 'routine_win',
    historic: true,
    now: NOW,
    night: NIGHT,
    activity: [],
  })
  assert.deepEqual(
    a.map((x) => x.kind),
    ['game', 'spotlight', 'column'],
  )
  assert.equal(a[0]!.reporter, 'barlow')
  assert.equal(a[1]!.reporter, 'voss')
  assert.equal(a[2]!.reporter, 'bergstrom')
  // The game queue: Barlow's recent game story sends the next one to Halberd.
  const next = assignGameArticles({
    kinds: ['game'],
    situation: 'routine_win',
    historic: false,
    now: NOW,
    night: NIGHT,
    activity: [act('barlow', 'game', daysAgo(1), '2026-10-11')],
  })
  assert.equal(next[0]!.reporter, 'halberd')
  // Disabled reporters are skipped.
  assert.notEqual(
    assignGameArticles({
      kinds: ['spotlight'],
      situation: 'loss',
      historic: false,
      now: NOW,
      night: NIGHT,
      activity: [],
      disabled: ['voss'],
    })[0]!.reporter,
    'voss',
  )
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
      const { facts, game } = gameSetup()
      const a = assignGamePosts({
        game: { ...game, matchId: k },
        facts,
        situation: s,
        plan: { level: 'normal', posts: 1 + (k % 3) },
        now: at,
        night,
        activity,
      })
      recaps.push(a[0]!.reporter)
      a.forEach((p, i) =>
        activity.push({
          reporter: p.reporter,
          kind: i === 0 ? 'recap' : 'reaction',
          night,
          createdAt: new Date(at.getTime() + 1000 * i),
          replyTo: p.replyTo === null ? null : a[p.replyTo]!.reporter,
        }),
      )
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

void test('predictionToJudge: only the prediction of the week right before (spec §12.6)', () => {
  const last = { prediction: 'Someone finally beats the goalie.', weekStart: '2026-10-12' }
  assert.equal(predictionToJudge('2026-10-19', last), last.prediction)
  // A gap week: the prediction was about a week with no games, so nothing to judge.
  assert.equal(predictionToJudge('2026-10-26', last), null)
  assert.equal(predictionToJudge('2026-10-19', { ...last, prediction: null }), null)
  assert.equal(predictionToJudge('2026-10-19', null), null)
  // Across the end of the year and a DST change.
  assert.equal(
    predictionToJudge('2027-01-04', { ...last, weekStart: '2026-12-28' }),
    last.prediction,
  )
  assert.equal(
    predictionToJudge('2026-11-02', { ...last, weekStart: '2026-10-26' }),
    last.prediction,
  )
})

// ── The per-reporter switch (C3b.3) ─────────────────────────────────────────

void test('C3b.3: a benched reporter never writes the recap, a night recap, a feature or a game article', () => {
  // routine_win's recap is Barlow; benched, the next fitting reporter writes.
  assert.equal(assignRecap('routine_win', NOW, NIGHT, [], false, ['barlow']), 'halberd')
  // The recap of a post list never goes to a benched reporter, for any seed.
  for (let id = 1; id < 30; id++) {
    const { facts, game } = gameSetup()
    const list = assignGamePosts({
      game: { ...game, matchId: id },
      facts,
      situation: 'routine_win',
      plan: { level: 'big', posts: 4 },
      now: NOW,
      night: NIGHT,
      activity: [],
      disabled: ['barlow', 'vale'],
    })
    assert.ok(list.every((p) => p.reporter !== 'barlow' && p.reporter !== 'vale'))
  }
  // Night recap: a sweep fits vale first; benched, the queue moves on.
  assert.equal(assignNightRecap(nightFacts(3, 0, 0, 3), NOW, [], ['vale']), 'barlow')
  // Rink's own night is not his when he is benched.
  assert.equal(assignNightRecap(nightFacts(4, 0, 0, 4), NOW, [], ['rink']), 'vale')
  // Only one reporter left, and he wrote the previous night: he writes again.
  const only = REPORTER_IDS.filter((r) => r !== 'quill')
  assert.equal(
    assignNightRecap(
      nightFacts(1, 1, 0, 2),
      NOW,
      [act('quill', 'night', daysAgo(1), '2026-10-11')],
      only,
    ),
    'quill',
  )
  // Weekly features: a benched writer's kind is skipped, the rotation moves on.
  assert.deepEqual(assignFeature(null, NOW, [], ['quill']), { kind: 'spotlight', reporter: 'voss' })
  assert.deepEqual(assignFeature('trend', NOW, [], ['voss', 'pettibone']), {
    kind: 'bigpicture',
    reporter: 'bergstrom',
  })
  // After bigpicture Rink's column is skipped when he is benched.
  assert.deepEqual(assignFeature('bigpicture', NOW, [], ['rink']), {
    kind: 'trend',
    reporter: 'quill',
  })
  // All four feature writers benched: nothing to assign.
  assert.throws(
    () => assignFeature(null, NOW, [], ['quill', 'voss', 'pettibone', 'bergstrom', 'rink']),
    /no feature writer/,
  )
})

void test('C3a fix I4: only critics voice a take; the defender replies to the critic, never voicing it', () => {
  const take: NewsTake = {
    id: 7,
    reporter: 'mercer',
    critics: ['pettibone'],
    defender: 'quill',
    playerId: 1,
    player: 'Skater A',
    take: 'Invented take for a test.',
    spread: 'some',
    dataAngle: 'shots per game',
    intensity: 0,
    mild: false,
  }
  let pushed = 0
  for (let id = 1; id < 80; id++) {
    const { facts, game } = gameSetup()
    const p = assignGamePosts({
      game: { ...game, matchId: id },
      facts,
      situation: 'loss',
      plan: { level: 'huge', posts: 8 },
      now: NOW,
      night: NIGHT,
      activity: [],
      takes: [take],
    })
    p.forEach((x, i) => {
      if (x.takeId !== null) assert.ok(['mercer', 'pettibone'].includes(x.reporter), x.reporter)
      if (x.reporter === 'quill') assert.equal(x.takeId, null, 'the defender never voices it')
      if (x.pushesBack !== undefined) {
        pushed++
        assert.equal(x.reporter, 'quill')
        assert.equal(x.pushesBack, 7)
        assert.ok(x.replyTo !== null && x.replyTo < i)
        assert.equal(p[x.replyTo]!.takeId, 7)
        assert.ok(x.angle === 'reply' || x.angle === 'counterpoint')
      }
    })
  }
  assert.ok(pushed > 0, 'some games have the defender answer')
})
