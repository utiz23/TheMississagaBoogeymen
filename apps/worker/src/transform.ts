/**
 * Transform raw EA match payload into structured data ready for DB insertion.
 *
 * Field names and formats have been validated against real fixture captures.
 * Remaining DEFERRED items are noted inline and require an OTL match fixture.
 *
 * This function must remain pure (no DB access). All DB writes happen in ingest.ts.
 */

import type { EaMatch, EaPlayerMatchStats, EaMatchType } from '@eanhl/ea-client'
import type { NewMatch, NewPlayer, NewPlayerMatchStats } from '@eanhl/db'
import { deriveGameMode } from '@eanhl/db'

// ─── Public types ─────────────────────────────────────────────────────────────

export type PlayerIdentity = Pick<NewPlayer, 'eaId' | 'gamertag' | 'position'>
export type StatsPayload = Omit<NewPlayerMatchStats, 'id' | 'playerId' | 'matchId'>

export interface TransformPlayerResult {
  identity: PlayerIdentity
  stats: StatsPayload
}

export interface TransformResult {
  eaMatchId: string
  /** All fields required to insert the match row, except id and contentSeasonId. */
  match: Omit<NewMatch, 'id' | 'contentSeasonId'>
  players: TransformPlayerResult[]
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Parse a string-encoded integer. EA returns almost all numeric values as strings. */
function parseIntStr(val: string | undefined, field: string): number {
  if (val === undefined || val === '') return 0
  const n = parseInt(val, 10)
  if (isNaN(n)) throw new Error(`Expected numeric string for ${field}, got: ${JSON.stringify(val)}`)
  return n
}

function parseIntMaybe(val: unknown): number | null {
  if (typeof val === 'number') return Number.isNaN(val) ? null : val
  if (typeof val === 'string') {
    const n = parseInt(val, 10)
    return Number.isNaN(n) ? null : n
  }
  return null
}

/**
 * Extract the numeric score from club data.
 *
 * CONFIRMED: 'score' is the primary field (string). 'goals' is also present
 * and carries the same value.
 */
function extractScore(clubData: Record<string, unknown>, clubId: string): number {
  for (const key of ['score', 'goals', 'scoreString']) {
    const val = clubData[key]
    if (typeof val === 'string') {
      const n = parseInt(val, 10)
      if (!isNaN(n)) return n
    }
    if (typeof val === 'number') return val
  }
  throw new Error(
    `Cannot extract score for club ${clubId}. Keys present: ${Object.keys(clubData).join(', ')}`,
  )
}

/**
 * Parse the match timestamp into a Date.
 *
 * CONFIRMED: 'timestamp' is present as epoch seconds (number).
 */
function parsePlayedAt(match: EaMatch): Date {
  const raw = match.timestamp ?? match.matchDate
  if (raw === undefined || raw === null || raw === '') {
    throw new Error(
      'No timestamp field found in match payload. ' +
        "Check 'timestamp' and 'matchDate'. Capture a fixture to confirm.",
    )
  }
  if (typeof raw === 'number') {
    // Heuristic: values > 1e11 are already milliseconds; below that, seconds.
    return new Date(raw > 1e11 ? raw : raw * 1000)
  }
  if (typeof raw === 'string') {
    const epoch = parseInt(raw, 10)
    if (!isNaN(epoch)) {
      return new Date(epoch > 1e11 ? epoch : epoch * 1000)
    }
    const iso = new Date(raw)
    if (!isNaN(iso.getTime())) return iso
  }
  throw new Error(`Cannot parse timestamp value: ${JSON.stringify(raw)}`)
}

/**
 * Derive the match result from club data and scores.
 *
 * CONFIRMED: clubs[id].result codes: "1" = WIN, "2" = LOSS.
 * DEFERRED: OTL result code — no overtime match in current fixtures.
 *           When an OTL fixture is available, check clubs[id].result for a third
 *           value and add it here. The DB enum and aggregate already support 'OTL'.
 */
function deriveResult(
  ourClub: Record<string, unknown>,
  opponentClub: Record<string, unknown>,
  scoreFor: number,
  scoreAgainst: number,
): 'WIN' | 'LOSS' | 'DNF' {
  const resultCode = parseIntMaybe(ourClub.result)
  let base: 'WIN' | 'LOSS' = scoreFor > scoreAgainst ? 'WIN' : 'LOSS'
  if (resultCode === 1) base = 'WIN'
  if (resultCode === 2) base = 'LOSS'

  const opponentDnf = parseIntMaybe(opponentClub.winnerByDnf) === 1
  const opponentGoalieDnf = parseIntMaybe(opponentClub.winnerByGoalieDnf) === 1
  if (base === 'LOSS' && (opponentDnf || opponentGoalieDnf)) return 'DNF'

  return base
}

/**
 * Extract an integer from club aggregate data, trying multiple candidate field names.
 *
 * CONFIRMED: shots → 'shots', hits → 'skhits', faceoffwins/faceofftotal present.
 */
function extractAggInt(data: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const val = data[key]
    if (typeof val === 'string') {
      const n = parseInt(val, 10)
      if (!isNaN(n)) return n
    }
    if (typeof val === 'number') return val
  }
  return 0
}

