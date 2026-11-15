import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTrends, mostInsulted, quietPlayers } from './storylines-trends.ts'

const roster = [
  { playerId: 1, name: 'Beev', pressLevel: 'full' },
  { playerId: 2, name: 'Silky', pressLevel: 'easy' },
  { playerId: 3, name: 'Zed', pressLevel: 'out' },
  { playerId: 4, name: 'Erb', pressLevel: 'full' },
] as const

void test('most insulted reporter: most feud-side pairs, then most points; the favour side never counts', () => {
  assert.equal(mostInsulted([]), null)
  assert.equal(mostInsulted([{ reporter: 'vale', level: 'fan', points: 9 }]), null)
  const r = mostInsulted([
    { reporter: 'pettibone', level: 'feud', points: -4 },
    { reporter: 'pettibone', level: 'war', points: -9 },
    { reporter: 'quill', level: 'feud', points: -12 },
    { reporter: 'vale', level: 'glazing', points: 20 },
  ])
  assert.equal(r?.reporter, 'pettibone')
  assert.equal(r?.name, 'Gord Pettibone')
  assert.equal(r?.pairs, 2)
  assert.equal(r?.points, 13)
  // A tie on pairs goes to the larger points.
  assert.equal(
    mostInsulted([
      { reporter: 'pettibone', level: 'feud', points: -4 },
      { reporter: 'quill', level: 'feud', points: -12 },
    ])?.reporter,
    'quill',
  )
})

void test('quiet players: members with no answer in the window, never a Leave me out player', () => {
  assert.deepEqual(
    quietPlayers(roster, [
      { playerId: 1, answers: 2 },
      { playerId: 2, answers: 0 },
    ]),
    ['Erb', 'Silky'],
  )
  assert.deepEqual(quietPlayers(roster, []), ['Beev', 'Erb', 'Silky'])
})

void test('buildTrends: limits each list, names the most quoted player, never a Leave me out player', () => {
  const note = (id: number, name: string) => ({ playerId: id, name, text: 't', weight: 1 })
  const t = buildTrends({
    hot: [note(1, 'a'), note(2, 'b'), note(3, 'c'), note(4, 'd')],
    cold: [],
    milestones: [],
    talk: [
      { playerId: 3, name: 'Zed', quotes: 9, answers: 9 },
      { playerId: 4, name: 'Erb', quotes: 4, answers: 5 },
      { playerId: 1, name: 'Beev', quotes: 0, answers: 3 },
    ],
    relationships: [],
    roster,
  })
  assert.equal(t.streaks.length, 3)
  assert.deepEqual(t.mostQuoted, { name: 'Erb', quotes: 4 })
  assert.equal(t.mostInsulted, null)
  assert.deepEqual(t.quiet, ['Silky'])
  assert.equal(
    buildTrends({ hot: [], cold: [], milestones: [], talk: [], relationships: [], roster })
      .mostQuoted,
    null,
  )
})
