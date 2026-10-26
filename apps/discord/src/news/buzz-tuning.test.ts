import test from 'node:test'
import assert from 'node:assert/strict'
import { buzzDistribution, formatDistribution, gameLines } from './buzz-tuning.ts'
import { oct12Facts } from './test-fixtures.ts'

void test('buzz tuning: one count per match from the game sheets; night sheets ignored', () => {
  const game = oct12Facts('game')
  const d = buzzDistribution([game, game, oct12Facts('night')])
  assert.equal(d.games, 2)
  assert.equal(
    d.levels.quiet + d.levels.normal + d.levels.big + d.levels.huge + d.levels.historic,
    2,
  )
  assert.ok(d.postsPerGame >= 1)
  const lines = formatDistribution(d, 3)
  assert.match(lines[0]!, /buzz over 2 games \(3 job file\(s\) unreadable\)/)
  assert.ok(lines.some((l) => /quiet .* \(target 50%\)/.test(l)))
})

void test('buzz tuning: --games prints each asked match with its level, posts, score and reasons (no names)', () => {
  const game = oct12Facts('game')
  const lines = gameLines([game], [90001, 12345])
  assert.match(lines[0]!, /^ {2}g90001 6s 2-6 LOSS: quiet \(1 posts, 0 articles\), score /)
  assert.ok(!lines[0]!.includes('Skater'))
  assert.equal(lines[1], '  g12345: not found')
})
