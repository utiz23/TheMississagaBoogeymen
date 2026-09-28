import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sumAdditive,
  weightedRatePassthroughOrRecompute,
  recomputeSavePct,
  passthroughGaa,
  compareNullsLastNumeric,
  identityOf,
  pairSkaterRoleGoalieGp,
  sumGoalieGpAcrossContributingModes,
} from './archive-club-member-aggregate.js'

void test('sumAdditive: all-null inputs => null', () => {
  assert.equal(sumAdditive([null, null]), null)
})

void test('sumAdditive: mixed null and recorded => null (no partial sums)', () => {
  assert.equal(sumAdditive([5, null, 3]), null)
})

void test('sumAdditive: explicit recorded zero is preserved', () => {
  assert.equal(sumAdditive([0, 0]), 0)
})

void test('sumAdditive: complete multi-row sum', () => {
  assert.equal(sumAdditive([5, 3, 2]), 10)
})

void test('sumAdditive: empty input => null', () => {
  assert.equal(sumAdditive([]), null)
})

void test('weightedRatePassthroughOrRecompute: single contributor passes stored rate through unchanged', () => {
  const result = weightedRatePassthroughOrRecompute([{ rate: '74.00', weight: 999 }])
  assert.equal(result, '74.00')
})

void test('weightedRatePassthroughOrRecompute: incomplete multi-row inputs => null', () => {
  const result = weightedRatePassthroughOrRecompute([
    { rate: '70.00', weight: 10 },
    { rate: null, weight: 5 },
  ])
  assert.equal(result, null)
})

void test('weightedRatePassthroughOrRecompute: complete multi-row recompute', () => {
  // (70*10 + 90*10) / 20 = 80.00
  const result = weightedRatePassthroughOrRecompute([
    { rate: '70.00', weight: 10 },
    { rate: '90.00', weight: 10 },
  ])
  assert.equal(result, '80.00')
})

void test('recomputeSavePct: zero contributors => null', () => {
  assert.equal(recomputeSavePct([]), null)
})

void test('recomputeSavePct: single contributor returns its stored savePct unchanged, never recomputed', () => {
  // saves/(saves+GA) here would compute to 76.53, not 76.50 — proving the
  // stored value passes through untouched rather than being recomputed from
  // a single sample.
  const result = recomputeSavePct([{ savePct: '76.50', saves: 587, goalsAgainst: 180 }])
  assert.equal(result, '76.50')
})

void test('recomputeSavePct: complete multi-mode counts recompute correctly', () => {
  const result = recomputeSavePct([
    { savePct: '90.00', saves: 90, goalsAgainst: 10 },
    { savePct: '90.00', saves: 45, goalsAgainst: 5 },
  ])
  assert.equal(result, '90.00')
})

void test('recomputeSavePct: incomplete multi-mode counts => null', () => {
  const result = recomputeSavePct([
    { savePct: '90.00', saves: 90, goalsAgainst: 10 },
    { savePct: null, saves: null, goalsAgainst: null },
  ])
  assert.equal(result, null)
})

void test('passthroughGaa: single contributor passes stored GAA through', () => {
  assert.equal(passthroughGaa([{ gaa: '3.93' }]), '3.93')
})

void test('passthroughGaa: multi-mode GAA is always null (never derived from GP as 60-minute games)', () => {
  assert.equal(passthroughGaa([{ gaa: '3.93' }, { gaa: '4.70' }]), null)
})

void test('passthroughGaa: empty input => null', () => {
  assert.equal(passthroughGaa([]), null)
})

void test('compareNullsLastNumeric: null sorts last ascending', () => {
  assert.equal(compareNullsLastNumeric(null, 5, 'asc') > 0, true)
  assert.equal(compareNullsLastNumeric(5, null, 'asc') < 0, true)
})

void test('compareNullsLastNumeric: null sorts last descending', () => {
  assert.equal(compareNullsLastNumeric(null, 5, 'desc') > 0, true)
  assert.equal(compareNullsLastNumeric(5, null, 'desc') < 0, true)
})

void test('compareNullsLastNumeric: both null => 0', () => {
  assert.equal(compareNullsLastNumeric(null, null, 'asc'), 0)
})

