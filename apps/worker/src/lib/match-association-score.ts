/**
 * Reel→match association fuzzy scorer (Milestone ② ASSOCIATE, Task 2.2).
 *
 * Pure + synchronous: given a reel's identity probe (score / opponent /
 * personas + a capture epoch) and the enumerated API-truth match candidates,
 * score every candidate on four weighted signals and return the best proposal.
 *
 * Personas and roster arrive PRE-NORMALIZED as plain strings (the async
 * persona resolution happens upstream in the query layer / CLI), so this
 * module has no DB dependency and only uses the pure `normalizeSnapshot` +
 * `levenshtein` helpers for fuzzy string comparison. Keeping it pure makes the
 * weights trivially unit-testable and cheap to re-run during calibration.
 *
 * Weights are the INITIAL values from the plan (spec §12) — expected to be
 * recalibrated against the first real batch. They sum to 1.0 so `confidence`
 * is bounded [0,1] and maps directly onto the numeric(5,4) DB column.
 */
import { normalizeSnapshot, levenshtein } from '../ocr-promoters/resolve-identity.js'

export interface ProbeIdentity {
  captureEpochS: number
  scoreFor: number
  scoreAgainst: number
  opponentText: string
  personas: string[]
}
export interface ApiCandidate {
  matchId: number
  playedAtEpochS: number
  scoreFor: number
  scoreAgainst: number
  opponentName: string
  roster: string[]
}
export interface Proposal {
  /** Winning candidate, or null when the best confidence is below threshold. */
  matchId: number | null
  /** Best weighted signal sum in [0,1]. */
  confidence: number
  /** best − second-best confidence (best − 0 when there is a single candidate). */
  runnerUpGap: number
  /** Winning candidate's raw per-signal values (0-1), for evidence + calibration. */
  signals: Record<string, number>
  /**
   * Argmax candidate id regardless of the confidence threshold — the
   * review-queue HINT. Equals `matchId` when the threshold is cleared; when it
   * is not, `matchId` is null but this still names which match ranked top so the
   * operator can confirm it manually. null only when there are no candidates.
   */
  bestMatchId: number | null
  /** Confidence of `bestMatchId` (identical to `confidence`; explicit for the hint). */
  bestConfidence: number
}

/** Below this confidence a proposal is `no_api_match` (matchId=null). */
export const ASSOCIATION_CONFIDENCE_THRESHOLD = 0.5

/** Initial signal weights (sum = 1.0). Recalibrated per spec §12 after batch 1. */
export const ASSOCIATION_WEIGHTS = {
  timestamp: 0.35,
  score: 0.3,
  opponent: 0.2,
  roster: 0.15,
} as const

/** σ for the timestamp-proximity Gaussian (≈3h). */
export const TIMESTAMP_SIGMA_S = 3 * 60 * 60

/** Levenshtein cutoff (on normalized strings) for a persona↔roster fuzzy hit. */
const ROSTER_FUZZY_DISTANCE = 2

function norm(s: string): string {
  return normalizeSnapshot(s).toLowerCase()
}

/** Gaussian proximity in [0,1]: 1.0 at zero gap, ~0.607 at 1σ, →0 far out. */
function timestampSignal(probeEpochS: number, candEpochS: number): number {
  const dt = Math.abs(probeEpochS - candEpochS)
  const z = dt / TIMESTAMP_SIGMA_S
  return Math.exp(-0.5 * z * z)
}

/**
 * Exact-score signal with half credit per side: 1.0 when both scoreFor and
 * scoreAgainst match exactly, 0.5 when exactly one side matches, else 0.
 * "Exact" per component — no fuzzy — but degrades gracefully on a single-goal
 * OCR miss rather than collapsing the whole signal.
 */
function scoreSignal(probe: ProbeIdentity, cand: ApiCandidate): number {
  const forMatch = probe.scoreFor === cand.scoreFor ? 1 : 0
  const againstMatch = probe.scoreAgainst === cand.scoreAgainst ? 1 : 0
  return (forMatch + againstMatch) / 2
}

/** 1 − normalized Levenshtein on the cleaned opponent strings; 0 if either empty. */
function opponentSignal(probeText: string, candName: string): number {
  const a = norm(probeText)
  const b = norm(candName)
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 0
  const dist = levenshtein(a, b, maxLen)
  return 1 - dist / maxLen
}

/**
 * Fuzzy Jaccard overlap of probe personas vs candidate roster. A persona is
 * "in" the roster when some roster entry is within ROSTER_FUZZY_DISTANCE
 * (normalized). Overlap = matched / (|P| + |R| − matched). 0 when either set
 * is empty (no evidence either way).
 */
function rosterSignal(personas: string[], roster: string[]): number {
  const P = dedupeNonEmpty(personas)
  const R = dedupeNonEmpty(roster)
  if (P.length === 0 || R.length === 0) return 0
  let matched = 0
  for (const p of P) {
    if (R.some((r) => levenshtein(p, r, ROSTER_FUZZY_DISTANCE) <= ROSTER_FUZZY_DISTANCE)) {
      matched++
    }
  }
  const union = P.length + R.length - matched
  return union === 0 ? 0 : matched / union
}

function dedupeNonEmpty(xs: string[]): string[] {
  const seen = new Set<string>()
  for (const x of xs) {
    const n = norm(x)
    if (n) seen.add(n)
  }
  return [...seen]
}

interface Scored {
  candidate: ApiCandidate
  confidence: number
  signals: Record<string, number>
}

function scoreOne(probe: ProbeIdentity, cand: ApiCandidate): Scored {
  const signals = {
    timestamp: timestampSignal(probe.captureEpochS, cand.playedAtEpochS),
    score: scoreSignal(probe, cand),
    opponent: opponentSignal(probe.opponentText, cand.opponentName),
    roster: rosterSignal(probe.personas, cand.roster),
  }
  const confidence =
    ASSOCIATION_WEIGHTS.timestamp * signals.timestamp +
    ASSOCIATION_WEIGHTS.score * signals.score +
    ASSOCIATION_WEIGHTS.opponent * signals.opponent +
    ASSOCIATION_WEIGHTS.roster * signals.roster
  return { candidate: cand, confidence, signals }
}

export function scoreCandidates(probe: ProbeIdentity, candidates: ApiCandidate[]): Proposal {
  if (candidates.length === 0) {
    return {
      matchId: null,
      confidence: 0,
      runnerUpGap: 0,
      signals: {},
      bestMatchId: null,
      bestConfidence: 0,
    }
  }
  // Deterministic order: confidence desc, then matchId asc as a stable tiebreak.
  const scored = candidates
    .map((c) => scoreOne(probe, c))
    .sort((a, b) => b.confidence - a.confidence || a.candidate.matchId - b.candidate.matchId)

  const best = scored[0]!
  const second = scored[1]
  const runnerUpGap = best.confidence - (second ? second.confidence : 0)
  return {
    matchId: best.confidence >= ASSOCIATION_CONFIDENCE_THRESHOLD ? best.candidate.matchId : null,
    confidence: best.confidence,
    runnerUpGap,
    signals: best.signals,
    // The argmax candidate is the hint even below threshold (matchId nulls out).
    bestMatchId: best.candidate.matchId,
    bestConfidence: best.confidence,
  }
}
