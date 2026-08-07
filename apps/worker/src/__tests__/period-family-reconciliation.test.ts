/**
 * Bounded, per-family period reconciliation (pure).
 *
 * THE DEFECT UNDER TEST
 * ---------------------
 * Coverage used to take its denominator from the OCR rows themselves
 * (`max(periodNumber)`), so a phantom P4 invented by frame segmentation both
 * created the expectation and satisfied it — a read could self-certify. The
 * denominator now comes from `periodsPlayed`, derived independently from EA
 * player TOI, and everything beyond it is excluded from coverage, from the
 * reconciliation sums, and from promotion.
 *
 * The second half is per-family authorization. `reconcilePeriods` graded goals
 * and returned ONE `promotable` flag; callers flipped whole rows with it,
 * publishing shots and faceoffs that nothing had graded. The verdict is now
 * explicitly per family: goals and faceoffs each have their own rule, and shots
 * have no automatic path at all.
 *
 * No DB — pure comparator + verdict only. Run standalone:
 *   pnpm --filter @eanhl/worker build
 *   node --test apps/worker/dist/__tests__/period-family-reconciliation.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeL4, reconcilePeriods, type L4Inputs } from '../lib/l4-api-truth.js'

/** EA truth for a 5-1 regulation game with 22 total faceoffs (13-9). */
const API = {
  scoreFor: 5,
  scoreAgainst: 1,
  shotsFor: 20,
  shotsAgainst: 10,
  faceoffsFor: 13,
  faceoffsAgainst: 9,
}

/** Full regulation: max skater TOI 3600 s ⇒ periodsPlayed 3. */
const REGULATION_TOI = 3600

function l4(overrides: Partial<L4Inputs>) {
  return computeL4({
    ocrTeam: null,
    apiTeam: API,
    ocrPlayers: [],
    apiPlayers: [],
    resolvePersona: async () => ({ playerId: null }),
    maxToiSeconds: REGULATION_TOI,
    ...overrides,
  })
}

/** A clean regulation read: goals sum to 5-1, faceoffs to 13-9, over P1..P3. */
const CLEAN_PERIODS = [
  { periodNumber: 1, goalsFor: 2, goalsAgainst: 1, faceoffsFor: 5, faceoffsAgainst: 3 },
  { periodNumber: 2, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: 3 },
  { periodNumber: 3, goalsFor: 2, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: 3 },
]

/** The phantom OT row frame segmentation invents: present, empty, never played. */
const PHANTOM_P4 = {
  periodNumber: 4,
  goalsFor: 0,
  goalsAgainst: 0,
  faceoffsFor: 0,
  faceoffsAgainst: 0,
}

function verdicts(r: Awaited<ReturnType<typeof computeL4>>, pass = true) {
  return reconcilePeriods({
    pass,
    periodsPlayed: r.periodsPlayed,
    periodCoverage: r.periodCoverage,
    periodAccuracy: r.periodAccuracy,
    periodSumVacuous: r.periodSumVacuous,
    periodZerosForced: r.periodZerosForced,
    scoringPeriodsBeyondBound: r.scoringPeriodsBeyondBound,
    faceoffCoverage: r.faceoffCoverage,
    faceoffAccuracy: r.faceoffAccuracy,
    faceoffPeriodsContested: r.faceoffPeriodsContested,
    faceoffTruthPresent: r.faceoffTruthPresent,
  })
}

// ── the corrected denominator ────────────────────────────────────────────────

void test('expected periods come from EA TOI, not from the OCR rows', async () => {
  const r = await l4({ ocrPeriods: [...CLEAN_PERIODS, PHANTOM_P4] })
  assert.equal(r.periodsPlayed, 3)
  assert.deepEqual(r.expectedPeriods, [1, 2, 3])
  assert.equal(r.periodCoverage, 1, 'P1-P3 are all read; P4 is not expected')
  assert.deepEqual(r.excludedPeriods, [4])
})

void test('a phantom P4 cannot raise coverage — it is not an expected period', async () => {
  // Only P1 and P2 were read of the three periods played, but the phantom P4 is
  // also present. Under the old OCR-derived denominator (max period 4) this read
  // scored 3/4; the honest number is 2/3.
  const r = await l4({ ocrPeriods: [CLEAN_PERIODS[0]!, CLEAN_PERIODS[1]!, PHANTOM_P4] })
  assert.equal(r.periodCoverage, 2 / 3)
  assert.equal(verdicts(r).families.goals.promotable, false)
})