void test('compareNullsLastNumeric: recorded values compare normally', () => {
  assert.equal(compareNullsLastNumeric(1, 2, 'asc') < 0, true)
  assert.equal(compareNullsLastNumeric(1, 2, 'desc') > 0, true)
})

// ─── Goalie GP pairing (mirrors production shape: 11/11 paired) ────────────

void test('identityOf: matched player_id takes priority over gamertag', () => {
  assert.equal(identityOf(2, 'silkyjoker85'), 'p:2')
  assert.equal(identityOf(null, 'silkyjoker85'), 'g:silkyjoker85')
})

void test('identityOf: unmatched identity is case-insensitive on the gamertag snapshot', () => {
  assert.equal(identityOf(null, 'SilkyJoker85'), identityOf(null, 'silkyjoker85'))
})

void test('pairSkaterRoleGoalieGp: pairs a goalie row to its matched skater row by player_id', () => {
  const skaterRows = [{ playerId: 2, gamertagSnapshot: 'silkyjoker85', goalieGp: 48 }]
  const byIdentity = pairSkaterRoleGoalieGp(skaterRows)
  assert.equal(byIdentity.get(identityOf(2, 'silkyjoker85')), 48)
})

void test('pairSkaterRoleGoalieGp: pairs an unmatched goalie row by lowercased gamertag snapshot', () => {
  const skaterRows = [{ playerId: null, gamertagSnapshot: 'Stick Menace', goalieGp: 38 }]
  const byIdentity = pairSkaterRoleGoalieGp(skaterRows)
  assert.equal(byIdentity.get(identityOf(null, 'stick menace')), 38)
})

void test('pairSkaterRoleGoalieGp: a goalie identity with no paired skater row is simply absent (null when looked up)', () => {
  const byIdentity = pairSkaterRoleGoalieGp([
    { playerId: 2, gamertagSnapshot: 'silkyjoker85', goalieGp: 48 },
  ])
  assert.equal(byIdentity.get(identityOf(99, 'nobody')), undefined)
})

void test('pairSkaterRoleGoalieGp: never derives GP from GA/GAA — GP is exactly the paired stored value', () => {
  const skaterRows = [{ playerId: 5, gamertagSnapshot: 'JoeyFlopfish', goalieGp: 56 }]
  const byIdentity = pairSkaterRoleGoalieGp(skaterRows)
  // 56 is the stored skater-row goalie_gp; a GA/GAA-derived estimate for this
  // player would be ~49 (189 GA / 3.85 GAA * 60 / 60), a different number —
  // proving the pairing uses the stored value, not a derived one.
  assert.equal(byIdentity.get(identityOf(5, 'JoeyFlopfish')), 56)
})

// ─── Goalie GP across contributing modes (production: 6s-only today) ───────

void test("sumGoalieGpAcrossContributingModes: one contributing mode (6s), no 3s row at all => that mode's GP, not null", () => {
  const result = sumGoalieGpAcrossContributingModes(['6s'], new Map([['6s', 48]]))
  assert.equal(result, 48)
})

void test('sumGoalieGpAcrossContributingModes: two contributing modes sum', () => {
  const result = sumGoalieGpAcrossContributingModes(
    ['6s', '3s'],
    new Map([
      ['6s', 48],
      ['3s', 12],
    ]),
  )
  assert.equal(result, 60)
})

void test('sumGoalieGpAcrossContributingModes: a contributing mode with a missing paired GP makes the total null', () => {
  const result = sumGoalieGpAcrossContributingModes(
    ['6s', '3s'],
    new Map([
      ['6s', 48],
      ['3s', null],
    ]),
  )
  assert.equal(result, null)
})

void test('sumGoalieGpAcrossContributingModes: recorded zero GP remains zero', () => {
  const result = sumGoalieGpAcrossContributingModes(['6s'], new Map([['6s', 0]]))
  assert.equal(result, 0)
})

void test('sumGoalieGpAcrossContributingModes: a mode with no goalie row at all is absent, not a null contributor', () => {
  // Only 6s contributes (no 3s goalie row exists for this identity); the
  // pairedGpByMode map may still carry a 3s lookup miss, but since 3s isn't
  // in contributingModes it must not drag the total to null.
  const result = sumGoalieGpAcrossContributingModes(
    ['6s'],
    new Map([
      ['6s', 20],
      ['3s', null],
    ]),
  )
  assert.equal(result, 20)
})
