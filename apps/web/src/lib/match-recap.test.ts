/**
 * Run: node --test apps/web/src/lib/match-recap.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildClassName,
  buildClassToArchetype,
  buildPossessionEdge,
  possessionEdgeWithShots,
  lineupsForMatch,
  starsForMatch,
} from './match-recap.ts'

void test('hyphenated build names stay whole; only a spaced " - " marks a reference player', () => {
  assert.equal(buildClassToArchetype('Two-Way Forward'), 'two-way-fwd')
  assert.equal(buildClassToArchetype('Two-Way Defenseman'), 'two-way-d')
  assert.equal(buildClassToArchetype('Cole Caufield - Sniper'), 'sniper')
  assert.equal(buildClassToArchetype('Connor Mcdavid - Playmaker'), 'playmaker')
  assert.equal(buildClassToArchetype('Puck Moving Defenseman'), 'puckmover')
  assert.equal(buildClassToArchetype('Unknown Build'), null)
  assert.equal(buildClassToArchetype(null), null)
})

void test('the sheet short-code form maps by its code: "Connor McDavid-PLY", "Quinn Hughes -PMD"', () => {
  assert.equal(buildClassToArchetype('Connor McDavid-PLY'), 'playmaker')
  assert.equal(buildClassToArchetype('TageThompson-PWF'), 'power-forward')
  assert.equal(buildClassToArchetype('Quinn Hughes -PMD'), 'puckmover')
  assert.equal(buildClassToArchetype('Quinn Hughes - PMD'), 'puckmover')
  assert.equal(buildClassToArchetype('Lady Liberty-GRN'), 'grinder')
  assert.equal(buildClassToArchetype('Grizzer-EFD'), 'enforcer-d')
  // Not an archetype code (goalie, unknown) or not a code at all.
  assert.equal(buildClassToArchetype('Connor Hellebuyck-BUT'), null)
  assert.equal(buildClassToArchetype('Wheels-DNG'), null)
  assert.equal(buildClassToArchetype('DUB-C_21'), null)
})

void test('OCR spacing slips and the enforcer builds still map', () => {
  assert.equal(buildClassToArchetype('Two-WayDefenseman'), 'two-way-d')
  assert.equal(buildClassToArchetype('Two-WayForward'), 'two-way-fwd')
  assert.equal(buildClassToArchetype('Enforcer'), 'enforcer')
  assert.equal(buildClassToArchetype('Enforcer Defenseman'), 'enforcer-d')
})

void test('buildClassName gives the plain build name for any recognised form', () => {
  assert.equal(buildClassName('Connor McDavid-PLY'), 'Playmaker')
  assert.equal(buildClassName('Two-WayDefenseman'), 'Two-Way Defenseman')
  assert.equal(buildClassName('Cole Caufield - Sniper'), 'Sniper')
  assert.equal(buildClassName('Wheels-DNG'), null)
  assert.equal(buildClassName(null), null)
})

const edgeMatch = {
  shotsFor: 10,
  shotsAgainst: 10,
  hitsFor: 5,
  hitsAgainst: 5,
  faceoffPct: null,
  timeOnAttack: null,
  timeOnAttackAgainst: null,
} as unknown as Parameters<typeof buildPossessionEdge>[0]

void test('possession edge: reviewed OCR shots count by the shots family, not the legacy row status', () => {
  const summary = {
    source: 'ocr',
    periodNumber: 1,
    reviewStatus: 'pending_review',
    shotsReviewStatus: 'reviewed',
    shotsFor: 15,
    shotsAgainst: 5,
  } as unknown as NonNullable<Parameters<typeof buildPossessionEdge>[1]>[number]
  const edge = buildPossessionEdge(edgeMatch, [summary])
  assert.deepEqual(edge?.inputs.shots, { us: 15, them: 5, source: 'ocr' })
})

void test('possession edge from pre-summed OCR shots matches the period-summary path', () => {
  const a = possessionEdgeWithShots(edgeMatch, { for: 15, against: 5 })
  assert.equal(a?.bgmRaw, 67.5)
  assert.deepEqual(possessionEdgeWithShots(edgeMatch, null)?.inputs.shots.source, 'ea')
})

void test('starsForMatch: no players, no stars', () => {
  assert.deepEqual(
    starsForMatch({ result: 'WIN', scoreFor: 1, scoreAgainst: 0 }, [], [], {
      bgm: [],
      opponent: [],
    }),
    [],
  )
})

void test('lineupsForMatch: no OCR rows ⇒ box-score lineup', () => {
  const r = lineupsForMatch({ playedAt: new Date(0), gameMode: '6s' }, [], [], {
    bgm: [],
    opponent: [],
  })
  assert.equal(r.variant, 'boxScore')
  assert.deepEqual(r.bgm, [])
})
