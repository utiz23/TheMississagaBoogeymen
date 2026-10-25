import test from 'node:test'
import assert from 'node:assert/strict'
import type { NewsGameFacts, NewsPlayerLine } from '@eanhl/db/news'
import { applyChemistry, gameChemistry } from './chemistry.ts'
import type { PlayerGameInput } from './players.ts'

const TITLE = 7
const row = (
  matchId: number,
  result: PlayerGameInput['result'],
  over: Partial<PlayerGameInput> = {},
): PlayerGameInput => ({
  matchId,
  gameTitleId: TITLE,
  night: '2026-05-01',
  playedAt: `2026-05-01T00:00:${String(matchId).padStart(2, '0')}.000Z`,
  gameMode: '6s',
  result,
  goals: 0,
  assists: 0,
  shots: 0,
  hits: 0,
  position: 'F',
  endedEarly: false,
  ...over,
})
const l = (playerId: number, name: string) => ({ playerId, name }) as NewsPlayerLine
const results: PlayerGameInput['result'][] = ['WIN', 'WIN', 'LOSS', 'OTL', 'WIN', 'WIN', 'DNF']

void test('gameChemistry: named pairs of the game, title games together up to this one, 5+, most games first, top 3', () => {
  // Players 1 and 2 together in matches 1-7 (one DNF); this game is match 7... then 8 later.
  const shared = results.map((r, i) => row(i + 1, r))
  const history = new Map<number, PlayerGameInput[]>([
    [1, [...shared, row(8, 'WIN'), row(9, 'WIN')]],
    [2, [...shared, row(9, 'WIN')]],
    // Player 3: 4 games with 1 (too few), plus an earlier title's games.
    [
      3,
      [
        row(1, 'WIN'),
        row(2, 'WIN'),
        row(5, 'WIN'),
        row(8, 'WIN'),
        ...[20, 21, 22].map((m) => row(m, 'WIN', { gameTitleId: 6 })),
      ],
    ],
  ])
  const game = { matchId: 8, players: [l(2, 'Skater B'), l(1, 'Skater A'), l(3, 'Skater C')] }
  // Match 8: 1 and 2 have 6 counted games together (match 8 is not 2's).
  assert.deepEqual(gameChemistry(game, history, TITLE), [
    { pair: ['Skater A', 'Skater B'], games: 6, wins: 4, losses: 1, otl: 1 },
  ])
  // At match 9 the game counts too; later games never do.
  const at9 = gameChemistry({ matchId: 9, players: game.players }, history, TITLE)
  assert.deepEqual(at9, [{ pair: ['Skater A', 'Skater B'], games: 7, wins: 5, losses: 1, otl: 1 }])
  assert.deepEqual(gameChemistry({ matchId: 3, players: game.players }, history, TITLE), [])
  // A game with one named player: no pairs.
  assert.deepEqual(gameChemistry({ matchId: 9, players: [l(1, 'Skater A')] }, history, TITLE), [])
})

void test('gameChemistry: at most 3 pairs, most games first, then names', () => {
  const ids = [1, 2, 3, 4]
  const history = new Map<number, PlayerGameInput[]>(
    ids.map((id) => [
      id,
      Array.from({ length: 5 + id }, (_, i) => row(i + 1, i < 2 ? 'LOSS' : 'WIN')),
    ]),
  )
  const players = ids.map((id) => l(id, `P${String(id)}`))
  const out = gameChemistry({ matchId: 99, players }, history, TITLE)
  assert.equal(out.length, 3)
  assert.deepEqual(
    out.map((p) => [p.pair, p.games, p.wins]),
    [
      [['P3', 'P4'], 8, 6],
      [['P2', 'P3'], 7, 5],
      [['P2', 'P4'], 7, 5],
    ],
  )
  const games = applyChemistry(
    [{ matchId: 99, players } as unknown as NewsGameFacts],
    history,
    TITLE,
  )
  assert.equal(games[0]!.chemistry.length, 3)
})