void test('goals beyond the bound are excluded from the reconciliation sum', async () => {
  // P4 claims 3-3. Included, the sum would be 8-4 ≠ 5-1 and the match would
  // merely look misread; excluded, P1-P3 reconcile exactly and P4 is quarantined
  // as the contradiction it is.
  const r = await l4({
    ocrPeriods: [
      ...CLEAN_PERIODS,
      { periodNumber: 4, goalsFor: 3, goalsAgainst: 3, faceoffsFor: 0, faceoffsAgainst: 0 },
    ],
  })
  assert.equal(r.periodCoverage, 1)
  assert.equal(r.periodAccuracy, 1, 'the bounded sum is exact')
  assert.deepEqual(r.scoringPeriodsBeyondBound, [4])
})

void test('a scoring period beyond the TOI bound blocks goals promotion', async () => {
  const r = await l4({
    ocrPeriods: [
      ...CLEAN_PERIODS,
      { periodNumber: 4, goalsFor: 3, goalsAgainst: 3, faceoffsFor: 0, faceoffsAgainst: 0 },
    ],
  })
  const goals = verdicts(r).families.goals
  assert.equal(
    goals.promotable,
    false,
    'TOI says P4 never happened; a goal in it is a contradiction',
  )
  assert.match(goals.reason, /beyond/i)
})

void test('an unknown period bound fails closed', async () => {
  const r = await l4({ ocrPeriods: CLEAN_PERIODS, maxToiSeconds: null })
  assert.equal(r.periodsPlayed, null)
  assert.equal(r.expectedPeriods, null)
  assert.equal(r.periodCoverage, null, 'no trustworthy denominator ⇒ no coverage claim')
  assert.equal(r.periodAccuracy, null)
  const v = verdicts(r)
  assert.equal(v.families.goals.promotable, false)
  assert.equal(v.families.faceoffs.promotable, false)
  assert.match(v.families.goals.reason, /period bound/i)
})

void test('a missing expected period prevents promotion', async () => {
  const r = await l4({ ocrPeriods: [CLEAN_PERIODS[0]!, CLEAN_PERIODS[2]!] })
  assert.equal(r.periodCoverage, 2 / 3)
  assert.equal(r.periodAccuracy, null, 'incomplete coverage is not graded as a wrong sum')
  assert.equal(verdicts(r).families.goals.promotable, false)
})

void test('a half-read expected period prevents promotion', async () => {
  const r = await l4({
    ocrPeriods: [
      CLEAN_PERIODS[0]!,
      { periodNumber: 2, goalsFor: 1, goalsAgainst: null, faceoffsFor: 4, faceoffsAgainst: 3 },
      CLEAN_PERIODS[2]!,
    ],
  })
  assert.equal(r.periodCoverage, 2 / 3, 'one side unread is not a covered period')
  assert.equal(verdicts(r).families.goals.promotable, false)
})

void test('a legitimate 0-0 period is covered, not treated as unread', async () => {
  const r = await l4({
    apiTeam: { ...API, scoreFor: 3, scoreAgainst: 1 },
    ocrPeriods: [
      { periodNumber: 1, goalsFor: 2, goalsAgainst: 1, faceoffsFor: 5, faceoffsAgainst: 3 },
      { periodNumber: 2, goalsFor: 0, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: 3 },
      { periodNumber: 3, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: 3 },
    ],
  })
  assert.equal(r.periodCoverage, 1)
  assert.equal(r.periodAccuracy, 1)
  assert.equal(verdicts(r).families.goals.promotable, true)
})

// ── preserved: vacuous sums and early-ended games ────────────────────────────

void test('an early-ended game still promotes (972: one period played)', async () => {
  const r = await l4({
    apiTeam: { ...API, faceoffsFor: 5, faceoffsAgainst: 3 },
    maxToiSeconds: 1197,
    ocrPeriods: [
      { periodNumber: 1, goalsFor: 5, goalsAgainst: 1, faceoffsFor: 5, faceoffsAgainst: 3 },
      { periodNumber: 2, goalsFor: 0, goalsAgainst: 0, faceoffsFor: 0, faceoffsAgainst: 0 },
      { periodNumber: 3, goalsFor: 0, goalsAgainst: 0, faceoffsFor: 0, faceoffsAgainst: 0 },
    ],
  })
  assert.equal(r.periodsPlayed, 1)
  assert.deepEqual(r.expectedPeriods, [1])
  assert.equal(r.periodSumVacuous, true, 'the SHAPE is still vacuous — the field stays honest')
  assert.equal(r.periodZerosForced, true)
  assert.equal(verdicts(r).families.goals.promotable, true)
})

