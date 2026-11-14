/**
 * Club Finals round rules (CF1): pure, no database. The rules are written first as tests:
 * 4 wins advance, 4 losses end the attempt, DNF and OTL are losses, round 4 is the final;
 * then the real 6v6 games of NHL 27 (2026-11-06 to 2026-11-13) are replayed and every panel read
 * the engine made (club-finals*.jsonl, 2026-11-12 and 2026-11-13) is compared with the derived
 * state.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bestAttempt,
  deriveClubFinals,
  FRESH_PANEL_VIEW,
  isClubFinalsGame,
  panelViewAfter,
  type FinalsGameInput,
  type FinalsResult,
} from '../club-finals.js'

/** Games one minute apart, from a string: W win, L loss, O OT loss, D DNF. */
function seq(letters: string, startId = 1): FinalsGameInput[] {
  const map: Record<string, FinalsResult> = { W: 'WIN', L: 'LOSS', O: 'OTL', D: 'DNF' }
  return [...letters].map((c, i) => ({
    matchId: startId + i,
    playedAt: new Date(Date.UTC(2026, 10, 7, 0, i)),
    result: map[c] as FinalsResult,
  }))
}

void test('4 wins win the round; the next game is round 2 game 1, attempt record carried', () => {
  const d = deriveClubFinals(seq('WWWWW'))
  const s = d.states
  assert.equal(s[3]?.roundWon, true)
  assert.equal(s[3]?.round, 1)
  assert.equal(s[3]?.gameInRound, 4)
  assert.equal(s[2]?.roundWon, false)
  assert.equal(s[4]?.round, 2)
  assert.equal(s[4]?.gameInRound, 1)
  assert.equal(s[4]?.roundWinsBefore, 0)
  assert.equal(s[4]?.attemptWinsAfter, 5)
  assert.equal(s[4]?.attempt, 1)
})

void test('3 losses do not end the round; the 4th loss ends the attempt (panel: round 1, 0-0, retry)', () => {
  const d = deriveClubFinals(seq('LLLWL'))
  assert.equal(d.states[2]?.eliminated, false)
  assert.equal(d.states[3]?.roundLossesAfter, 3)
  assert.equal(d.states[4]?.eliminated, true)
  assert.deepEqual(panelViewAfter(d.states[4]!), {
    round: 1,
    boxes: '',
    attemptWins: 0,
    attemptLosses: 0,
    retry: true,
  })
  const next = deriveClubFinals(seq('LLLLW')).states[4]
  assert.equal(next?.attempt, 2)
  assert.equal(next?.round, 1)
  assert.equal(next?.gameInRound, 1)
  assert.equal(next?.attemptWinsAfter, 1)
  assert.equal(next?.attemptLossesAfter, 0)
})

void test('losses count per round, not per attempt: 3 losses in round 1 then round 2 is not over', () => {
  // Round 1: L L L W W W W (4-3, won). Round 2: L L L (3 losses) is still alive.
  const d = deriveClubFinals(seq('LLLWWWWLLL'))
  assert.equal(d.states[6]?.roundWon, true)
  assert.equal(d.states[9]?.round, 2)
  assert.equal(d.states[9]?.roundLossesAfter, 3)
  assert.equal(d.states[9]?.eliminated, false)
  assert.equal(d.states[9]?.attemptLossesAfter, 6)
  assert.equal(d.attempts.length, 1)
})

void test('DNF and OT loss are losses', () => {
  const d = deriveClubFinals(seq('DOLD'))
  assert.deepEqual(
    d.states.map((s) => s.countedAs),
    ['loss', 'loss', 'loss', 'loss'],
  )
  assert.equal(d.states[3]?.eliminated, true)
  assert.equal(d.attempts[0]?.status, 'eliminated')
})

void test('round 4 is the final: 4 wins there end it as won; later games are unplaced, not guessed', () => {
  // 3 rounds of WWWW, then the final: W L W W W.
  const d = deriveClubFinals(seq('WWWW' + 'WWWW' + 'WWWW' + 'WLWWW' + 'WW'))
  const finalGames = d.states.filter((s) => s.isFinal)
  assert.equal(finalGames.length, 5)
  assert.equal(finalGames[4]?.finalWon, true)
  assert.equal(finalGames[4]?.roundWon, false)
  assert.equal(d.states[11]?.roundWon, true)
  assert.equal(d.states[11]?.isFinal, false)
  assert.equal(d.attempts[0]?.status, 'final_won')
  assert.equal(d.attempts[0]?.roundReached, 4)
  assert.deepEqual(d.unplacedMatchIds, [18, 19])
  assert.equal(d.states.length, 17)
})

