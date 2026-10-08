import test from 'node:test'
import assert from 'node:assert/strict'
import { groupBuilds, pickTitleBuilds, type LoadoutSheet } from './build-runs.js'

let nextId = 1
const sheet = (
  partial: Omit<Partial<LoadoutSheet>, 'playedAt'> & { matchId: number; playedAt: string },
): LoadoutSheet => {
  const { playedAt, ...rest } = partial
  return {
    snapshotId: nextId++,
    capturedAt: new Date(playedAt),
    result: 'WIN',
    archetype: null,
    heightText: null,
    weightLbs: null,
    handedness: null,
    xFactors: [],
    attributes: {},
    ...rest,
    playedAt: new Date(playedAt),
  }
}
const xf = (...names: string[]) => names.map((name) => ({ name, tier: 'Elite' as const }))

void test('one sheet per match: latest captured wins, an empty later sheet never hides a full one', () => {
  const builds = groupBuilds([
    sheet({
      matchId: 1,
      playedAt: '2026-05-09T20:00:00Z',
      archetype: 'Sniper',
      xFactors: xf('A', 'B', 'C'),
      attributes: { speed: 80 },
    }),
    sheet({
      matchId: 1,
      playedAt: '2026-05-09T20:00:00Z',
      capturedAt: new Date('2026-05-10T00:00:00Z'),
      archetype: 'Sniper',
      xFactors: xf('A', 'B', 'C'),
      attributes: { speed: 85 },
    }),
    sheet({
      matchId: 1,
      playedAt: '2026-05-09T20:00:00Z',
      capturedAt: new Date('2026-05-11T00:00:00Z'),
    }),
  ])
  assert.equal(builds.length, 1)
  const b = builds[0]
  assert.ok(b)
  assert.equal(b.gp, 1)
  assert.equal(b.attributes.speed, 85)
})

void test('Stick Menace: a blank weight and an empty sheet do not split the build', () => {
  const pf = { archetype: 'Power Forward', xFactors: xf('Big_Rig', 'One_T', 'Ankle_Breaker') }
  const builds = groupBuilds([
    sheet({
      matchId: 9405,
      playedAt: '2026-05-09T20:00:00Z',
      ...pf,
      weightLbs: 220,
      attributes: { speed: 86, deking: null },
    }),
    sheet({ matchId: 9171, playedAt: '2026-05-12T20:00:00Z' }),
    sheet({
      matchId: 9252,
      playedAt: '2026-05-22T20:00:00Z',
      ...pf,
      attributes: { speed: 86, deking: null },
    }),
  ])
  assert.equal(builds.length, 1)
  const b = builds[0]
  assert.ok(b)
  assert.deepEqual(
    [b.archetype, b.gp, b.weightLbs, b.wins, b.losses, b.otl],
    ['Power Forward', 2, 220, 2, 0, 0],
  )
  assert.equal(b.attributes.deking, null)
  assert.equal(b.firstPlayed.toISOString(), '2026-05-09T20:00:00.000Z')
  assert.equal(b.lastPlayed.toISOString(), '2026-05-22T20:00:00.000Z')
})

void test('Henry: attribute noise never splits a build; newest values win; newest build first', () => {
  const pmd = {
    archetype: 'Puck Moving Defenseman',
    xFactors: xf('Warrior', 'Wheels', 'Quick_Release'),
  }
  const builds = groupBuilds([
    sheet({
      matchId: 1,
      playedAt: '2026-05-09T20:00:00Z',
      ...pmd,
      attributes: { faceoffs: 92, passing: 88 },
    }),
    sheet({
      matchId: 2,
      playedAt: '2026-05-12T20:00:00Z',
      ...pmd,
      heightText: `6'0"`,
      weightLbs: 160,
      attributes: { faceoffs: 26, passing: 91 },
    }),
    sheet({
      matchId: 3,
      playedAt: '2026-05-31T20:00:00Z',
      archetype: 'Sniper',
      xFactors: xf('Quick_Release', 'One_T', 'Tape_to_Tape'),
    }),
  ])
  assert.deepEqual(
    builds.map((b) => [b.archetype, b.gp]),
    [
      ['Sniper', 1],
      ['Puck Moving Defenseman', 2],
    ],
  )
  const pmdBuild = builds[1]
  assert.ok(pmdBuild)
  assert.deepEqual(pmdBuild.attributes, { faceoffs: 26, passing: 91 })
  assert.equal(pmdBuild.heightText, `6'0"`)
})

void test('the same X-factors in another slot order stay one build', () => {
  const builds = groupBuilds([
    sheet({
      matchId: 1,
      playedAt: '2026-05-09T20:00:00Z',
      archetype: 'Sniper',
      xFactors: xf('A', 'B', 'C'),
    }),
    sheet({
      matchId: 2,
      playedAt: '2026-05-10T20:00:00Z',
      archetype: 'Sniper',
      xFactors: xf('C', 'A', 'B'),
    }),
  ])
  assert.equal(builds.length, 1)
  assert.deepEqual(
    builds[0]?.xFactors.map((x) => x.name),
    ['C', 'A', 'B'],
  )
})

