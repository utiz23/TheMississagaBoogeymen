import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTER_IDS, type NewsTopFact, type ReporterId } from '@eanhl/db/news'
import { oct12Facts } from '../news/test-fixtures.ts'
import {
  EXTRAS_BUDGET_SHARE,
  PANEL_SIZE,
  PRESS_ACCEPT_MS,
  PRESS_ANSWER_MS,
  PRESS_COMMAND_LIMIT,
  PRESS_NIGHT_WAIT_MS,
  PRESS_OPEN_MS,
  PRESS_PING_LIMIT,
  chooseScrumReporter,
  choosePanel,
  drawTargetTotal,
  effectiveHeat,
  extrasBudgetLeft,
  followUpAllowed,
  followUpPlan,
  pickScrumPlayer,
  questionLimit,
  scrumCandidates,
  shouldPing,
  targetTotalFor,
  type Candidate,
} from './rules.ts'

const cand = (over: Partial<Candidate> & Pick<Candidate, 'playerId' | 'name'>): Candidate => ({
  pressLevel: 'full',
  discordUserId: String(over.playerId),
  star: null,
  points: 0,
  ...over,
})

const topFact = (subject: string | null, weight = 1): NewsTopFact => ({
  id: `f-${subject ?? 'none'}`,
  text: 'x',
  weight,
  subject,
})

void test('constants hold the planned values', () => {
  assert.equal(PRESS_ACCEPT_MS, 900_000)
  assert.equal(PRESS_ANSWER_MS, 900_000)
  assert.equal(PRESS_OPEN_MS, 3_600_000)
  assert.equal(PRESS_NIGHT_WAIT_MS, 1_800_000)
  assert.equal(PRESS_PING_LIMIT, 2)
  assert.equal(PRESS_COMMAND_LIMIT, 2)
  assert.equal(EXTRAS_BUDGET_SHARE, 0.8)
})

void test('scrumCandidates: people with a Discord ID, with star and points', () => {
  const facts = oct12Facts()
  const game = facts.games[0]!
  const ids = new Map([
    [1, 'd1'],
    [2, 'd2'],
    [3, 'd3'],
  ])
  const list = scrumCandidates(game, facts, ids)
  assert.deepEqual(
    list.map((c) => c.playerId),
    [1, 2, 3],
  )
  const a = list.find((c) => c.playerId === 1)!
  assert.equal(a.points, 2)
  assert.equal(a.discordUserId, 'd1')
  assert.equal(a.pressLevel, 'full')
  assert.equal(list.find((c) => c.playerId === 2)!.pressLevel, 'easy')
})

void test('scrumCandidates: no Discord ID, not in people (out or guest) and AI goalie are gone', () => {
  const facts = oct12Facts()
  const base = facts.games[0]!
  const game = {
    ...base,
    players: [
      ...base.players,
      { ...base.players[0]!, playerId: 9, name: 'Out Oscar' },
      { ...base.players[0]!, playerId: 10, name: 'Guest Gus' },
    ],
  }
  const ids = new Map([
    [1, 'd1'],
    [3, 'd3'],
    [9, 'd9'],
    [10, 'd10'],
  ])
  // player 2 has no Discord ID; 9 and 10 are not in facts.people
  const list = scrumCandidates(game, facts, ids)
  assert.deepEqual(
    list.map((c) => c.playerId),
    [1, 3],
  )
})

void test('scrumCandidates: a player id in people but only on the AI goalie line is not a candidate', () => {
  const facts = oct12Facts()
  const base = facts.games[0]!
  const game = {
    ...base,
    players: base.players.filter((p) => p.playerId !== 3),
    aiGoalie: { ...base.players[2]!, playerId: 3 } as unknown as typeof base.aiGoalie,
  }
  const ids = new Map([[3, 'd3']])
  assert.deepEqual(scrumCandidates(game, facts, ids), [])
})

void test('pickScrumPlayer: gmAsked wins over everything', () => {
  const list = [
    cand({ playerId: 1, name: 'A', star: 1, points: 5 }),
    cand({ playerId: 2, name: 'B', star: 3, points: 0 }),
  ]
  const p = pickScrumPlayer(list, [topFact('A')], 2)
  assert.equal(p?.playerId, 2)
})

