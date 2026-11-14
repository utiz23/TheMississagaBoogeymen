import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clubFinalsBanner,
  clubFinalsContextLine,
  clubFinalsLabel,
  clubFinalsMatchIds,
  clubFinalsOutcome,
  clubFinalsReached,
  clubFinalsRecordLine,
  clubFinalsRoundHeader,
  clubFinalsRoundKey,
  clubFinalsRunAlive,
  clubFinalsShortLabel,
  clubFinalsSituation,
  finalsRoundGamesUpTo,
  parseFinalsRound,
  seriesPanelView,
  type FinalsBadgeLike,
  type FinalsRoundGame,
} from './club-finals-view.ts'

function badge(over: Partial<FinalsBadgeLike> = {}): FinalsBadgeLike {
  return {
    attempt: 4,
    round: 2,
    gameInRound: 3,
    roundWinsAfter: 2,
    roundLossesAfter: 1,
    attemptWinsAfter: 6,
    attemptLossesAfter: 2,
    isFinal: false,
    roundWon: false,
    eliminated: false,
    finalWon: false,
    ...over,
  }
}

describe('labels', () => {
  it('writes the long and the short label from stored values', () => {
    assert.equal(clubFinalsLabel(badge()), 'Club Finals · Round 2 · Game 3')
    assert.equal(clubFinalsShortLabel(badge({ round: 4, gameInRound: 5 })), 'R4 · G5')
    assert.equal(clubFinalsRoundHeader(badge()), 'Attempt 4 · Round 2')
    assert.equal(clubFinalsRoundHeader(badge({ round: 4, isFinal: true })), 'Attempt 4 · The Final')
    assert.equal(clubFinalsRoundKey(badge()), '4:2')
  })

  it('makes the final the strongest banner', () => {
    assert.deepEqual(clubFinalsBanner(badge()), {
      kicker: 'Club Finals',
      title: 'Round 2 · Game 3',
      final: false,
    })
    assert.deepEqual(clubFinalsBanner(badge({ round: 4, gameInRound: 5, isFinal: true })), {
      kicker: 'Club Finals',
      title: 'The Final · Game 5',
      final: true,
    })
  })
})

describe('outcome', () => {
  it('picks the strongest mark', () => {
    assert.equal(clubFinalsOutcome(badge()), null)
    assert.equal(clubFinalsOutcome(badge({ roundWon: true })), 'round_won')
    assert.equal(clubFinalsOutcome(badge({ eliminated: true })), 'eliminated')
    assert.equal(clubFinalsOutcome(badge({ roundWon: true, finalWon: true })), 'final_won')
  })
})

describe('series panel', () => {
  const games: FinalsRoundGame[] = [
    { matchId: 10, roundResults: 'W' },
    { matchId: 11, roundResults: 'WL' },
    { matchId: 12, roundResults: 'WLW' },
  ]

  it('draws 7 boxes with this game marked and empty boxes unknown', () => {
    const view = seriesPanelView(games, 12)
    assert.equal(view?.cells.length, 7)
    assert.deepEqual(
      view?.cells.map((c) => c.letter),
      ['W', 'L', 'W', null, null, null, null],
    )
    assert.deepEqual(
      view?.cells.map((c) => c.current),
      [false, false, true, false, false, false, false],
    )
    assert.deepEqual(
      view?.cells.map((c) => c.matchId),
      [10, 11, 12, null, null, null, null],
    )
  })

  it('returns null when the game is not in the list', () => {
    assert.equal(seriesPanelView(games, 99), null)
    assert.equal(seriesPanelView([], 10), null)
  })
})

describe('round games lookup', () => {
  const row = (matchId: number, round: number, results: string) => ({
    matchId,
    round,
    roundResults: results,
  })
  const attempts = [
    { attempt: 1, gameRows: [row(1, 1, 'W'), row(2, 1, 'WL'), row(3, 2, 'W')] },
    { attempt: 2, gameRows: [row(4, 1, 'L')] },
  ]
  it('returns the round up to and including the game', () => {
    assert.deepEqual(
      finalsRoundGamesUpTo(attempts, 1, 1, 2).map((g) => g.matchId),
      [1, 2],
    )
    assert.deepEqual(
      finalsRoundGamesUpTo(attempts, 1, 1, 1).map((g) => g.matchId),
      [1],
    )
    assert.deepEqual(
      finalsRoundGamesUpTo(attempts, 1, 2, 3).map((g) => g.matchId),
      [3],
    )
  })
  it('is empty for a game it cannot place', () => {
    assert.deepEqual(finalsRoundGamesUpTo(attempts, 1, 1, 4), [])
    assert.deepEqual(finalsRoundGamesUpTo(attempts, 9, 1, 1), [])
  })
})

describe('context line', () => {
  it('names the next game inside a round', () => {
    const line = clubFinalsContextLine(badge(), { round: 2, boxes: 'WLW', retry: false })
    assert.equal(line.kind, 'next')
    assert.equal(line.title, 'Next: Game 4')
    assert.equal(line.detail, 'Round 2, series 2–1')
  })

  it('says the round is won and what is next', () => {
    const line = clubFinalsContextLine(badge({ roundWon: true, roundWinsAfter: 4 }), {
      round: 3,
      boxes: '',
      retry: false,
    })
    assert.equal(line.title, 'Won the round')
    assert.equal(line.detail, 'Next: Round 3, Game 1')
    const toFinal = clubFinalsContextLine(badge({ round: 3, roundWon: true }), {
      round: 4,
      boxes: '',
      retry: false,
    })
    assert.equal(toFinal.detail, 'Next: The Final, Game 1')
  })

  it('says the run ends, with the stored run record', () => {
    const line = clubFinalsContextLine(
      badge({ eliminated: true, attemptWinsAfter: 13, attemptLossesAfter: 5 }),
      { round: 1, boxes: '', retry: true },
    )
    assert.equal(line.kind, 'eliminated')
    assert.equal(line.title, 'Eliminated, run ends 13–5')
    assert.equal(line.detail, 'Next: a new run starts at Round 1')
  })

  it('does not guess after a won final, or without a stored panel state', () => {
    const won = clubFinalsContextLine(
      badge({ finalWon: true, roundWon: true, isFinal: true }),
      null,
    )
    assert.equal(won.title, 'Won the final')
    const unknown = clubFinalsContextLine(badge(), null)
    assert.equal(unknown.title, 'Round goes on')
    const noNext = clubFinalsContextLine(badge({ roundWon: true }), null)
    assert.equal(noNext.detail, null)
  })
})