void test('a sheet missing archetype or X-factors joins the current build; a known build fills the gap', () => {
  const builds = groupBuilds([
    sheet({ matchId: 1, playedAt: '2026-05-09T20:00:00Z', xFactors: xf('A', 'B', 'C') }),
    sheet({
      matchId: 2,
      playedAt: '2026-05-10T20:00:00Z',
      archetype: 'Sniper',
      xFactors: xf('A', 'B', 'C'),
    }),
    sheet({ matchId: 3, playedAt: '2026-05-11T20:00:00Z', archetype: 'Sniper' }),
    sheet({ matchId: 4, playedAt: '2026-05-12T20:00:00Z', archetype: 'Playmaker' }),
  ])
  assert.deepEqual(
    builds.map((b) => [b.archetype, b.gp]),
    [
      ['Playmaker', 1],
      ['Sniper', 3],
    ],
  )
  assert.deepEqual(
    builds[1]?.xFactors.map((x) => x.name),
    ['A', 'B', 'C'],
  )
})

void test('a blank tier is filled from an older sheet of the same build', () => {
  const builds = groupBuilds([
    sheet({
      matchId: 1,
      playedAt: '2026-05-09T20:00:00Z',
      archetype: 'Sniper',
      xFactors: [
        { name: 'A', tier: 'All Star' },
        { name: 'B', tier: 'Specialist' },
      ],
    }),
    sheet({
      matchId: 2,
      playedAt: '2026-05-10T20:00:00Z',
      archetype: 'Sniper',
      xFactors: [
        { name: 'A', tier: null },
        { name: 'B', tier: 'Elite' },
      ],
    }),
  ])
  assert.deepEqual(builds[0]?.xFactors, [
    { name: 'A', tier: 'All Star' },
    { name: 'B', tier: 'Elite' },
  ])
})

void test('record: DNF counts as a loss', () => {
  const s = { archetype: 'Sniper' }
  const builds = groupBuilds([
    sheet({ matchId: 1, playedAt: '2026-05-01T20:00:00Z', ...s, result: 'WIN' }),
    sheet({ matchId: 2, playedAt: '2026-05-02T20:00:00Z', ...s, result: 'LOSS' }),
    sheet({ matchId: 3, playedAt: '2026-05-03T20:00:00Z', ...s, result: 'DNF' }),
    sheet({ matchId: 4, playedAt: '2026-05-04T20:00:00Z', ...s, result: 'OTL' }),
  ])
  assert.deepEqual(
    [builds[0]?.wins, builds[0]?.losses, builds[0]?.otl, builds[0]?.gp],
    [1, 2, 1, 4],
  )
})

void test('no sheets, no builds', () => {
  assert.deepEqual(groupBuilds([]), [])
})

void test('blank OCR strings are unknown: no fake builds, no empty X-factor boxes', () => {
  const full = xf('Big_Rig', 'Rocket', 'Wheels')
  const builds = groupBuilds([
    sheet({ matchId: 1, playedAt: '2026-05-01T20:00:00Z', archetype: 'Sniper', xFactors: full }),
    // Partly read set (one blank name) and a blank archetype: same build.
    sheet({
      matchId: 2,
      playedAt: '2026-05-02T20:00:00Z',
      archetype: ' ',
      heightText: '',
      xFactors: [
        { name: '', tier: null },
        { name: 'Rocket', tier: 'Elite' },
        { name: 'Wheels', tier: 'Elite' },
      ],
    }),
    // Garbage capture of match 2, captured later: must not beat the real one.
    sheet({
      matchId: 2,
      playedAt: '2026-05-02T20:00:00Z',
      capturedAt: new Date('2026-05-03T00:00:00Z'),
      archetype: '',
      xFactors: [
        { name: '', tier: null },
        { name: '', tier: null },
      ],
    }),
  ])
  assert.equal(builds.length, 1)
  const b = builds[0]
  assert.ok(b)
  assert.deepEqual([b.archetype, b.gp, b.heightText], ['Sniper', 2, null])
  assert.deepEqual(
    b.xFactors.map((x) => x.name),
    ['Big_Rig', 'Rocket', 'Wheels'],
  )
})

void test('pickTitleBuilds: newest title that has real builds; empty-only titles never win', () => {
  const pf = { archetype: 'Power Forward', xFactors: xf('A', 'B', 'C') }
  const picked = pickTitleBuilds([
    { ...sheet({ matchId: 1, playedAt: '2026-05-09T20:00:00Z', ...pf }), gameTitleId: 1 },
    // A newer title whose only sheet is an empty capture.
    { ...sheet({ matchId: 2, playedAt: '2026-10-01T20:00:00Z' }), gameTitleId: 7 },
  ])
  assert.ok(picked)
  assert.equal(picked.gameTitleId, 1)
  assert.equal(picked.builds.length, 1)
  assert.equal(
    pickTitleBuilds([
      { ...sheet({ matchId: 3, playedAt: '2026-10-01T20:00:00Z' }), gameTitleId: 7 },
    ]),
    null,
  )
  const both = pickTitleBuilds([
    { ...sheet({ matchId: 1, playedAt: '2026-05-09T20:00:00Z', ...pf }), gameTitleId: 1 },
    { ...sheet({ matchId: 4, playedAt: '2026-10-02T20:00:00Z', ...pf }), gameTitleId: 7 },
  ])
  assert.equal(both?.gameTitleId, 7)
})
