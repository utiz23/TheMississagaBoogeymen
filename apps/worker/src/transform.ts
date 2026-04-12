/**
 * Transform raw EA match payload into structured data ready for DB insertion.
 *
 * This module is intentionally conservative. Many EA API field names and formats
 * are UNVERIFIED pending real fixture captures. Every assumption is marked with
 * a TODO(fixture) comment. Once fixtures are captured and contract tests pass,
 * update the relevant section and remove the TODO.
 *
 * This function must remain pure (no DB access). All DB writes happen in ingest.ts.
 */

import type { EaMatch, EaPlayerMatchStats, EaMatchType } from '@eanhl/ea-client'
import type { NewMatch, NewPlayer, NewPlayerMatchStats } from '@eanhl/db'

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

/**
 * Extract the numeric score from club data.
 *
 * TODO(fixture): Verify the actual score field name.
 * Candidates: 'score', 'goals', 'scoreString'.
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
 * Fixtures confirm `timestamp` is present as epoch seconds (number).
 * Fallbacks remain for safety.
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
 * Derive the match result from scores.
 *
 * TODO(fixture): Check if EA provides an explicit result or OT indicator field.
 * Without one, OTL cannot be distinguished from a regulation loss.
 */
function deriveResult(scoreFor: number, scoreAgainst: number): 'WIN' | 'LOSS' {
  return scoreFor > scoreAgainst ? 'WIN' : 'LOSS'
}

/**
 * Extract an integer from club aggregate data, trying multiple candidate field names.
 *
 * TODO(fixture): Verify exact field names in the aggregate object.
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
 * TODO(fixture): Confirm:
 *   - blazeId field name
 *   - position field values (e.g. 'center', 'C', 'goaliePosition', 'goalie')
 *   - goalie detection logic (position string, or presence of gl* fields)
 *   - goalie stat field names: glsaves, glga, glshots
 *   - skpasspct format: is it 0-100 or 0-1?
 */
function transformPlayer(playerKey: string, raw: EaPlayerMatchStats): TransformPlayerResult {
  // Fixtures confirm blazeId is not guaranteed. Do not use playerKey as a surrogate ID.
  const eaId = raw.blazeId ?? null

  // TODO(fixture): Confirm position field and goalie string values.
  const position = typeof raw.position === 'string' ? raw.position : null
  const hasGoalieFields = raw.glsaves !== undefined || raw.glga !== undefined
  const isGoalie = hasGoalieFields || position?.toLowerCase().startsWith('goal') === true

  const passAttempts = parseIntStr(raw.skpassattempts, 'skpassattempts')
  // TODO(fixture): Confirm skpasspct range (0-100 assumed here).
  const passPctStr = typeof raw.skpasspct === 'string' ? raw.skpasspct : '0'
  const passPct = parseFloat(passPctStr)
  const passCompletions = passAttempts > 0 ? Math.round(passAttempts * (passPct / 100)) : 0

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
      // Goalie fields — null for skaters.
      saves: isGoalie ? parseIntStr(raw.glsaves, 'glsaves') : null,
      goalsAgainst: isGoalie ? parseIntStr(raw.glga, 'glga') : null,
      shotsAgainst: isGoalie ? parseIntStr(raw.glshots, 'glshots') : null,
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
  // TODO(fixture): Verify field name. Types assume 'matchId' per architecture doc.
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
  const result = deriveResult(scoreFor, scoreAgainst)

  // ── Opponent name ────────────────────────────────────────────────────────────
  // TODO(fixture): Verify field name for opponent club name.
  const opponentName = typeof opponentClub.name === 'string' ? opponentClub.name : opponentClubId

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
    },
    players,
  }
}
