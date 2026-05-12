/**
 * Transform raw EA /members/stats response into structured DB rows.
 *
 * EA member stats represent full EA season totals — NOT derived from locally ingested
 * match data. Written to ea_member_season_stats for debug/baseline comparison against
 * local aggregates. No web surface reads this table; /stats and all other pages use
 * player_game_title_stats (local aggregate).
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
import { extractShotLocations, extractGoalieShotLocations } from './extract-shot-locations.js'

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

  const shotLocations = extractShotLocations(raw)
  const goalieShotLocations = goalieGp > 0 ? extractGoalieShotLocations(raw) : null

  // Diagnostic: warn when EA returned partial location data that fails the
  // sum invariant. Don't drop the row — just skip the column for that member.
  if (
    shotLocations === null &&
    raw.favoritePosition !== 'goalie' &&
    typeof raw.skShotsLocationOnIce1 === 'string'
  ) {
    console.warn(
      `[transform-members] shot location invariant failed for ${raw.name} (game title ${gameTitleId}); skipping shot_locations column`,
    )
  }

  return {
    gameTitleId,
    gamertag: raw.name,
    playerId,

    favoritePosition: typeof raw.favoritePosition === 'string' ? raw.favoritePosition : null,

    // ── Aggregate ───────────────────────────────────────────────────────────
    gamesPlayed: parseIntField(raw, 'gamesplayed'),
    gamesCompleted: parseIntField(raw, 'gamesCompleted'),
    gamesCompletedFc: parseIntField(raw, 'gamesCompletedFC'),
    playerQuitDisc: parseIntField(raw, 'playerQuitDisc'),

    // ── Position GP splits ──────────────────────────────────────────────────
    skaterGp: parseIntField(raw, 'skgp'),
    lwGp: parseIntField(raw, 'lwgp'),
    rwGp: parseIntField(raw, 'rwgp'),
    cGp: parseIntField(raw, 'cgp'),
    dGp: parseIntField(raw, 'dgp'),

    // ── Skater record (Tab 1) ───────────────────────────────────────────────
    skaterWins: parseIntField(raw, 'skwins'),
    skaterLosses: parseIntField(raw, 'sklosses'),
    skaterOtl: parseIntField(raw, 'skotl'),
    skaterWinnerByDnf: parseIntField(raw, 'skwinnerByDnf'),
    skaterWinPct: parseIntField(raw, 'skwinpct'),
    skaterDnf: parseIntField(raw, 'skDNF'),

    // ── Skater scoring (Tab 2) ──────────────────────────────────────────────
    goals: parseIntField(raw, 'skgoals'),
    assists: parseIntField(raw, 'skassists'),
    points: parseIntField(raw, 'skpoints'),
    pointsPerGame: parseNumeric2(raw, 'skpointspg'),
    powerPlayGoals: parseIntField(raw, 'skppg'),
    shortHandedGoals: parseIntField(raw, 'skshg'),
    gameWinningGoals: parseIntField(raw, 'skgwg'),
    hatTricks: parseIntField(raw, 'skhattricks'),
    plusMinus: parseIntField(raw, 'skplusmin'),
    pim: parseIntField(raw, 'skpim'),
    prevGoals: parseIntField(raw, 'skprevgoals'),
    prevAssists: parseIntField(raw, 'skprevassists'),

    // ── Skater shooting (Tab 2) ─────────────────────────────────────────────
    shots: parseIntField(raw, 'skshots'),
    shotPct: parseNumeric2(raw, 'skshotpct'),
    shotsPerGame: parseNumeric2(raw, 'skshotspg'),
    shotAttempts: parseIntField(raw, 'skshotattempts'),
    shotOnNetPct: parseNumeric2(raw, 'skshotonnetpct'),
    breakaways: parseIntField(raw, 'skbreakaways'),
    breakawayGoals: parseIntField(raw, 'skbrkgoals'),
    breakawayPct: parseNumeric2(raw, 'skbreakawaypct'),

    // ── Skater playmaking (Tab 3) ───────────────────────────────────────────
    passes: parseIntField(raw, 'skpasses'),
    passAttempts: parseIntField(raw, 'skpassattempts'),
    passPct: parseNumeric2(raw, 'skpasspct'),
    interceptions: parseIntField(raw, 'skinterceptions'),
    dekes: parseIntField(raw, 'skdekes'),
    dekesMade: parseIntField(raw, 'skdekesmade'),
    deflections: parseIntField(raw, 'skdeflections'),
    saucerPasses: parseIntField(raw, 'sksaucerpasses'),
    screenChances: parseIntField(raw, 'skscrnchances'),
    screenGoals: parseIntField(raw, 'skscrngoals'),
    possessionSeconds: parseIntField(raw, 'skpossession'),
    xfactorZoneUsed: parseIntField(raw, 'xfactor_zoneability_times_used'),

    // ── Skater defense & discipline (Tab 4) ─────────────────────────────────
    hits: parseIntField(raw, 'skhits'),
    hitsPerGame: parseNumeric2(raw, 'skhitspg'),
    fights: parseIntField(raw, 'skfights'),
    fightsWon: parseIntField(raw, 'skfightswon'),
    blockedShots: parseIntField(raw, 'skbs'),
    pkClearZone: parseIntField(raw, 'skpkclearzone'),
    offsides: parseIntField(raw, 'skoffsides'),
    offsidesPerGame: parseNumeric2(raw, 'skoffsidespg'),
    penaltiesDrawn: parseIntField(raw, 'skpenaltiesdrawn'),
    takeaways: parseIntField(raw, 'sktakeaways'),
    giveaways: parseIntField(raw, 'skgiveaways'),

    // ── Skater faceoffs + utility (Tab 5) ───────────────────────────────────
    faceoffTotal: parseIntField(raw, 'skfo'),
    faceoffWins: parseIntField(raw, 'skfow'),
    faceoffLosses: parseIntField(raw, 'skfol'),
    faceoffPct: parseNumeric2(raw, 'skfop'),
    penaltyShotAttempts: parseIntField(raw, 'skpenaltyattempts'),
    penaltyShotGoals: parseIntField(raw, 'skpenaltyshotgoals'),
    penaltyShotPct: parseNumeric2(raw, 'skpenaltyshotpct'),
    toiSeconds: skToiMinutes > 0 ? skToiMinutes * 60 : null,

    // ── Goalie ──────────────────────────────────────────────────────────────
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

    // ── Goalie completion / disposition ────────────────────────────────────
    goalieGamesCompleted: parseNullableInt(raw, 'glgc', goalieGp),
    goalieGamesCompletedFc: parseNullableInt(raw, 'glgcFC', goalieGp),
    goalieDnf: parseNullableInt(raw, 'glDNF', goalieGp),
    goalieDnfMm: parseNullableInt(raw, 'glDNFmm', goalieGp),
    goalieWinnerByDnf: parseNullableInt(raw, 'glwinnerByDnf', goalieGp),
    goalieQuitDisc: parseNullableInt(raw, 'glQuitDisc', goalieGp),
    goalieWinPct: parseNumeric2Goalie(raw, 'glwinpct', goalieGp),

    // ── Goalie save splits ──────────────────────────────────────────────────
    goalieDesperationSaves: parseNullableInt(raw, 'gldsaves', goalieGp),
    goaliePokeChecks: parseNullableInt(raw, 'glpokechecks', goalieGp),
    goaliePkClearZone: parseNullableInt(raw, 'glpkclearzone', goalieGp),
    goalieShutoutPeriods: parseNullableInt(raw, 'glsoperiods', goalieGp),

    // ── Goalie penalty shots ────────────────────────────────────────────────
    goaliePenShots: parseNullableInt(raw, 'glpenshots', goalieGp),
    goaliePenSaves: parseNullableInt(raw, 'glpensaves', goalieGp),
    goaliePenSavePct: parseNumeric2Goalie(raw, 'glpensavepct', goalieGp),

    // ── Goalie breakaways ───────────────────────────────────────────────────
    goalieBrkShots: parseNullableInt(raw, 'glbrkshots', goalieGp),
    goalieBrkSaves: parseNullableInt(raw, 'glbrksaves', goalieGp),
    goalieBrkSavePct: parseNumeric2Goalie(raw, 'glbrksavepct', goalieGp),

    // ── Goalie shootouts ────────────────────────────────────────────────────
    goalieSoShots: parseNullableInt(raw, 'glsoshots', goalieGp),
    goalieSoSaves: parseNullableInt(raw, 'glsosaves', goalieGp),
    goalieSoSavePct: parseNumeric2Goalie(raw, 'glsosavepct', goalieGp),

    // ── Goalie previous season ──────────────────────────────────────────────
    goaliePrevWins: parseNullableInt(raw, 'glprevwins', goalieGp),
    goaliePrevShutouts: parseNullableInt(raw, 'glprevso', goalieGp),

    shotLocations,
    goalieShotLocations,

    clientPlatform: typeof raw.clientPlatform === 'string' ? raw.clientPlatform : null,
  }
}
