import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractGoaliePromotedStats,
  extractSkaterPromotedStats,
} from './import-historical-reviewed.js'
import {
  buildMetricColumns,
  snakeMetricsToCamel,
} from './import-club-member-reviewed.js'
import { buildColumns } from './import-club-team-reviewed.js'

void test('historical skater extraction promotes required and optional stats', () => {
  const result = extractSkaterPromotedStats({
    gp: '12',
    g: '5',
    a: '7',
    pts: '12',
    pm: '-3',
    pass_pct: '74.9%',
    blocked_shots: '8',
  })

  assert.equal(result.gamesPlayed, 12)
  assert.equal(result.goals, 5)
  assert.equal(result.assists, 7)
  assert.equal(result.points, 12)
  assert.equal(result.plusMinus, -3)
  assert.equal(result.passPct, '74.90')
  assert.equal(result.blockedShots, 8)
})

void test('historical goalie extraction leaves skater stats neutral and parses rates', () => {
  const result = extractGoaliePromotedStats({
    games_played: 4,
    wins: '3',
    losses: '1',
    save_pct: '91.2%',
    gaa: '2.45',
  })

  assert.equal(result.gamesPlayed, 4)
  assert.equal(result.goals, 0)
  assert.equal(result.wins, 3)
  assert.equal(result.losses, 1)
  assert.equal(result.savePct, '91.20')
  assert.equal(result.gaa, '2.45')
})

void test('club member metric parsing and camel mapping preserves nulls', () => {
  const parsed = buildMetricColumns({
    skater_gp: '9',
    goals: '4',
    pass_pct: '77.7%',
    save_pct: '',
  })
  const mapped = snakeMetricsToCamel(parsed)

  assert.equal(mapped.skaterGp, 9)
  assert.equal(mapped.goals, 4)
  assert.equal(mapped.passPct, '77.70')
  assert.equal(mapped.savePct, null)
})

void test('club team column builder maps known keys and rejects unknown keys', () => {
  const built = buildColumns({
    games_played: '89',
    avg_time_on_attack: '07:06',
    shooting_pct: '20.0',
  })

  assert.equal(built.gamesPlayed, 89)
  assert.equal(built.avgTimeOnAttack, '07:06')
  assert.equal(built.shootingPct, '20.00')

  assert.throws(
    () => buildColumns({ nonsense_metric: 1 }),
    /Unknown metric key: nonsense_metric/u,
  )
})
