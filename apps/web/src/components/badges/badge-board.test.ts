/**
 * Run (after `pnpm --filter @eanhl/db build`):
 *   node --test apps/web/src/components/badges/badge-board.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  badgeCaption,
  badgeVisual,
  buildBadgeBoard,
  defaultSelection,
  themeLabel,
} from './badge-board.ts'

void test('level → theme and frame step', () => {
  const v = (l: number) => {
    const x = badgeVisual(l)
    return `${x.theme} ${x.frame} ${String(x.step)}`
  }
  assert.equal(v(0), 'away single 1')
  assert.equal(v(1), 'away single 1')
  assert.equal(v(3), 'away heavy 3')
  assert.equal(v(4), 'home single 1')
  assert.equal(v(16), 'frozen single 1')
  assert.equal(v(30), 'olympus heavy 3')
})

void test('theme labels', () => {
  assert.equal(themeLabel(0), 'Locked')
  assert.equal(themeLabel(5), 'Home 2')
  assert.equal(themeLabel(17), 'Frozen 2')
})

void test('a player with no badge rows: 21 locked badges in 5 groups', () => {
  const b = buildBadgeBoard([])
  assert.equal(b.total, 21)
  assert.equal(b.unlocked, 0)
  assert.equal(b.levels, 0)
  assert.equal(b.maxLevels, 630)
  assert.deepEqual(
    b.groups.map((g) => [g.group.id, g.members.length, g.unlocked]),
    [
      ['games', 4, 0],
      ['scoring', 6, 0],
      ['physical', 2, 0],
      ['defense', 3, 0],
      ['goalie', 6, 0],
    ],
  )
  const goals = b.rows.find((r) => r.family.id === 'pgoals')
  assert.ok(goals)
  assert.equal(goals.locked, true)
  assert.equal(goals.themeLabel, 'Locked')
  assert.equal(goals.progressText, '0 / 5 goals')
  assert.equal(goals.remainingText, '5 to LVL 1')
  assert.equal(goals.shape, 'round')
})

void test('mid-ladder and maxed badges', () => {
  const b = buildBadgeBoard([
    { familyId: 'phits', value: 98 },
    { familyId: 'pgoals', value: 6000 },
  ])
  const hits = b.rows.find((r) => r.family.id === 'phits')
  const goals = b.rows.find((r) => r.family.id === 'pgoals')
  assert.ok(hits && goals)
  assert.equal(hits.progress.level, 6)
  assert.equal(hits.themeLabel, 'Home 3')
  assert.equal(hits.progressText, '98 / 110 hits')
  assert.equal(hits.remainingText, '12 to LVL 7')
  assert.equal(goals.progressText, 'Maxed · 6,000 goals')
  assert.equal(goals.remainingText, '')
  assert.equal(b.unlocked, 2)
  assert.equal(b.levels, 36)
  assert.equal(defaultSelection(b), 'pgoals')
})

void test('default selection falls back to the first badge when all are locked', () => {
  assert.equal(defaultSelection(buildBadgeBoard([])), 'p3v3')
})

void test('source text: club games vs EA totals', () => {
  const b = buildBadgeBoard([])
  const text = (id: string) => b.rows.find((r) => r.family.id === id)?.sourceText
  assert.equal(text('pgoals'), 'Counts club games only')
  assert.equal(text('gsv'), 'Counts club games only')
  for (const id of ['pdekes', 'pfight', 'pbrk'])
    assert.equal(text(id), 'EA season totals · includes drop-ins')
})

void test('card badge caption: short name and the badge level as a number', () => {
  assert.equal(badgeCaption('SHOTS', 10), 'SHOTS 10')
  assert.equal(badgeCaption('GOALS', 1), 'GOALS 1')
})
