/**
 * Run: node --test apps/web/src/lib/match-recap.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBoxScore,
  buildClassName,
  buildClassToArchetype,
  buildPossessionEdge,
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

void test("possession edge: team shots are EA's; OCR shots no longer override them (2026-10-26)", () => {
  const edge = buildPossessionEdge(edgeMatch)
  assert.deepEqual(edge?.inputs.shots, { us: 10, them: 10 })
  assert.equal(edge?.bgmRaw, 50)
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

void test("box score: Shots are EA's even with reviewed OCR period rows (EA over OCR, 2026-10-26)", () => {
  const summary = {
    source: 'ocr',
    periodNumber: 1,
    shotsReviewStatus: 'reviewed',
    shotsFor: 29,
    shotsAgainst: 16,
  } as unknown as NonNullable<Parameters<typeof buildBoxScore>[3]>[number]
  const groups = buildBoxScore(
    { ...edgeMatch, scoreFor: 2, scoreAgainst: 1 } as unknown as Parameters<
      typeof buildBoxScore
    >[0],
    [],
    [],
    [summary],
  )
  const shots = groups.flatMap((g) => g.rows).find((r) => r.label === 'Shots')
  assert.deepEqual([shots?.us, shots?.them], ['10', '10'])
  assert.equal(groups.find((g) => g.title === 'Offense')?.footnote, undefined)
})

void test('buildBoxScore: Save % is saves / shots against in hockey style, not clamped to 1.000', () => {
  const skaterZeros = {
    assists: 0,
    shotAttempts: 0,
    deflections: 0,
    passAttempts: 0,
    passCompletions: 0,
    possession: 0,
    blockedShots: 0,
    takeaways: 0,
    giveaways: 0,
    interceptions: 0,
    shGoals: 0,
    faceoffWins: 0,
    faceoffLosses: 0,
  }
  type Args = Parameters<typeof buildBoxScore>
  const match = {
    scoreFor: 3,
    scoreAgainst: 2,
    shotsFor: 20,
    shotsAgainst: 24,
    hitsFor: 0,
    hitsAgainst: 0,
    ppGoals: null,
    ppOpportunities: null,
    ppGoalsAgainst: null,
    ppOpportunitiesAgainst: null,
    timeOnAttack: null,
    timeOnAttackAgainst: null,
    penaltyMinutes: 0,
    penaltyMinutesAgainst: 0,
  } as unknown as Args[0]
  const bgm = [
    { ...skaterZeros, saves: 22, goalsAgainst: 2, shotsAgainst: 24 },
  ] as unknown as Args[1]
  const opp = [
    { ...skaterZeros, saves: 17, goalsAgainst: 3, shotsAgainst: 20 },
  ] as unknown as Args[2]
  const goalie = buildBoxScore(match, bgm, opp).find((g) => g.title === 'Goalie')
  const savePct = goalie?.rows.find((r) => r.label === 'Save %')
  assert.deepEqual(savePct, { label: 'Save %', us: '.917', them: '.850' })
})