void test('a TOT-cell leak into P1 of a full game is still blocked', async () => {
  const r = await l4({
    ocrPeriods: [
      { periodNumber: 1, goalsFor: 5, goalsAgainst: 1, faceoffsFor: 5, faceoffsAgainst: 3 },
      { periodNumber: 2, goalsFor: 0, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: 3 },
      { periodNumber: 3, goalsFor: 0, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: 3 },
    ],
  })
  assert.equal(r.periodCoverage, 1)
  assert.equal(r.periodAccuracy, 1, 'the sum agrees — by construction, which is the trap')
  assert.equal(r.periodSumVacuous, true)
  assert.equal(r.periodZerosForced, false, 'P2/P3 were really played, so their 0-0 is a claim')
  assert.equal(verdicts(r).families.goals.promotable, false)
})

// ── faceoffs ─────────────────────────────────────────────────────────────────

void test('faceoffs promote when every expected period is read and totals match EA exactly', async () => {
  const r = await l4({ ocrPeriods: [...CLEAN_PERIODS, PHANTOM_P4] })
  assert.equal(r.faceoffCoverage, 1)
  assert.equal(r.faceoffAccuracy, 1)
  const fo = verdicts(r).families.faceoffs
  assert.equal(fo.promotable, true)
  assert.deepEqual(fo.authorizedPeriods, [1, 2, 3], 'the phantom P4 is never authorized')
})

void test('faceoff totals that miss EA truth by one are not promotable', async () => {
  const r = await l4({
    ocrPeriods: [
      { periodNumber: 1, goalsFor: 2, goalsAgainst: 1, faceoffsFor: 5, faceoffsAgainst: 3 },
      { periodNumber: 2, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: 3 },
      { periodNumber: 3, goalsFor: 2, goalsAgainst: 0, faceoffsFor: 3, faceoffsAgainst: 3 },
    ],
  })
  assert.equal(r.faceoffAccuracy, 0.5, 'for-side sums to 12, EA says 13; against matches')
  const v = verdicts(r)
  assert.equal(v.families.faceoffs.promotable, false)
  assert.equal(v.families.goals.promotable, true, 'goals are graded independently and do reconcile')
})

void test('a half-read faceoff pair prevents faceoff promotion but not goals', async () => {
  const r = await l4({
    ocrPeriods: [
      { periodNumber: 1, goalsFor: 2, goalsAgainst: 1, faceoffsFor: 5, faceoffsAgainst: 3 },
      { periodNumber: 2, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: null },
      { periodNumber: 3, goalsFor: 2, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: 3 },
    ],
  })
  assert.equal(r.faceoffCoverage, 2 / 3)
  assert.equal(r.faceoffAccuracy, null)
  const v = verdicts(r)
  assert.equal(v.families.faceoffs.promotable, false)
  assert.equal(v.families.goals.promotable, true)
})

void test('faceoffs beyond the bound do not contribute to the total', async () => {
  // P4's 9-9 would wreck the sum if counted; bounded, P1-P3 still reconcile.
  const r = await l4({
    ocrPeriods: [
      ...CLEAN_PERIODS,
      { periodNumber: 4, goalsFor: 0, goalsAgainst: 0, faceoffsFor: 9, faceoffsAgainst: 9 },
    ],
  })
  assert.equal(r.faceoffAccuracy, 1)
  assert.deepEqual(verdicts(r).families.faceoffs.authorizedPeriods, [1, 2, 3])
})

void test('absent EA faceoff truth (0-0) is not evidence — faceoffs stay quarantined', async () => {
  // getMatchFaceoffTotals COALESCEs missing player rows to 0, so 0-0 is
  // indistinguishable from "EA published no faceoff data". A 0-0 OCR read
  // agreeing with it proves nothing.
  const r = await l4({
    apiTeam: { ...API, faceoffsFor: 0, faceoffsAgainst: 0 },
    ocrPeriods: [
      { periodNumber: 1, goalsFor: 2, goalsAgainst: 1, faceoffsFor: 0, faceoffsAgainst: 0 },
      { periodNumber: 2, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 0, faceoffsAgainst: 0 },
      { periodNumber: 3, goalsFor: 2, goalsAgainst: 0, faceoffsFor: 0, faceoffsAgainst: 0 },
    ],
  })
  assert.equal(r.faceoffTruthPresent, false)
  assert.equal(verdicts(r).families.faceoffs.promotable, false)
})

void test('a played period with no faceoffs at all is impossible — fail closed', async () => {
  // Every period that starts has an opening centre-ice draw, so one side must
  // win at least one. An all-zero expected period is a misread (or a TOT cell
  // leaking into one row), never a real period.
  const r = await l4({
    ocrPeriods: [
      { periodNumber: 1, goalsFor: 2, goalsAgainst: 1, faceoffsFor: 13, faceoffsAgainst: 9 },
      { periodNumber: 2, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 0, faceoffsAgainst: 0 },
      { periodNumber: 3, goalsFor: 2, goalsAgainst: 0, faceoffsFor: 0, faceoffsAgainst: 0 },
    ],
  })
  assert.equal(r.faceoffCoverage, 1, 'both sides were read — coverage is satisfied')
  assert.equal(r.faceoffAccuracy, 1, '…and the sum matches, which is exactly the trap')
  assert.equal(r.faceoffPeriodsContested, false)
  const fo = verdicts(r).families.faceoffs
  assert.equal(fo.promotable, false)
  assert.match(fo.reason, /faceoff/i)
})

