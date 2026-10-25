import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNewsFactsResponse, type NewsGameFacts } from '@eanhl/db/news'
import { classifyGame, classifyNight } from './situation.ts'
import { oct12Facts, oct12Response } from './test-fixtures.ts'

function game(over: Partial<NewsGameFacts> & { shots?: [number, number] }): NewsGameFacts {
  const base = oct12Facts().games[0]!
  const { shots, ...rest } = over
  return {
    ...base,
    ...rest,
    team: {
      ...base.team,
      shotsFor: shots?.[0] ?? 20,
      shotsAgainst: shots?.[1] ?? 20,
    },
  }
}

void test('the fixture satisfies the real contract parser', () => {
  assert.doesNotThrow(() => parseNewsFactsResponse(JSON.parse(JSON.stringify(oct12Response()))))
})

void test('classifyGame', () => {
  const cases: [Partial<NewsGameFacts> & { shots?: [number, number] }, string][] = [
    [{ result: 'WIN', overtime: true, scoreFor: 3, scoreAgainst: 2 }, 'ot_win'],
    [{ result: 'LOSS', overtime: false, scoreFor: 2, scoreAgainst: 6 }, 'blowout_loss'],
    [{ result: 'WIN', scoreFor: 1, scoreAgainst: 0, shots: [12, 30] }, 'goalie_steal'],
    [{ result: 'WIN', scoreFor: 2, scoreAgainst: 1, shots: [20, 18] }, 'quiet_win'],
    [{ result: 'WIN', scoreFor: 4, scoreAgainst: 2 }, 'routine_win'],
    [{ result: 'LOSS', scoreFor: 2, scoreAgainst: 3 }, 'loss'],
    [{ result: 'OTL', overtime: true, scoreFor: 2, scoreAgainst: 3 }, 'ot_loss'],
    [{ result: 'LOSS', overtime: true, scoreFor: 2, scoreAgainst: 3 }, 'ot_loss'],
    [{ result: 'LOSS', scoreFor: 2, scoreAgainst: 5 }, 'blowout_loss'],
    [{ result: 'WIN', scoreFor: 3, scoreAgainst: 0, shots: [20, 30] }, 'goalie_steal'],
    [{ result: 'WIN', scoreFor: 3, scoreAgainst: 0, shots: [20, 29] }, 'quiet_win'],
  ]
  for (const [over, want] of cases) {
    assert.equal(classifyGame(game(over)), want, JSON.stringify(over))
  }
})

void test('classifyNight', () => {
  const f = oct12Facts('night')
  assert.equal(classifyNight(f), 'winless')
  assert.equal(classifyNight({ ...f, games: [f.games[0]!] }), 'single')
  const g = f.games[0]!
  const three = [g, g, g]
  const night = (wins: number, losses: number, otl: number) =>
    classifyNight({ ...f, games: three, nightTotals: { ...f.nightTotals, wins, losses, otl } })
  assert.equal(night(3, 0, 0), 'sweep')
  assert.equal(night(2, 1, 0), 'winning')
  assert.equal(night(1, 1, 1), 'losing')
  assert.equal(night(1, 0, 1), 'even')
  assert.equal(night(0, 2, 1), 'winless')
})