void test('pickScrumPlayer: gmAsked not among candidates falls back to the normal order', () => {
  const list = [
    cand({ playerId: 1, name: 'A', star: 2 }),
    cand({ playerId: 2, name: 'B', star: 1 }),
  ]
  assert.equal(pickScrumPlayer(list, [], 99)?.playerId, 2)
})

void test('pickScrumPlayer: first topFact subject wins over star 1', () => {
  const list = [
    cand({ playerId: 1, name: 'A', star: 1, points: 4 }),
    cand({ playerId: 2, name: 'B', star: 3, points: 0 }),
  ]
  const facts = [topFact('Nobody'), topFact(null), topFact('B'), topFact('A')]
  assert.equal(pickScrumPlayer(list, facts, null)?.playerId, 2)
})

void test('pickScrumPlayer: lowest star, then most points, then lower playerId', () => {
  const byStar = [
    cand({ playerId: 1, name: 'A', star: 2, points: 9 }),
    cand({ playerId: 2, name: 'B', star: 1, points: 0 }),
    cand({ playerId: 3, name: 'C', star: null, points: 9 }),
  ]
  assert.equal(pickScrumPlayer(byStar, [], null)?.playerId, 2)

  const byPoints = [
    cand({ playerId: 5, name: 'E', points: 1 }),
    cand({ playerId: 4, name: 'D', points: 3 }),
    cand({ playerId: 6, name: 'F', points: 3 }),
  ]
  assert.equal(pickScrumPlayer(byPoints, [], null)?.playerId, 4)

  const tied = [cand({ playerId: 8, name: 'H' }), cand({ playerId: 7, name: 'G' })]
  assert.equal(pickScrumPlayer(tied, [], null)?.playerId, 7)
})

void test('pickScrumPlayer: no candidates ⇒ null', () => {
  assert.equal(pickScrumPlayer([], [topFact('A')], 1), null)
})

void test('shouldPing: only a gm ask or a big, huge or historic game', () => {
  assert.equal(shouldPing('normal', false), false)
  assert.equal(shouldPing('quiet', false), false)
  assert.equal(shouldPing('big', false), true)
  assert.equal(shouldPing('huge', false), true)
  assert.equal(shouldPing('historic', false), true)
  assert.equal(shouldPing('quiet', true), true)
})

void test('effectiveHeat: easy lowers hot to normal, nothing else changes', () => {
  assert.deepEqual(effectiveHeat('hot', 'easy'), { heat: 'normal', lowered: true })
  assert.deepEqual(effectiveHeat('hot', 'full'), { heat: 'hot', lowered: false })
  assert.deepEqual(effectiveHeat('cool', 'easy'), { heat: 'cool', lowered: false })
  assert.deepEqual(effectiveHeat('normal', 'easy'), { heat: 'normal', lowered: false })
})

const args = (over: Partial<Parameters<typeof chooseScrumReporter>[0]> = {}) => ({
  heat: 'normal' as 'normal' | 'hot' | 'cool',
  seed: 1,
  disabled: [] as ReporterId[],
  lastScrumReporter: null as ReporterId | null,
  takeReporters: [] as ReporterId[],
  ...over,
})

void test('chooseScrumReporter: never rink or a disabled reporter over 200 seeds', () => {
  const disabled: ReporterId[] = ['halberd', 'quill']
  for (let seed = 0; seed < 200; seed++) {
    const r = chooseScrumReporter(args({ seed, disabled }))
    assert.notEqual(r, 'rink')
    assert.ok(!disabled.includes(r))
  }
})

void test('chooseScrumReporter: hot picks mercer, pettibone or vale most of the time', () => {
  const hotOnes: ReporterId[] = ['mercer', 'pettibone', 'vale']
  let n = 0
  for (let seed = 0; seed < 200; seed++) {
    if (hotOnes.includes(chooseScrumReporter(args({ heat: 'hot', seed })))) n++
  }
  assert.ok(n > 100, `hot reporters picked ${n}/200`)
})

void test('chooseScrumReporter: cool picks voss, barlow or bergstrom most of the time', () => {
  const coolOnes: ReporterId[] = ['voss', 'barlow', 'bergstrom']
  let n = 0
  for (let seed = 0; seed < 200; seed++) {
    if (coolOnes.includes(chooseScrumReporter(args({ heat: 'cool', seed })))) n++
  }
  assert.ok(n > 100, `cool reporters picked ${n}/200`)
})