describe('playoff situation', () => {
  const g = (over: Partial<Parameters<typeof clubFinalsSituation>[1] & object> = {}) => ({
    roundWon: false,
    finalWon: false,
    eliminated: false,
    roundWinsAfter: 0,
    roundLossesAfter: 0,
    ...over,
  })

  it('is empty with no game, after the end of a run, or when nothing is special', () => {
    assert.equal(clubFinalsSituation(2, null), null)
    assert.equal(clubFinalsSituation(1, g({ eliminated: true })), null)
    assert.equal(clubFinalsSituation(4, g({ finalWon: true })), null)
    assert.equal(clubFinalsSituation(2, g({ roundWinsAfter: 2, roundLossesAfter: 2 })), null)
  })

  it('says one win from the next round, the final or the title', () => {
    assert.equal(
      clubFinalsSituation(1, g({ roundWinsAfter: 3 }))?.text,
      'One win from the next round',
    )
    assert.equal(clubFinalsSituation(3, g({ roundWinsAfter: 3 }))?.text, 'One win from the final')
    assert.equal(clubFinalsSituation(4, g({ roundWinsAfter: 3 }))?.text, 'One win from the title')
    assert.equal(clubFinalsSituation(4, g({ roundWinsAfter: 3 }))?.tone, 'chance')
  })

  it('warns at one loss from elimination, and at 3-3', () => {
    assert.deepEqual(clubFinalsSituation(2, g({ roundLossesAfter: 3 })), {
      tone: 'danger',
      text: 'One loss from elimination',
    })
    assert.equal(
      clubFinalsSituation(2, g({ roundWinsAfter: 3, roundLossesAfter: 3 }))?.text,
      'Win or go home',
    )
  })

  it('welcomes a round won', () => {
    assert.equal(clubFinalsSituation(3, g({ roundWon: true }))?.text, 'Round won. On to round 3')
    assert.equal(clubFinalsSituation(4, g({ roundWon: true }))?.text, 'Round won. On to the final')
  })
})

describe('record line', () => {
  const att = (over = {}) => ({
    attempt: 3,
    status: 'eliminated' as const,
    wins: 13,
    losses: 9,
    roundReached: 4,
    ...over,
  })

  it('is null when no attempt is derived', () => {
    assert.equal(clubFinalsRecordLine([], null, null), null)
  })

  it('shows the best attempt, and the current one only while it runs', () => {
    const quiet = clubFinalsRecordLine([att()], null, att())
    assert.deepEqual(quiet, { best: '13–9 · Reached the final', current: null })
    const running = att({
      attempt: 4,
      status: 'active' as const,
      wins: 2,
      losses: 1,
      roundReached: 1,
    })
    const alive = clubFinalsRecordLine(
      [att(), running],
      { round: 1, attemptWins: 2, attemptLosses: 1 },
      att(),
    )
    assert.equal(alive?.current, 'Attempt 4 · Round 1 · 2–1')
  })

  it('knows when a run is alive', () => {
    assert.equal(clubFinalsRunAlive([att(), att({ status: 'active' as const })], {}), true)
    assert.equal(clubFinalsRunAlive([att({ status: 'active' as const })], null), false)
    assert.equal(clubFinalsRunAlive([att({ status: 'active' as const }), att()], {}), false)
    assert.equal(clubFinalsRunAlive([att({ status: 'final_won' as const })], {}), false)
    assert.equal(clubFinalsRunAlive([], {}), false)
  })

  it('says unknown (null) for a best attempt it does not have', () => {
    assert.equal(clubFinalsRecordLine([att()], null, null)?.best, null)
  })

  it('words the furthest round', () => {
    assert.equal(clubFinalsReached(att({ roundReached: 2 })), 'Reached round 2')
    assert.equal(clubFinalsReached(att({ status: 'active', roundReached: 4 })), 'In the final')
    assert.equal(clubFinalsReached(att({ status: 'final_won' })), 'Won the final')
  })
})

describe('filter helpers', () => {
  const attempts = [
    {
      gameRows: [
        { matchId: 1, round: 1 },
        { matchId: 2, round: 2 },
      ],
    },
    { gameRows: [{ matchId: 3, round: 2 }] },
  ]
  it('lists the match ids of all rounds or one round', () => {
    assert.deepEqual(clubFinalsMatchIds(attempts, null), [1, 2, 3])
    assert.deepEqual(clubFinalsMatchIds(attempts, 2), [2, 3])
    assert.deepEqual(clubFinalsMatchIds(attempts, 4), [])
    assert.deepEqual(clubFinalsMatchIds([], null), [])
  })
  it('parses the round query', () => {
    assert.equal(parseFinalsRound('3'), 3)
    assert.equal(parseFinalsRound('0'), null)
    assert.equal(parseFinalsRound('5'), null)
    assert.equal(parseFinalsRound('x'), null)
    assert.equal(parseFinalsRound(undefined), null)
    assert.equal(parseFinalsRound(['2']), null)
  })
})
