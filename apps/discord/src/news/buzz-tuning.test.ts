import test from 'node:test'
import assert from 'node:assert/strict'
import { buzzDistribution, formatDistribution } from './buzz-tuning.ts'
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
