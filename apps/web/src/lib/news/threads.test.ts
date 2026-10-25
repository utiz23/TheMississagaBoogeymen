import test from 'node:test'
import assert from 'node:assert/strict'
import type { NewsPerson } from '@eanhl/db/news'
import {
  buildThreads,
  persisted,
  playerThreads,
  rivalThreads,
  stancesWithoutForbidden,
  teamThreads,
  threadRuns,
  type ThreadTeamGame,
} from './threads.ts'
import type { PlayerGameInput } from './players.ts'

let nextId = 1
const tg = (
  night: string,
  result: ThreadTeamGame['result'],
  over: Partial<ThreadTeamGame> = {},
): ThreadTeamGame => ({
  matchId: nextId++,
  night,
  result,
  opponentName: 'Other Club',
  ppGoals: 0,
  ppOpportunities: 0,
  endedEarly: false,
  ...over,
})
const nights = (...spec: [string, ThreadTeamGame['result']][]) => spec.map(([d, r]) => tg(d, r))

void test('persisted: the label is on at the last item and the whole run covers 2 nights (C2 fix I1)', () => {
  const it = (night: string) => ({ night, inSheet: false })
  assert.equal(persisted([it('a'), it('b')], 3), false)
  assert.equal(persisted([it('a'), it('a'), it('b')], 3), true)
  assert.equal(persisted([it('a'), it('a'), it('a')], 3), false)
  assert.equal(persisted([it('a'), it('b')], 1), true)
})

void test('threadRuns: open at the end; closed tonight only when a sheet item ends it', () => {
  const it = (night: string, hit: boolean, inSheet = false) => ({ night, hit, inSheet })
  const seq = [it('1', true), it('2', true), it('3', true), it('4', false, true)]
  assert.deepEqual(
    threadRuns(seq, (x) => x.hit, 1).map((r) => [r.items.length, r.status]),
    [[3, 'closed-tonight']],
  )
  // Ended before the sheet: no thread.
  const old = [it('1', true), it('2', true), it('3', true), it('4', false), it('5', false, true)]
  assert.deepEqual(
    threadRuns(old, (x) => x.hit, 1),
    [],
  )
  assert.deepEqual(
    threadRuns(seq.slice(0, 3), (x) => x.hit, 1).map((r) => r.status),
    ['open'],
  )
})

void test('teamThreads: a losing streak with the slide label over 2+ nights opens; a win tonight closes it; a win streak needs 5 over 2+ nights', () => {
  const prior = nights(
    ['2026-05-01', 'WIN'],
    ['2026-05-01', 'LOSS'],
    ['2026-05-02', 'LOSS'],
    ['2026-05-03', 'OTL'],
    ['2026-05-04', 'LOSS'],
  )
  const sheet = [tg('2026-05-05', 'LOSS')]
  const open = teamThreads(prior, sheet).filter((t) => t.kind === 'losing-streak')
  assert.deepEqual(open, [
    {
      key: 'losing-streak@2026-05-01',
      kind: 'losing-streak',
      subject: null,
      since: '2026-05-01',
      status: 'open',
      summary: 'lost 5 straight',
    },
  ])
  // Two losses: no slide label yet; three losses over two nights: a thread.
  assert.deepEqual(
    teamThreads(prior.slice(0, 3), []).filter((t) => t.kind === 'losing-streak'),
    [],
  )
  assert.equal(
    teamThreads(prior.slice(0, 4), []).filter((t) => t.kind === 'losing-streak')[0]?.summary,
    'lost 3 straight',
  )
  const closed = teamThreads([...prior, ...sheet], [tg('2026-05-06', 'WIN')]).filter(
    (t) => t.kind === 'losing-streak',
  )
  assert.equal(closed[0]!.status, 'closed-tonight')
  assert.equal(closed[0]!.summary, 'a 5-game losing streak ended')
  // Five wins on one night: no thread; four wins on two nights: no rolling label yet.
  const wins = nights(['a1', 'WIN'], ['a1', 'WIN'], ['a1', 'WIN'], ['a1', 'WIN'], ['a1', 'WIN'])
  assert.deepEqual(
    teamThreads(wins, []).filter((t) => t.kind === 'winning-streak'),
    [],
  )
  assert.deepEqual(
    teamThreads(nights(['b1', 'WIN'], ['b1', 'WIN'], ['b2', 'WIN'], ['b2', 'WIN']), []),
    [],
  )
  const longer = [...wins, tg('a3', 'WIN'), tg('a4', 'WIN')]
  assert.equal(teamThreads(longer, [])[0]!.summary, 'won 7 straight')
})

void test('teamThreads: a power-play drought skips games without a chance and ended-early games; a PP goal tonight closes it', () => {
  const pp = (night: string, goals: number, chances: number, over: Partial<ThreadTeamGame> = {}) =>
    tg(night, 'WIN', { ppGoals: goals, ppOpportunities: chances, ...over })
  const prior = [
    pp('n1', 0, 2),
    pp('n1', 0, 0),
    pp('n2', 0, 3),
    pp('n2', 2, 2, { endedEarly: true }),
    pp('n3', 0, 1),
    pp('n4', 0, 2),
    pp('n5', 0, 1),
  ]
  const t = teamThreads(prior, []).find((x) => x.kind === 'pp-drought')
  assert.deepEqual(t && [t.key, t.status, t.summary], [
    'pp-drought@n1',
    'open',
    'no power-play goal in 9 chances over 5 games',
  ])
  const c = teamThreads(prior, [pp('n6', 1, 3)]).find((x) => x.kind === 'pp-drought')
  assert.deepEqual(c && [c.status, c.summary], [
    'closed-tonight',
    'scored on the power play after 9 chances without a goal over 5 games',
  ])
})