void test('no API truth at all ⇒ neither family is promotable', async () => {
  const r = await l4({ apiTeam: null, ocrPeriods: CLEAN_PERIODS })
  assert.equal(r.gradable, false)
  const v = verdicts(r)
  assert.equal(v.families.goals.promotable, false)
  assert.equal(v.families.faceoffs.promotable, false)
})

// ── shots ────────────────────────────────────────────────────────────────────

void test('shots never promote, however clean the read', async () => {
  const r = await l4({ ocrPeriods: CLEAN_PERIODS })
  const shots = verdicts(r).families.shots
  assert.equal(shots.promotable, false)
  assert.deepEqual(shots.authorizedPeriods, [])
  assert.match(shots.reason, /manual/i)
})

// ── the per-family boundary ──────────────────────────────────────────────────

void test('the legacy `promotable` flag is the GOALS verdict and nothing wider', async () => {
  const r = await l4({
    ocrPeriods: [
      { periodNumber: 1, goalsFor: 2, goalsAgainst: 1, faceoffsFor: 5, faceoffsAgainst: 3 },
      { periodNumber: 2, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: 3 },
      { periodNumber: 3, goalsFor: 2, goalsAgainst: 0, faceoffsFor: 1, faceoffsAgainst: 1 },
    ],
  })
  const v = verdicts(r)
  assert.equal(v.promotable, true)
  assert.equal(v.promotable, v.families.goals.promotable)
  assert.equal(v.families.faceoffs.promotable, false, 'faceoffs sum to 10-7, EA says 13-9')
  assert.equal(v.families.shots.promotable, false)
})

void test('every family verdict names its own family and authorizes only bounded periods', async () => {
  const r = await l4({ ocrPeriods: [...CLEAN_PERIODS, PHANTOM_P4] })
  const v = verdicts(r)
  for (const family of ['goals', 'shots', 'faceoffs'] as const) {
    const verdict = v.families[family]
    assert.equal(verdict.family, family)
    for (const p of verdict.authorizedPeriods) {
      assert.ok(p >= 1 && p <= 3, `${family} authorized out-of-bound period ${p}`)
    }
    if (!verdict.promotable) assert.deepEqual(verdict.authorizedPeriods, [])
  }
})

void test('no combination of inputs promotes a family without a known bound and exact reconciliation', () => {
  for (const periodsPlayed of [null, 0, 1, 3]) {
    for (const cov of [null, 0, 0.5, 1]) {
      for (const acc of [null, 0, 0.5, 1]) {
        for (const vacuous of [null, true, false]) {
          for (const forced of [null, true, false]) {
            for (const beyond of [[], [4]]) {
              for (const contested of [null, true, false]) {
                for (const truth of [true, false]) {
                  const v = reconcilePeriods({
                    pass: true,
                    periodsPlayed,
                    periodCoverage: cov,
                    periodAccuracy: acc,
                    periodSumVacuous: vacuous,
                    periodZerosForced: forced,
                    scoringPeriodsBeyondBound: beyond,
                    faceoffCoverage: cov,
                    faceoffAccuracy: acc,
                    faceoffPeriodsContested: contested,
                    faceoffTruthPresent: truth,
                  })
                  assert.equal(v.families.shots.promotable, false, 'shots are never promotable')
                  if (v.families.goals.promotable) {
                    assert.ok(
                      periodsPlayed !== null && periodsPlayed >= 1,
                      'goals promoted without a period bound',
                    )
                    assert.equal(cov, 1, 'goals promoted below full expected coverage')
                    assert.equal(acc, 1, 'goals promoted without an exact sum')
                    assert.deepEqual(beyond, [], 'goals promoted with scoring beyond the bound')
                    if (vacuous === true) assert.equal(forced, true)
                  }
                  if (v.families.faceoffs.promotable) {
                    assert.ok(
                      periodsPlayed !== null && periodsPlayed >= 1,
                      'faceoffs promoted without a period bound',
                    )
                    assert.equal(cov, 1, 'faceoffs promoted below full expected coverage')
                    assert.equal(acc, 1, 'faceoffs promoted without exact EA totals')
                    assert.equal(contested, true, 'faceoffs promoted with an uncontested period')
                    assert.equal(truth, true, 'faceoffs promoted with no EA faceoff truth')
                  }
                }
              }
            }
          }
        }
      }
    }
  }
})
