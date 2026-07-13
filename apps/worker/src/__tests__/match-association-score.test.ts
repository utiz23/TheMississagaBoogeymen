/**
 * Reel→match association fuzzy scorer (Milestone ② Task 2.2).
 *
 * Pure unit tests for `scoreCandidates` — no DB. Personas/roster arrive as
 * pre-normalized strings; the scorer stays synchronous and deterministic.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  scoreCandidates,
  ASSOCIATION_CONFIDENCE_THRESHOLD,
  type ProbeIdentity,
  type ApiCandidate,
} from '../lib/match-association-score.js'

const BASE = 1_716_000_000 // arbitrary evening epoch (seconds)

void test('scoreCandidates picks the date+score+opponent+roster match with high confidence and clear gap', () => {
  const probe: ProbeIdentity = {
    captureEpochS: BASE,
    scoreFor: 4,
    scoreAgainst: 2,
    opponentText: 'Rangers',
    personas: ['Silky', 'Zubov'],
  }
  const candidates: ApiCandidate[] = [
    // Winner: 2-min timestamp gap, exact score, exact opponent, 2/3 roster overlap.
    {
      matchId: 501,
      playedAtEpochS: BASE + 120,
      scoreFor: 4,
      scoreAgainst: 2,
      opponentName: 'Rangers',
      roster: ['Silky', 'Zubov', 'Magroyne'],
    },
    // Runner-up A: 6h off, wrong score, wrong opponent, no roster overlap.
    {
      matchId: 502,
      playedAtEpochS: BASE - 21_600,
      scoreFor: 1,
      scoreAgainst: 3,
      opponentName: 'Bruins',
      roster: ['Foo', 'Bar'],
    },
    // Runner-up B: close in time but wrong score/opponent, no roster overlap.
    {
      matchId: 503,
      playedAtEpochS: BASE - 1_800,
      scoreFor: 2,
      scoreAgainst: 4,
      opponentName: 'Islanders',
      roster: [],
    },
  ]

  const proposal = scoreCandidates(probe, candidates)
  assert.equal(proposal.matchId, 501)
  assert.ok(proposal.confidence > 0.8, `confidence ${proposal.confidence} should be > 0.8`)
  assert.ok(proposal.runnerUpGap > 0.2, `runnerUpGap ${proposal.runnerUpGap} should be > 0.2`)
  // Above threshold: the hint equals the thresholded winner.
  assert.equal(proposal.bestMatchId, 501)
  assert.equal(proposal.bestConfidence, proposal.confidence)
  // Per-signal breakdown is surfaced for the evidence jsonb + calibration.
  const { timestamp, score, opponent, roster } = proposal.signals
  assert.equal(score, 1)
  assert.equal(opponent, 1)
  assert.ok((timestamp ?? 0) > 0.99, `timestamp signal ${timestamp} should be > 0.99`)
  assert.ok((roster ?? 0) > 0 && (roster ?? 0) <= 1, `roster signal ${roster} should be in (0,1]`)
})

void test('scoreCandidates returns matchId=null when no candidate clears the threshold', () => {
  const probe: ProbeIdentity = {
    captureEpochS: BASE,
    scoreFor: 4,
    scoreAgainst: 2,
    opponentText: 'Rangers',
    personas: ['Silky', 'Zubov'],
  }
  const candidates: ApiCandidate[] = [
    // Argmax but still under threshold: only the timestamp fires (~1h off ⇒
    // ~0.95×0.35 ≈ 0.33), score/opponent/roster all wrong. Total ≈ 0.36 < 0.5.
    {
      matchId: 601,
      playedAtEpochS: BASE + 3600,
      scoreFor: 0,
      scoreAgainst: 5,
      opponentName: 'Sharks',
      roster: ['Aa', 'Bb'],
    },
    // Days away, wrong on every signal.
    {
      matchId: 602,
      playedAtEpochS: BASE + 300_000,
      scoreFor: 6,
      scoreAgainst: 1,
      opponentName: 'Flames',
      roster: [],
    },
  ]

  const proposal = scoreCandidates(probe, candidates)
  assert.equal(proposal.matchId, null)
  assert.ok(
    proposal.confidence < ASSOCIATION_CONFIDENCE_THRESHOLD,
    `confidence ${proposal.confidence} should be < ${ASSOCIATION_CONFIDENCE_THRESHOLD}`,
  )
  // Below threshold matchId nulls out, but the hint still names the argmax
  // candidate (601, dominated by its near-timestamp) for a manual confirm.
  assert.equal(proposal.bestMatchId, 601)
  assert.equal(proposal.bestConfidence, proposal.confidence)
  assert.ok(proposal.bestConfidence > 0.3, 'bestConfidence is the top candidate score, not zero')
})

void test('scoreCandidates handles an empty candidate list', () => {
  const probe: ProbeIdentity = {
    captureEpochS: BASE,
    scoreFor: 4,
    scoreAgainst: 2,
    opponentText: 'Rangers',
    personas: [],
  }
  const proposal = scoreCandidates(probe, [])
  assert.equal(proposal.matchId, null)
  assert.equal(proposal.confidence, 0)
  assert.equal(proposal.runnerUpGap, 0)
})