void test('rivalThreads: lost to them on 3+ nights with a losing record; open after a loss, closed after a win', () => {
  const vs = (night: string, result: ThreadTeamGame['result']) =>
    tg(night, result, { opponentName: 'Shake  N Bake' })
  const prior = [vs('r1', 'LOSS'), vs('r2', 'OTL'), vs('r3', 'WIN')]
  assert.deepEqual(rivalThreads(prior, [vs('r4', 'LOSS')]), [
    {
      key: 'rival:shake n bake@r1',
      kind: 'rival',
      subject: 'Shake N Bake',
      since: 'r1',
      status: 'open',
      summary: 'lost to Shake N Bake on 3 nights this title',
    },
  ])
  const after = [...prior, vs('r4', 'LOSS')]
  const won = rivalThreads(after, [vs('r5', 'WIN')])
  assert.deepEqual(
    won.map((t) => [t.status, t.summary]),
    [['closed-tonight', 'beat Shake N Bake after losing to them on 3 nights this title']],
  )
  // Two loss nights, or an even record: none.
  assert.deepEqual(rivalThreads(prior.slice(0, 2), [vs('r1', 'LOSS')]), [])
  assert.deepEqual(
    rivalThreads([...prior, vs('r3', 'WIN'), vs('r3', 'WIN')], [vs('r4', 'LOSS')]),
    [],
  )
})

const TITLE = 7
const pr = (
  matchId: number,
  night: string,
  goals: number,
  assists: number,
  over: Partial<PlayerGameInput> = {},
): PlayerGameInput => ({
  matchId,
  gameTitleId: TITLE,
  night,
  playedAt: '2026-05-01T00:00:00.000Z',
  gameMode: '6s',
  result: 'WIN',
  goals,
  assists,
  shots: 0,
  hits: 0,
  position: 'F',
  endedEarly: false,
  ...over,
})
const people: NewsPerson[] = [{ playerId: 2, name: 'Skater A', pressLevel: 'full' }]

void test('playerThreads: a point streak on 3 nights; a forward slump of 8+ on 3 nights closed by a goal tonight', () => {
  const hot = [
    pr(1, 'p1', 1, 0),
    pr(2, 'p2', 0, 1),
    pr(3, 'p3', 0, 1),
    pr(4, 'p4', 1, 1),
    pr(5, 'p5', 1, 0),
  ]
  const t = playerThreads(people, new Map([[2, hot]]), TITLE, new Set([5]))
  assert.deepEqual(t, [
    {
      key: 'player-hot:2@p1',
      kind: 'player-hot',
      subject: 'Skater A',
      since: 'p1',
      status: 'open',
      summary: 'Skater A: points in 5 straight games',
    },
  ])
  const dry = Array.from({ length: 12 }, (_, i) =>
    pr(10 + i, `d${String(Math.floor(i / 2))}`, 0, 0),
  )
  // Goals in 8 earlier games (one night): his goal-less rate stays moderate.
  const scored = Array.from({ length: 8 }, (_, i) => pr(40 + i, 'c0', 1, 0))
  const slump = playerThreads(
    people,
    new Map([[2, [...scored, ...dry, pr(30, 'd9', 1, 0)]]]),
    TITLE,
    new Set([30]),
  )
  assert.deepEqual(
    slump.map((x) => [x.key, x.status, x.summary]),
    [['player-slump:2@d0', 'closed-tonight', 'Skater A scored, ending 12 games without a goal']],
  )
  // A defenceman: no slump thread; a player without a sheet game: no threads; DNF rows skipped.
  const d = dry.map((r) => ({ ...r, position: 'D' as const }))
  assert.deepEqual(playerThreads(people, new Map([[2, d]]), TITLE, new Set([19])), [])
  assert.deepEqual(playerThreads(people, new Map([[2, hot]]), TITLE, new Set([99])), [])
})

void test('buildThreads: team, rivals and players together', () => {
  const t = buildThreads({
    prior: nights(['b1', 'LOSS'], ['b2', 'LOSS'], ['b3', 'LOSS'], ['b4', 'LOSS']),
    sheet: [tg('b5', 'LOSS')],
    people,
    history: new Map(),
    gameTitleId: TITLE,
  })
  assert.deepEqual(
    t.map((x) => x.kind),
    ['losing-streak', 'rival'],
  )
})

void test('stancesWithoutForbidden: a stance naming a forbidden person is dropped (C2 fix M8)', () => {
  const st = (stance: string) => ({
    threadKey: 'k',
    reporter: 'quill' as const,
    stance,
    night: null,
  })
  const list = [
    st('Hidden  Hank will score soon.'),
    st('Hankering for goals.'),
    st('The slump ends.'),
  ]
  assert.deepEqual(
    stancesWithoutForbidden(list, ['Hidden Hank', 'Hank']).map((s) => s.stance),
    ['Hankering for goals.', 'The slump ends.'],
  )
  assert.equal(stancesWithoutForbidden(list, []).length, 3)
})