/**
 * Transform a single player's EA stats into DB-ready form.
 *
 * CONFIRMED:
 *   - position values: 'goalie', 'center', 'defenseMen', 'leftWing', 'rightWing'
 *   - goalie indicator: position === 'goalie' (not gl* field presence)
 *   - gl* fields are present for ALL players; non-goalies have them as "0"
 *   - toiseconds: player TOI in seconds as a string (e.g. "3600")
 *   - skpasspct: 0–100 range
 */
function transformPlayer(playerKey: string, raw: EaPlayerMatchStats): TransformPlayerResult {
  // blazeId is absent in production payloads. Do not use playerKey as a surrogate ID.
  const eaId = raw.blazeId ?? null

  // CONFIRMED: position === 'goalie' is the reliable goalie indicator.
  // gl* fields (glsaves, glga, glshots) are present for ALL players — non-goalies
  // have them as "0". Field presence cannot be used for detection.
  const position = typeof raw.position === 'string' ? raw.position : null
  const isGoalie = position === 'goalie'

  const passAttempts = parseIntStr(raw.skpassattempts, 'skpassattempts')
  // CONFIRMED: skpasspct is 0–100 range (e.g. "100.00").
  const passPctStr = typeof raw.skpasspct === 'string' ? raw.skpasspct : '0'
  const passPct = parseFloat(passPctStr)
  const passCompletions = passAttempts > 0 ? Math.round(passAttempts * (passPct / 100)) : 0

  // CONFIRMED: toiseconds is present for all players as a string (e.g. "3600").
  // For goalies this is their actual time in net — used for GAA computation.
  const toiSeconds = parseIntMaybe(raw.toiseconds)

  return {
    identity: {
      eaId,
      gamertag: raw.playername,
      position,
    },
    stats: {
      position,
      isGoalie,
      goals: parseIntStr(raw.skgoals, 'skgoals'),
      assists: parseIntStr(raw.skassists, 'skassists'),
      plusMinus: parseIntStr(raw.skplusmin, 'skplusmin'),
      shots: parseIntStr(raw.skshots, 'skshots'),
      hits: parseIntStr(raw.skhits, 'skhits'),
      pim: parseIntStr(raw.skpim, 'skpim'),
      takeaways: parseIntStr(raw.sktakeaways, 'sktakeaways'),
      giveaways: parseIntStr(raw.skgiveaways, 'skgiveaways'),
      faceoffWins: parseIntStr(raw.skfow, 'skfow'),
      faceoffLosses: parseIntStr(raw.skfol, 'skfol'),
      passAttempts,
      passCompletions,
      toiSeconds,

      // Skater advanced fields — CONFIRMED in fixtures.
      shotAttempts: parseIntStr(raw.skshotattempts, 'skshotattempts'),
      blockedShots: parseIntStr(raw.skbs, 'skbs'),
      ppGoals: parseIntStr(raw.skppg, 'skppg'),
      shGoals: parseIntStr(raw.skshg, 'skshg'),
      interceptions: parseIntStr(raw.skinterceptions, 'skinterceptions'),
      penaltiesDrawn: parseIntStr(raw.skpenaltiesdrawn, 'skpenaltiesdrawn'),
      possession: parseIntStr(raw.skpossession, 'skpossession'),
      deflections: parseIntStr(raw.skdeflections, 'skdeflections'),
      saucerPasses: parseIntStr(raw.sksaucerpasses, 'sksaucerpasses'),

      // Per-match context.
      clientPlatform: typeof raw.clientPlatform === 'string' ? raw.clientPlatform : null,
      playerDnf: parseIntStr(raw.player_dnf, 'player_dnf') === 1,

      // Goalie fields — null for skaters.
      saves: isGoalie ? parseIntStr(raw.glsaves, 'glsaves') : null,
      goalsAgainst: isGoalie ? parseIntStr(raw.glga, 'glga') : null,
      shotsAgainst: isGoalie ? parseIntStr(raw.glshots, 'glshots') : null,

      // Goalie advanced fields — null for skaters.
      breakawaySaves: isGoalie ? parseIntStr(raw.glbrksaves, 'glbrksaves') : null,
      breakawayShots: isGoalie ? parseIntStr(raw.glbrkshots, 'glbrkshots') : null,
      despSaves: isGoalie ? parseIntStr(raw.gldsaves, 'gldsaves') : null,
      penSaves: isGoalie ? parseIntStr(raw.glpensaves, 'glpensaves') : null,
      penShots: isGoalie ? parseIntStr(raw.glpenshots, 'glpenshots') : null,
      pokechecks: isGoalie ? parseIntStr(raw.glpokechecks, 'glpokechecks') : null,
    },
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Transform a raw EA match payload (as stored in raw_match_payloads.payload)
 * into structured data for insertion into matches + player_match_stats.
 *
 * Throws on any unrecoverable parse failure. The caller catches the error,
 * stores it in raw_match_payloads.transform_error, and sets transform_status = 'error'.
 */
export function transformMatch(
  rawPayload: unknown,
  gameTitleId: number,
  eaClubId: string,
  matchType: EaMatchType,
): TransformResult {
  // Cast to EaMatch. Fields are accessed defensively since the structure is UNVERIFIED.
  const match = rawPayload as EaMatch

  // ── Match ID ────────────────────────────────────────────────────────────────
  // CONFIRMED: 'matchId' is the field name (top-level string).
  const eaMatchId = match.matchId
  if (!eaMatchId) {
    throw new Error(
      "matchId field missing or empty. Check if EA uses a different field name (e.g. 'id', 'matchID').",
    )
  }

  // ── Timestamp ───────────────────────────────────────────────────────────────
  const playedAt = parsePlayedAt(match)

  // ── Club identification ──────────────────────────────────────────────────────
  const clubs = match.clubs ?? {}
  const clubIds = Object.keys(clubs)

  const ourClubId = clubIds.find((id) => id === eaClubId)
  if (!ourClubId) {
    throw new Error(
      `Our club ID ${eaClubId} not found in match clubs: [${clubIds.join(', ')}]. ` +
        'Possible causes: wrong eaClubId in game_titles, or EA uses a different key format.',
    )
  }

  const opponentClubId = clubIds.find((id) => id !== eaClubId)
  if (!opponentClubId) {
    throw new Error(
      `Could not identify opponent club in match ${eaMatchId}. clubIds: [${clubIds.join(', ')}]`,
    )
  }

  const ourClub = clubs[ourClubId] as Record<string, unknown> | undefined
  const opponentClub = clubs[opponentClubId] as Record<string, unknown> | undefined

  if (!ourClub || !opponentClub) {
    throw new Error(`Club data missing for one or both clubs in match ${eaMatchId}`)
  }

  // ── Scores and result ────────────────────────────────────────────────────────
  const scoreFor = extractScore(ourClub, ourClubId)
  const scoreAgainst = extractScore(opponentClub, opponentClubId)
  const result = deriveResult(ourClub, opponentClub, scoreFor, scoreAgainst)

  // ── Opponent name ────────────────────────────────────────────────────────────
  // CONFIRMED: club display name is at clubs[id].details.name (not top-level).
  const opponentDetails =
    typeof opponentClub.details === 'object' && opponentClub.details !== null
      ? (opponentClub.details as Record<string, unknown>)
      : null
  const opponentName =
    (typeof opponentDetails?.name === 'string' ? opponentDetails.name : null) ??
    (typeof opponentClub.name === 'string' ? opponentClub.name : null) ??
    opponentClubId

  // ── Club-level aggregate stats ───────────────────────────────────────────────
  const aggregate = (match.aggregate ?? {}) as Record<string, Record<string, unknown>>
  const ourAgg: Record<string, unknown> = aggregate[ourClubId] ?? {}
  const oppAgg: Record<string, unknown> = aggregate[opponentClubId] ?? {}

  const shotsFor = extractAggInt(ourAgg, 'shots', 'skshots')
  const shotsAgainst = extractAggInt(oppAgg, 'shots', 'skshots')
  const hitsFor = extractAggInt(ourAgg, 'hits', 'skhits')
  const hitsAgainst = extractAggInt(oppAgg, 'hits', 'skhits')

  const faceoffWins = extractAggInt(ourAgg, 'faceoffwins', 'skfow')
  const faceoffTotal = extractAggInt(ourAgg, 'faceofftotal')
  const faceoffPct: string | null =
    faceoffTotal > 0 ? ((faceoffWins / faceoffTotal) * 100).toFixed(2) : null

  const timeOnAttackRaw = extractAggInt(ourAgg, 'toa', 'timeOnAttack')
  const penaltyMinutesRaw = extractAggInt(ourAgg, 'pim', 'skpim')

  // ── Game mode ────────────────────────────────────────────────────────────────
  // CONFIRMED: cNhlOnlineGameType is at clubs[id].cNhlOnlineGameType (not aggregate).
  // Known values: 5 = 6's, 10 = playoffs (6's), 200 = 3's.
  const eaGameTypeCodeRaw = parseIntMaybe(ourClub.cNhlOnlineGameType)
  const eaGameTypeCode: number | null = eaGameTypeCodeRaw
  const gameMode = deriveGameMode(eaGameTypeCodeRaw)

  // ── Club pass and powerplay stats ────────────────────────────────────────────
  // CONFIRMED: passa, passc, ppg, ppo are at clubs[id] level (not aggregate).
  const passAttemptsRaw = parseIntMaybe(ourClub.passa)
  const passCompletionsRaw = parseIntMaybe(ourClub.passc)
  const ppGoalsRaw = parseIntMaybe(ourClub.ppg)
  const ppOpportunitiesRaw = parseIntMaybe(ourClub.ppo)

  // ── Player stats ─────────────────────────────────────────────────────────────
  const allPlayers = match.players ?? {}
  const ourPlayers: Record<string, EaPlayerMatchStats> = allPlayers[ourClubId] ?? {}

  const players: TransformPlayerResult[] = Object.entries(ourPlayers).map(([key, raw]) =>
    transformPlayer(key, raw),
  )

  return {
    eaMatchId,
    match: {
      gameTitleId,
      eaMatchId,
      matchType,
      opponentClubId,
      opponentName,
      playedAt,
      result,
      scoreFor,
      scoreAgainst,
      shotsFor,
      shotsAgainst,
      hitsFor,
      hitsAgainst,
      faceoffPct,
      timeOnAttack: timeOnAttackRaw > 0 ? timeOnAttackRaw : null,
      penaltyMinutes: penaltyMinutesRaw > 0 ? penaltyMinutesRaw : null,
      eaGameTypeCode,
      gameMode,
      passAttempts: passAttemptsRaw,
      passCompletions: passCompletionsRaw,
      ppGoals: ppGoalsRaw,
      ppOpportunities: ppOpportunitiesRaw,
    },
    players,
  }
}