void test('round 4: 4 losses eliminate the attempt in the final', () => {
  const d = deriveClubFinals(seq('WWWW' + 'WWWW' + 'WWWW' + 'WLLLL' + 'W'))
  const last = d.states[16]
  assert.equal(last?.isFinal, true)
  assert.equal(last?.eliminated, true)
  assert.equal(last?.gameInRound, 5)
  assert.equal(d.states[17]?.attempt, 2)
  assert.equal(d.attempts[0]?.roundReached, 4)
  assert.equal(d.attempts[0]?.wins, 13)
  assert.equal(d.attempts[0]?.losses, 4)
})

void test('input order does not matter: games are walked by played_at', () => {
  const sorted = deriveClubFinals(seq('WLLWWWW'))
  const shuffled = deriveClubFinals([...seq('WLLWWWW')].reverse())
  assert.deepEqual(shuffled.states, sorted.states)
  // Same time: the lower match id comes first.
  const t = new Date(Date.UTC(2026, 10, 7))
  const tie = deriveClubFinals([
    { matchId: 2, playedAt: t, result: 'LOSS' },
    { matchId: 1, playedAt: t, result: 'WIN' },
  ])
  assert.deepEqual(
    tie.states.map((s) => s.matchId),
    [1, 2],
  )
})

void test('best attempt: furthest round, then most wins, then fewest losses', () => {
  const d = deriveClubFinals(seq('LLLL' + 'WWWW' + 'LLLL' + 'LLLL'))
  assert.equal(d.attempts.length, 3)
  assert.equal(bestAttempt(d.attempts)?.attempt, 2)
  assert.equal(bestAttempt([]), null)
})

void test('3v3 (EA code 206, also in gameType10) and the regular season are not Club Finals games', () => {
  assert.equal(isClubFinalsGame({ matchType: 'gameType10', eaGameTypeCode: 10 }), true)
  assert.equal(isClubFinalsGame({ matchType: 'gameType10', eaGameTypeCode: 206 }), false)
  assert.equal(isClubFinalsGame({ matchType: 'gameType5', eaGameTypeCode: 200 }), false)
  assert.equal(isClubFinalsGame({ matchType: 'gameType5', eaGameTypeCode: 5 }), false)
  assert.equal(isClubFinalsGame({ matchType: 'gameType10', eaGameTypeCode: null }), false)
})

// ── Real games: NHL 27 club 1650, every 6v6 Club Finals game 2026-11-06 to 2026-11-13 (33). ──
// [match id, played_at UTC, result]. Read from the live database on 2026-11-14.
const REAL_GAMES: [number, string, FinalsResult][] = [
  [3405, '2026-11-07T03:08:28Z', 'WIN'],
  [3406, '2026-11-07T03:37:32Z', 'LOSS'],
  [3407, '2026-11-07T04:06:26Z', 'LOSS'],
  [3408, '2026-11-07T04:34:01Z', 'WIN'],
  [3409, '2026-11-08T02:47:11Z', 'WIN'],
  [3410, '2026-11-08T03:11:31Z', 'WIN'],
  [3411, '2026-11-08T03:26:54Z', 'DNF'],
  [3412, '2026-11-08T03:30:46Z', 'DNF'],
  [3413, '2026-11-08T03:58:49Z', 'WIN'],
  [3414, '2026-11-08T04:25:06Z', 'WIN'],
  [3415, '2026-11-08T04:47:37Z', 'LOSS'],
  [3416, '2026-11-08T05:09:55Z', 'WIN'],
  [3420, '2026-11-09T00:41:32Z', 'WIN'],
  [3421, '2026-11-09T01:06:57Z', 'WIN'],
  [3422, '2026-11-09T01:35:17Z', 'WIN'],
  [3423, '2026-11-09T02:00:24Z', 'WIN'],
  [3426, '2026-11-10T01:12:36Z', 'WIN'],
  [3427, '2026-11-10T01:38:19Z', 'WIN'],
  [3428, '2026-11-10T02:01:17Z', 'LOSS'],
  [3429, '2026-11-10T02:25:52Z', 'LOSS'],
  [3430, '2026-11-13T00:41:39Z', 'LOSS'],
  [3431, '2026-11-13T01:08:07Z', 'OTL'],
  [3432, '2026-11-13T01:40:17Z', 'LOSS'],
  [3433, '2026-11-14T00:53:12Z', 'LOSS'],
  [3434, '2026-11-14T01:26:20Z', 'LOSS'],
  [3435, '2026-11-14T01:45:32Z', 'DNF'],
  [3436, '2026-11-14T01:56:02Z', 'WIN'],
  [3437, '2026-11-14T02:17:31Z', 'WIN'],
  [3438, '2026-11-14T02:42:34Z', 'LOSS'],
  [3439, '2026-11-14T03:12:53Z', 'WIN'],
  [3440, '2026-11-14T03:40:54Z', 'WIN'],
  [3441, '2026-11-14T03:55:37Z', 'WIN'],
  [3442, '2026-11-14T04:18:59Z', 'LOSS'],
]