void test('chooseScrumReporter: takeReporters weigh double', () => {
  let n = 0
  for (let seed = 0; seed < 400; seed++) {
    if (chooseScrumReporter(args({ seed, takeReporters: ['quill'] })) === 'quill') n++
  }
  // weight 2 of 9 (8 non-rink reporters, one doubled) ≈ 22%; plain would be ≈ 12.5%
  assert.ok(n > 400 * 0.16, `quill picked ${n}/400`)
})

void test('chooseScrumReporter: not the last scrum reporter unless it is the only one left', () => {
  for (let seed = 0; seed < 200; seed++) {
    assert.notEqual(chooseScrumReporter(args({ seed, lastScrumReporter: 'mercer' })), 'mercer')
  }
  const only = REPORTER_IDS.filter((id) => id !== 'rink' && id !== 'vale')
  assert.equal(chooseScrumReporter(args({ disabled: only, lastScrumReporter: 'vale' })), 'vale')
})

void test('chooseScrumReporter: is deterministic for a seed', () => {
  assert.equal(chooseScrumReporter(args({ seed: 42 })), chooseScrumReporter(args({ seed: 42 })))
})

void test('chooseScrumReporter: every reporter excluded ⇒ barlow, no throw', () => {
  assert.equal(chooseScrumReporter(args({ disabled: [...REPORTER_IDS] })), 'barlow')
})

void test('questionLimit: picked 2, volunteer 1', () => {
  assert.equal(questionLimit('picked'), 2)
  assert.equal(questionLimit('volunteer'), 1)
})

void test('followUpAllowed: at most one follow-up per question, capped by the role limit', () => {
  const f = (questionsAsked: number, followupsAsked: number, role: 'picked' | 'volunteer') =>
    followUpAllowed({ questionsAsked, followupsAsked, role })
  assert.equal(f(1, 0, 'picked'), true)
  assert.equal(f(1, 1, 'picked'), false)
  assert.equal(f(2, 1, 'picked'), true)
  assert.equal(f(2, 2, 'picked'), false)
  assert.equal(f(1, 0, 'volunteer'), true)
  assert.equal(f(1, 1, 'volunteer'), false)
  assert.equal(f(2, 1, 'volunteer'), false)
  assert.equal(f(0, 0, 'picked'), false)
})

void test('extrasBudgetLeft: spent must stay under 80% of the limit', () => {
  assert.equal(extrasBudgetLeft(16, 20), false)
  assert.equal(extrasBudgetLeft(15.99, 20), true)
  assert.equal(extrasBudgetLeft(0, 0), false)
})

// ── Panel scrums: the panel, the target total, the follow-up plan ──────────

void test('panel size: 3 reporters for a picked player, 2 for a volunteer', () => {
  assert.equal(PANEL_SIZE.picked, 3)
  assert.equal(PANEL_SIZE.volunteer, 2)
})

void test('drawTargetTotal: 3 (10%), 4 (25%), 5 (50%), 6 (15%) over many seeds, and seeded', () => {
  const n = 20_000
  const counts = new Map<number, number>()
  for (let seed = 1; seed <= n; seed++) {
    const t = drawTargetTotal(seed)
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  assert.deepEqual([...counts.keys()].sort(), [3, 4, 5, 6])
  const share = (t: number): number => (counts.get(t) ?? 0) / n
  // Within one percentage point of the planned share.
  assert.ok(Math.abs(share(3) - 0.1) < 0.01, `3: ${String(share(3))}`)
  assert.ok(Math.abs(share(4) - 0.25) < 0.01, `4: ${String(share(4))}`)
  assert.ok(Math.abs(share(5) - 0.5) < 0.01, `5: ${String(share(5))}`)
  assert.ok(Math.abs(share(6) - 0.15) < 0.01, `6: ${String(share(6))}`)
  // The same seed, the same total.
  assert.equal(drawTargetTotal(12345), drawTargetTotal(12345))
})

void test('targetTotalFor: a volunteer is 2 (no follow-up); a picked player draws 3-6', () => {
  for (let seed = 1; seed <= 50; seed++) {
    assert.equal(targetTotalFor('volunteer', seed), 2)
    assert.ok([3, 4, 5, 6].includes(targetTotalFor('picked', seed)))
  }
})

const PANEL_ARGS = {
  size: 3,
  heat: 'normal' as 'normal' | 'hot' | 'cool',
  seed: 7,
  disabled: [] as ReporterId[],
  first: null,
  takeReporters: [] as ReporterId[],
}

void test('choosePanel: 3 different reporters, never Father Rink, never a disabled one', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const panel = choosePanel({ ...PANEL_ARGS, seed, disabled: ['quill', 'halberd'] })
    assert.equal(panel.length, 3)
    assert.equal(new Set(panel).size, 3)
    assert.ok(!panel.includes('rink'))
    assert.ok(!panel.includes('quill') && !panel.includes('halberd'))
  }
})

