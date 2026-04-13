/**
 * Transform raw EA /members/stats response into structured DB rows.
 *
 * EA member stats represent full season totals (authoritative) — NOT derived from
 * locally ingested match data. Use these to drive the /stats table.
 *
 * Field notes:
 *   - sktoi / gltoi: total MINUTES. Stored as seconds (× 60) for codebase consistency.
 *   - skshotpct: goals / shots-on-goal × 100 (shooting %). Stored as-is.
 *   - glsavepct: 0–100 range (e.g. 67.000). Stored as numeric(5,2) → "67.00".
 *   - glgaa: pre-computed by EA. Stored as-is (numeric(4,2)).
 *   - Goalie nullable fields: set to null when goalieGp = 0 (non-goalie players).
 *
 * This function is pure. No DB access. Caller resolves playerId before calling.
 */

import type { EaMemberStats } from '@eanhl/ea-client'
import type { NewEaMemberSeasonStats } from '@eanhl/db'

// ─── Parsing helpers ──────────────────────────────────────────────────────────

/** Parse a field that EA may return as string or number. Returns 0 on missing/NaN. */
function parseIntField(raw: EaMemberStats, field: string): number {
  const val = raw[field]
  if (val === undefined || val === null) return 0
  const n =
    typeof val === 'string' ? parseInt(val, 10) : typeof val === 'number' ? Math.round(val) : NaN
  return isNaN(n) ? 0 : n
}

/** Parse a nullable integer. Returns null on missing/NaN or when gp = 0. */
function parseNullableInt(raw: EaMemberStats, field: string, gp: number): number | null {
  if (gp === 0) return null
  const val = raw[field]
  if (val === undefined || val === null) return null
  const n =
    typeof val === 'string' ? parseInt(val, 10) : typeof val === 'number' ? Math.round(val) : NaN
  return isNaN(n) ? null : n
}

/**
 * Parse a numeric(5,2) field.
 * Returns a two-decimal string (e.g. "18.20") or null on missing/NaN.
 */
function parseNumeric2(raw: EaMemberStats, field: string): string | null {
  const val = raw[field]
  if (val === undefined || val === null) return null
  const n = typeof val === 'string' ? parseFloat(val) : typeof val === 'number' ? val : NaN
  if (isNaN(n)) return null
  return n.toFixed(2)
}

/**
 * Parse a numeric(4,2) field (GAA).
 * Returns a two-decimal string or null on missing/NaN or when gp = 0.
 */
function parseNumeric2Goalie(raw: EaMemberStats, field: string, gp: number): string | null {
  if (gp === 0) return null
  return parseNumeric2(raw, field)
}

// ─── Transform ────────────────────────────────────────────────────────────────

/**
 * Transform one EA member stats row into a DB insert shape.
 *
 * @param raw         Single member object from EA /members/stats response
 * @param gameTitleId Local game_title_id for the current season
 * @param playerId    Resolved local players.id for this gamertag
 */
export function transformMemberStats(
  raw: EaMemberStats,
  gameTitleId: number,
  playerId: number,
): Omit<NewEaMemberSeasonStats, 'id' | 'lastFetchedAt'> {
  const goalieGp = parseIntField(raw, 'glgp')
  const skToiMinutes = parseIntField(raw, 'sktoi')
  const glToiMinutes = parseIntField(raw, 'gltoi')

  return {
    gameTitleId,
    gamertag: raw.name,
    playerId,

    favoritePosition: typeof raw.favoritePosition === 'string' ? raw.favoritePosition : null,

    gamesPlayed: parseIntField(raw, 'gamesplayed'),
    skaterGp: parseIntField(raw, 'skgp'),

    goals: parseIntField(raw, 'skgoals'),
    assists: parseIntField(raw, 'skassists'),
    points: parseIntField(raw, 'skpoints'),
    pointsPerGame: parseNumeric2(raw, 'skpointspg'),
    plusMinus: parseIntField(raw, 'skplusmin'),
    pim: parseIntField(raw, 'skpim'),
    shots: parseIntField(raw, 'skshots'),
    shotPct: parseNumeric2(raw, 'skshotpct'),
    shotAttempts: parseIntField(raw, 'skshotattempts'),
    hits: parseIntField(raw, 'skhits'),
    toiSeconds: skToiMinutes > 0 ? skToiMinutes * 60 : null,
    faceoffPct: parseNumeric2(raw, 'skfop'),
    passPct: parseNumeric2(raw, 'skpasspct'),
    takeaways: parseIntField(raw, 'sktakeaways'),
    giveaways: parseIntField(raw, 'skgiveaways'),

    goalieGp,
    goalieWins: parseNullableInt(raw, 'glwins', goalieGp),
    goalieLosses: parseNullableInt(raw, 'gllosses', goalieGp),
    goalieOtl: parseNullableInt(raw, 'glotl', goalieGp),
    goalieSavePct: parseNumeric2Goalie(raw, 'glsavepct', goalieGp),
    goalieGaa: parseNumeric2Goalie(raw, 'glgaa', goalieGp),
    goalieShutouts: parseNullableInt(raw, 'glso', goalieGp),
    goalieSaves: parseNullableInt(raw, 'glsaves', goalieGp),
    goalieShots: parseNullableInt(raw, 'glshots', goalieGp),
    goalieGoalsAgainst: parseNullableInt(raw, 'glga', goalieGp),
    goalieToiSeconds: goalieGp > 0 ? glToiMinutes * 60 : null,

    clientPlatform: typeof raw.clientPlatform === 'string' ? raw.clientPlatform : null,
  }
}
