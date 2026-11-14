import test from 'node:test'
import assert from 'node:assert/strict'
import type { PlayerGameInput } from '../../../lib/news/players.ts'
import { buildDossierForm } from './dossier-form.ts'

const NOW = new Date('2026-11-14T12:00:00Z')

function game(i: number, over: Partial<PlayerGameInput> = {}): PlayerGameInput {
  return {
    matchId: i,
    gameTitleId: 3,
    night: `2026-11-${String(1 + (i % 13)).padStart(2, '0')}`,
    playedAt: new Date(NOW.getTime() - (100 - i) * 3_600_000).toISOString(),
    gameMode: '6s',
    result: 'WIN',
    goals: 0,
    assists: 0,
    shots: 0,
    hits: 0,
    position: 'F',
    endedEarly: false,
    ...over,
  }
}

void test('totals are for the title of the newest game; recent games are newest first', () => {
  const games = [
    game(1, { gameTitleId: 2, goals: 40 }),
    ...Array.from({ length: 48 }, (_, i) => game(10 + i, { goals: 1, assists: 2 })),
    game(60, { goals: 0, assists: 0, result: 'LOSS' }),
  ]
  const f = buildDossierForm(5, 'Skater A', games, NOW)!
  assert.equal(f.titleId, 3)
  assert.equal(f.games, 49)
  assert.equal(f.goals, 48)
  assert.equal(f.assists, 96)
  assert.equal(f.points, 144)
  assert.equal(f.recent.length, 5)
  assert.equal(f.recent[0]!.result, 'LOSS')
})

void test('milestones: nearest first, in reach flagged; the 50 goals one reads "2 goals from 50"', () => {
  const games = Array.from({ length: 48 }, (_, i) => game(i, { goals: 1 }))
  const f = buildDossierForm(5, 'Silky', games, NOW)!
  const goals = f.next.find((m) => m.stat === 'goals')!
  assert.equal(goals.value, 50)
  assert.equal(goals.remaining, 2)
  assert.equal(goals.inReach, true)
  assert.equal(goals.text, '2 goals from 50')
  assert.equal(f.next[0]!.remaining <= f.next.at(-1)!.remaining, true)
})

void test('a goalie gets games only; no games is no form', () => {
  const g = Array.from({ length: 97 }, (_, i) => game(i, { position: 'G' }))
  const f = buildDossierForm(6, 'Goalie G', g, NOW)!
  assert.deepEqual(
    f.next.map((m) => m.stat),
    ['games'],
  )
  assert.equal(f.next[0]!.text, '3 games from 100')
  assert.equal(buildDossierForm(6, 'X', [], NOW), null)
})

void test("a points streak shows as a hot trend with the overview's words", () => {
  const games = [
    ...Array.from({ length: 20 }, (_, i) => game(i)),
    ...Array.from({ length: 8 }, (_, i) => game(20 + i, { goals: 1 })),
  ]
  const f = buildDossierForm(5, 'Skater A', games, NOW)!
  assert.equal(f.trend?.direction, 'hot')
  assert.match(f.trend!.text, /points in 8 straight/)
})