void test('choosePanel: the first reporter asks first; a disabled or Rink first is dropped; seeded', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const panel = choosePanel({ ...PANEL_ARGS, seed, first: 'vale' })
    assert.equal(panel[0], 'vale')
    assert.equal(new Set(panel).size, 3)
  }
  assert.ok(!choosePanel({ ...PANEL_ARGS, first: 'vale', disabled: ['vale'] }).includes('vale'))
  assert.ok(!choosePanel({ ...PANEL_ARGS, first: 'rink' }).includes('rink'))
  assert.deepEqual(choosePanel({ ...PANEL_ARGS, seed: 9 }), choosePanel({ ...PANEL_ARGS, seed: 9 }))
})

void test('choosePanel: a hot heat favours Mercer, Pettibone and Vale; a take weighs x2; a short pool gives a short panel', () => {
  const tally = (args: Partial<typeof PANEL_ARGS>) => {
    const counts = new Map<ReporterId, number>()
    for (let seed = 1; seed <= 3000; seed++) {
      for (const id of choosePanel({ ...PANEL_ARGS, ...args, seed })) {
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
    }
    return counts
  }
  const hot = tally({ heat: 'hot' })
  const normal = tally({ heat: 'normal' })
  for (const id of ['mercer', 'pettibone', 'vale'] as const) {
    assert.ok((hot.get(id) ?? 0) > (normal.get(id) ?? 0) * 1.2, id)
  }
  const taken = tally({ takeReporters: ['quill'] })
  assert.ok((taken.get('quill') ?? 0) > (normal.get('quill') ?? 0) * 1.1)
  // Only two reporters left: the panel has two.
  const two = choosePanel({
    ...PANEL_ARGS,
    disabled: REPORTER_IDS.filter((id) => id !== 'voss' && id !== 'mercer' && id !== 'rink'),
  })
  assert.deepEqual([...two].sort(), ['mercer', 'voss'])
})

void test('followUpPlan: the follow-ups go to the answers with the most to chase, one per reporter', () => {
  const plan = (
    targetTotal: number,
    questionsAsked: number,
    followupsAsked: number,
    askingFollowup = false,
  ) => followUpPlan({ panelSize: 3, questionsAsked, followupsAsked, askingFollowup, targetTotal })
  // Target 3: none, ever.
  for (const q of [1, 2, 3]) assert.equal(plan(3, q, 0), 'none')
  // Target 4: one follow-up wanted: only a lot to chase for Q1 and Q2; Q3 must use it.
  assert.equal(plan(4, 1, 0), 'chased')
  assert.equal(plan(4, 2, 0), 'chased')
  assert.equal(plan(4, 3, 0), 'must')
  assert.equal(plan(4, 3, 1), 'none')
  // Target 5: two wanted: Q1 chased; Q2 and Q3 must when none was used yet.
  assert.equal(plan(5, 1, 0), 'chased')
  assert.equal(plan(5, 2, 0), 'must')
  assert.equal(plan(5, 2, 1), 'chased')
  assert.equal(plan(5, 3, 1), 'must')
  assert.equal(plan(5, 3, 2), 'none')
  // Target 6: all three must.
  assert.equal(plan(6, 1, 0), 'must')
  assert.equal(plan(6, 2, 1), 'must')
  assert.equal(plan(6, 3, 2), 'must')
  // Never after a follow-up (one per reporter).
  assert.equal(plan(6, 1, 1, true), 'none')
  // A volunteer (panel 2, target 2): no follow-up.
  assert.equal(
    followUpPlan({
      panelSize: 2,
      questionsAsked: 1,
      followupsAsked: 0,
      askingFollowup: false,
      targetTotal: 2,
    }),
    'none',
  )
})