// Panel reads (engine repo, out/club-finals/club-finals-inbox-20261114.jsonl and club-finals.jsonl;
// the operator-example rows with no time are not used). Times are the machine clock, UTC-6.
const PANEL_READS = [
  { time: '2026-11-12T19:13:47-06:00', round: 1, boxes: '', wins: 0, losses: 0, retry: true },
  { time: '2026-11-12T21:07:10-06:00', round: 1, boxes: 'L', wins: 0, losses: 1, retry: false },
  { time: '2026-11-13T18:55:16-06:00', round: 1, boxes: 'LL', wins: 0, losses: 2, retry: false },
  { time: '2026-11-13T19:28:01-06:00', round: 1, boxes: 'LLL', wins: 0, losses: 3, retry: false },
  { time: '2026-11-13T19:46:10-06:00', round: 1, boxes: '', wins: 0, losses: 0, retry: true },
  { time: '2026-11-13T19:57:02-06:00', round: 1, boxes: 'W', wins: 1, losses: 0, retry: false },
  { time: '2026-11-13T20:20:39-06:00', round: 1, boxes: 'WW', wins: 2, losses: 0, retry: false },
  { time: '2026-11-13T20:45:01-06:00', round: 1, boxes: 'WWL', wins: 2, losses: 1, retry: false },
  { time: '2026-11-13T21:16:39-06:00', round: 1, boxes: 'WWLW', wins: 3, losses: 1, retry: false },
  { time: '2026-11-13T21:43:43-06:00', round: 2, boxes: '', wins: 4, losses: 1, retry: false },
  { time: '2026-11-13T21:56:37-06:00', round: 2, boxes: 'W', wins: 5, losses: 1, retry: false },
]

const real = deriveClubFinals(
  REAL_GAMES.map(([matchId, at, result]) => ({ matchId, playedAt: new Date(at), result })),
)
const byId = new Map(real.states.map((s) => [s.matchId, s]))

void test('replay: 33 games make 3 attempts (the 3rd still running); none unplaced', () => {
  assert.equal(real.states.length, 33)
  assert.deepEqual(real.unplacedMatchIds, [])
  assert.deepEqual(
    real.attempts.map((a) => [a.attempt, a.firstMatchId, a.lastMatchId, a.status]),
    [
      [1, 3405, 3431, 'eliminated'],
      [2, 3432, 3435, 'eliminated'],
      [3, 3436, 3442, 'active'],
    ],
  )
})

void test('replay: attempt 1 ends with game 5 of the final, the OT loss to 4scin (match 3431)', () => {
  const s3430 = byId.get(3430)
  const s3431 = byId.get(3431)
  assert.equal(s3430?.round, 4)
  assert.equal(s3430?.gameInRound, 4)
  assert.equal(s3430?.eliminated, false)
  assert.equal(s3431?.round, 4)
  assert.equal(s3431?.gameInRound, 5)
  assert.equal(s3431?.eliminated, true)
  assert.equal(s3431?.roundResults, 'WLLLL')
  // Round 1 won at 3410, round 2 at 3420, round 3 at 3426.
  assert.deepEqual(
    real.states.filter((s) => s.roundWon).map((s) => [s.matchId, s.round, s.gameInRound]),
    [
      [3410, 1, 6],
      [3420, 2, 7],
      [3426, 3, 4],
      [3440, 1, 5],
    ],
  )
})

void test('replay: after game 3427 the attempt stood at 13-5, the panel best (RP 22542)', () => {
  const s = byId.get(3427)
  assert.equal(s?.attemptWinsAfter, 13)
  assert.equal(s?.attemptLossesAfter, 5)
})

void test('replay: every panel read matches the derived state after the last game before it', () => {
  const sorted = [...real.states]
  const timeOf = new Map(REAL_GAMES.map(([id, at]) => [id, new Date(at).getTime()]))
  let compared = 0
  for (const read of PANEL_READS) {
    const at = new Date(read.time).getTime()
    let last: (typeof sorted)[number] | null = null
    for (const s of sorted) if ((timeOf.get(s.matchId) ?? Infinity) <= at) last = s
    const view = last === null ? FRESH_PANEL_VIEW : panelViewAfter(last)
    assert.deepEqual(
      {
        round: view.round,
        boxes: view.boxes,
        wins: view.attemptWins,
        losses: view.attemptLosses,
        retry: view.retry,
      },
      {
        round: read.round,
        boxes: read.boxes,
        wins: read.wins,
        losses: read.losses,
        retry: read.retry,
      },
      `panel read ${read.time} (after match ${String(last?.matchId)})`,
    )
    compared += 1
  }
  assert.equal(compared, PANEL_READS.length)
  assert.equal(compared, 11)
})
