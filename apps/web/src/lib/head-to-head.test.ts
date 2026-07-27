/**
 * Unit tests for the head-to-head compare logic feeding the lineup drawers.
 * Pure functions, no React/DOM.
 *
 * Tested hardest: glyph discipline (`—` = no attempts / not captured vs `0`
 * = genuine zero) and the boost/nerf bar geometry lifted from the donor
 * expand panel.
 *
 * Run: node --test apps/web/src/lib/head-to-head.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_LABELS,
  attributeBarGeometry,
  buildAttributeCompare,
  buildStatCategories,
  buildStatSummary,
  formatClock,
  formatHand,
  formatPct,
  formatShotOnNetPct,
  splitBuild,
  type HeadToHeadStatLine,
} from './head-to-head.ts'

function statLine(overrides: Partial<HeadToHeadStatLine> = {}): HeadToHeadStatLine {
  return {
    goals: 0,
    assists: 0,
    plusMinus: 0,
    shots: 0,
    hits: 0,
    pim: 0,
    takeaways: 0,
    giveaways: 0,
    faceoffWins: 0,
    faceoffLosses: 0,
    passAttempts: 0,
    passCompletions: 0,
    toiSeconds: null,
    shotAttempts: 0,
    blockedShots: 0,
    interceptions: 0,
    penaltiesDrawn: 0,
    possession: 0,
    deflections: 0,
    saucerPasses: 0,
    ppGoals: 0,
    shGoals: 0,
    playerDnf: false,
    ...overrides,
  }
}

void test('attribute taxonomy: every group key has a label', () => {
  for (const g of ATTRIBUTE_GROUPS) {
    for (const key of g.keys) {
      assert.ok(ATTRIBUTE_LABELS[key], `missing label for ${key}`)
    }
  }
})

void test('bar geometry: plain value has base only', () => {
  assert.deepEqual(attributeBarGeometry({ value: 88, delta: null }), {
    baseWidth: 88,
    boostWidth: 0,
    nerfStart: 0,
    nerfWidth: 0,
  })
})

void test('bar geometry: +3 boost on 95 fills 0..92 base then 92..95 boost', () => {
  assert.deepEqual(attributeBarGeometry({ value: 95, delta: 3 }), {
    baseWidth: 92,
    boostWidth: 3,
    nerfStart: 0,
    nerfWidth: 0,
  })
})

void test('bar geometry: -4 nerf on 80 marks 80..84 as lost ground', () => {
  assert.deepEqual(attributeBarGeometry({ value: 80, delta: -4 }), {
    baseWidth: 80,
    boostWidth: 0,
    nerfStart: 80,
    nerfWidth: 4,
  })
})

void test('bar geometry: null value renders an empty rail', () => {
  assert.deepEqual(attributeBarGeometry(null), {
    baseWidth: 0,
    boostWidth: 0,
    nerfStart: 0,
    nerfWidth: 0,
  })
})

void test('bar geometry: nerf overlay clamps at 100', () => {
  const g = attributeBarGeometry({ value: 99, delta: -5 })
  assert.equal(g.nerfStart, 99)
  assert.equal(g.nerfWidth, 1)
})

void test('formatHand normalizes R/L and passes unknowns through', () => {
  assert.equal(formatHand('R'), 'Right')
  assert.equal(formatHand('left'), 'Left')
  assert.equal(formatHand(null), '—')
  assert.equal(formatHand('ambi'), 'ambi')
})

void test('splitBuild: reference-player builds split, plain builds pass through', () => {
  assert.deepEqual(
    splitBuild({ buildClassCanonical: 'Cole Caufield - Sniper', buildClass: null }),
    { build: 'Sniper', ref: 'C. Caufield' },
  )
  assert.deepEqual(splitBuild({ buildClassCanonical: null, buildClass: 'Sniper' }), {
    build: 'Sniper',
    ref: null,
  })
  assert.deepEqual(splitBuild({ buildClassCanonical: null, buildClass: null }), {
    build: 'Unknown build',
    ref: null,
  })
})

void test('formatClock: null is —, seconds render m:ss', () => {
  assert.equal(formatClock(null), '—')
  assert.equal(formatClock(0), '0:00')
  assert.equal(formatClock(193), '3:13')
  assert.equal(formatClock(3600), '60:00')
})

void test('formatPct: zero denominator is — (never 0.0%)', () => {
  assert.equal(formatPct(0, 0), '—')
  assert.equal(formatPct(3, 7), '42.9%')
  assert.equal(formatPct(0, 4), '0.0%')
})

void test('shot-on-net rate: EA attempts < shots (match 250 quirk) renders —', () => {
  assert.equal(formatShotOnNetPct(7, 6), '—')
  assert.equal(formatShotOnNetPct(8, 9), '88.9%')
  assert.equal(formatShotOnNetPct(0, 0), '—')
  const tiles = buildStatSummary(statLine({ shots: 7, shotAttempts: 6 }))
  assert.equal(tiles.find((t) => t.label === 'Shot on Net')?.value, '—')
  const cats = buildStatCategories(statLine({ shots: 7, shotAttempts: 6 }), null)
  const shooting = cats.find((c) => c.title === 'Shooting')
  assert.ok(shooting)
  assert.equal(shooting.rows.find((r) => r.label === 'Shot on Net %')?.bgm, '—')
  // The raw counts stay visible — only the impossible rate is suppressed.
  assert.equal(shooting.rows.find((r) => r.label === 'Shots / Att')?.bgm, '7/6')
})

void test('summary strip: no stat row gives 5 muted — tiles and no SCORE tile', () => {
  const tiles = buildStatSummary(null)
  assert.equal(tiles.length, 5)
  assert.ok(tiles.every((t) => t.value === '—' && t.muted))
  assert.ok(!tiles.some((t) => t.label.toLowerCase().includes('score')))
})

void test('summary strip: winger with no faceoffs shows FO % as —, real rates elsewhere', () => {
  const tiles = buildStatSummary(
    statLine({ goals: 1, shots: 4, shotAttempts: 6, passCompletions: 11, passAttempts: 14 }),
  )
  const byLabel = new Map(tiles.map((t) => [t.label, t]))
  assert.equal(byLabel.get('Shot on Net')?.value, '66.7%')
  assert.equal(byLabel.get('Shooting %')?.value, '25.0%')
  assert.equal(byLabel.get('Pass %')?.value, '78.6%')
  assert.equal(byLabel.get('FO %')?.value, '—')
  assert.equal(byLabel.get('FO %')?.muted, true)
  assert.equal(byLabel.get('Possession')?.value, '0:00')
})

void test('categories: both sides populated, counting zeros stay 0, no-attempt rates are —', () => {
  const bgm = statLine({
    goals: 2,
    shots: 5,
    shotAttempts: 8,
    hits: 3,
    faceoffWins: 9,
    faceoffLosses: 4,
    possession: 150,
    toiSeconds: 3600,
    plusMinus: 2,
  })
  const opp = statLine({ shots: 0, shotAttempts: 0, plusMinus: -1, toiSeconds: 3600 })
  const cats = buildStatCategories(bgm, opp)
  assert.equal(cats.length, 8)

  const row = (title: string, label: string) => {
    const cat = cats.find((c) => c.title === title)
    assert.ok(cat, `missing category ${title}`)
    const r = cat.rows.find((r) => r.label === label)
    assert.ok(r, `missing row ${label} in ${title}`)
    return r
  }

  assert.deepEqual(row('Shooting', 'Shots / Att'), { label: 'Shots / Att', bgm: '5/8', opp: '—' })
  assert.equal(row('Shooting', 'Shooting %').bgm, '40.0%')
  assert.equal(row('Shooting', 'Shooting %').opp, '—')
  // Genuine zero stays 0 (deflections were counted, none happened).
  assert.equal(row('Shooting', 'Deflections').opp, '0')
  assert.deepEqual(row('Faceoffs', 'FO W–L'), { label: 'FO W–L', bgm: '9–4', opp: '—' })
  assert.equal(row('Faceoffs', 'FO %').bgm, '69.2%')
  assert.equal(row('Passing & Poss', 'Possession').bgm, '2:30')
  assert.equal(row('Workload', 'TOI').bgm, '60:00')
  assert.equal(row('Workload', '+/−').bgm, '+2')
  assert.equal(row('Workload', '+/−').opp, '-1')
})

void test('categories: a missing side renders — down its whole column', () => {
  const cats = buildStatCategories(statLine({ hits: 1 }), null)
  for (const cat of cats) {
    for (const r of cat.rows) {
      assert.equal(r.opp, '—')
    }
  }
})

void test('attribute compare: zips both sides and nulls missing ones', () => {
  const groups = buildAttributeCompare({ speed: { value: 90, delta: 2 } }, null)
  assert.equal(groups.length, 5)
  const technique = groups[0]
  assert.ok(technique)
  const speed = technique.rows.find((r) => r.key === 'speed')
  assert.ok(speed)
  assert.deepEqual(speed.bgm, { value: 90, delta: 2 })
  assert.equal(speed.opp, null)
  assert.equal(speed.label, 'Speed')
})
