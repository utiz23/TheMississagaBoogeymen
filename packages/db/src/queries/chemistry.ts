import { sql } from 'drizzle-orm'
import { db } from '../client.js'
import type { GameMode } from '../schema/index.js'

export interface PairWinMatrixPlayer {
  playerId: number
  gamertag: string
  /** Manually-entered display name from `player_profiles.player_name`.
   *  Drives the matrix's short-alias label (e.g. "Igor Orlov" → "Orlov"). */
  playerName: string | null
  /** Total skater games played in BGM matches for this title/mode. */
  gp: number
  /** Solo team record across BGM matches (drives the row-aggregate TEAM cell). */
  wins: number
  losses: number
  otl: number
  dnf: number
  /** Solo win % across BGM matches (DNFs excluded from denominator). */
  pct: number
}

export interface PairWinMatrixCell {
  /** Win % when both players appeared (0–100, DNFs excluded from denom). */
  pct: number
  wins: number
  losses: number
  otl: number
  dnf: number
  /** Shared games (counts DNFs). */
  gp: number
}

export interface PairWinMatrix {
  players: PairWinMatrixPlayer[]
  /** Lookup keyed by `${minId}-${maxId}` (caller orders by ascending playerId). */
  pairs: Record<string, PairWinMatrixCell>
}

export const CHEMISTRY_MIN_GP_WITH = 3
export const CHEMISTRY_MIN_GP_WITHOUT = 3
export const CHEMISTRY_PAIR_MIN_GP = 5

export interface WithWithoutRow {
  playerId: number
  gamertag: string
  gpWith: number
  winsWith: number
  lossesWith: number
  otlWith: number
  dnfWith: number
  gpWithout: number
  winsWithout: number
  lossesWithout: number
  otlWithout: number
  dnfWithout: number
}

export interface PairRow {
  p1Id: number
  p1Gamertag: string
  p2Id: number
  p2Gamertag: string
  gp: number
  wins: number
  losses: number
  otl: number
  dnf: number
  totalGf: number
  totalGa: number
}

/**
 * Per-player team record split: games played with vs. without each teammate
 * appearing at all. Useful for identifying players whose presence measurably
 * shifts team outcomes.
 *
 * Only returns players where both splits meet the minimum game threshold.
 */
export async function getPlayerWithWithoutSplits(
  gameTitleId: number,
  gameMode: GameMode | null,
  minGpWith = CHEMISTRY_MIN_GP_WITH,
  minGpWithout = CHEMISTRY_MIN_GP_WITHOUT,
): Promise<WithWithoutRow[]> {
  const gameModeClause = gameMode !== null ? sql`AND game_mode = ${gameMode}` : sql``

  const result = await db.execute(sql`
    WITH match_pool AS (
      SELECT id, result, score_for, score_against
      FROM matches
      WHERE game_title_id = ${gameTitleId} ${gameModeClause}
    ),
    player_with AS (
      SELECT
        pms.player_id,
        CAST(count(*) AS integer)                                                           AS gp_with,
        CAST(sum(CASE WHEN mp.result = 'WIN' THEN 1 ELSE 0 END) AS integer)                AS wins_with,
        CAST(sum(CASE WHEN mp.result = 'LOSS' THEN 1 ELSE 0 END) AS integer)               AS losses_with,
        CAST(sum(CASE WHEN mp.result = 'OTL'  THEN 1 ELSE 0 END) AS integer)               AS otl_with,
        CAST(sum(CASE WHEN mp.result = 'DNF'  THEN 1 ELSE 0 END) AS integer)               AS dnf_with
      FROM player_match_stats pms
      JOIN match_pool mp ON mp.id = pms.match_id
      GROUP BY pms.player_id
      HAVING count(*) >= ${minGpWith}
    ),
    player_without AS (
      SELECT
        pw.player_id,
        CAST(count(mp.id) AS integer)                                                       AS gp_without,
        CAST(sum(CASE WHEN mp.result = 'WIN' THEN 1 ELSE 0 END) AS integer)                AS wins_without,
        CAST(sum(CASE WHEN mp.result = 'LOSS' THEN 1 ELSE 0 END) AS integer)               AS losses_without,
        CAST(sum(CASE WHEN mp.result = 'OTL'  THEN 1 ELSE 0 END) AS integer)               AS otl_without,
        CAST(sum(CASE WHEN mp.result = 'DNF'  THEN 1 ELSE 0 END) AS integer)               AS dnf_without
      FROM player_with pw
      CROSS JOIN match_pool mp
      WHERE NOT EXISTS (
        SELECT 1 FROM player_match_stats pms2
        WHERE pms2.player_id = pw.player_id AND pms2.match_id = mp.id
      )
      GROUP BY pw.player_id
    )
    SELECT
      pw.player_id                        AS "playerId",
      p.gamertag,
      pw.gp_with                          AS "gpWith",
      pw.wins_with                        AS "winsWith",
      pw.losses_with                      AS "lossesWith",
      pw.otl_with                         AS "otlWith",
      pw.dnf_with                         AS "dnfWith",
      COALESCE(pwo.gp_without, 0)         AS "gpWithout",
      COALESCE(pwo.wins_without, 0)       AS "winsWithout",
      COALESCE(pwo.losses_without, 0)     AS "lossesWithout",
      COALESCE(pwo.otl_without, 0)        AS "otlWithout",
      COALESCE(pwo.dnf_without, 0)        AS "dnfWithout"
    FROM player_with pw
    JOIN players p ON p.id = pw.player_id
    LEFT JOIN player_without pwo ON pwo.player_id = pw.player_id
    WHERE COALESCE(pwo.gp_without, 0) >= ${minGpWithout}
    ORDER BY pw.gp_with DESC
  `)

  return (result as unknown as Record<string, unknown>[]).map((r) => ({
    playerId: Number(r.playerId),
    gamertag: String(r.gamertag),
    gpWith: Number(r.gpWith),
    winsWith: Number(r.winsWith),
    lossesWith: Number(r.lossesWith),
    otlWith: Number(r.otlWith),
    dnfWith: Number(r.dnfWith),
    gpWithout: Number(r.gpWithout),
    winsWithout: Number(r.winsWithout),
    lossesWithout: Number(r.lossesWithout),
    otlWithout: Number(r.otlWithout),
    dnfWithout: Number(r.dnfWithout),
  }))
}

/**
 * Co-occurrence pair stats: team record for every pair of players who
 * appeared in the same match at least minGp times.
 *
 * Uses a < b player_id ordering to avoid double-counting pairs.
 * GF/GA are team totals for those shared appearances, not individual totals.
 */
export async function getPlayerPairs(
  gameTitleId: number,
  gameMode: GameMode | null,
  minGp = CHEMISTRY_PAIR_MIN_GP,
): Promise<PairRow[]> {
  const gameModeClause = gameMode !== null ? sql`AND game_mode = ${gameMode}` : sql``

  const result = await db.execute(sql`
    WITH match_pool AS (
      SELECT id, result, score_for, score_against
      FROM matches
      WHERE game_title_id = ${gameTitleId} ${gameModeClause}
    ),
    pair_stats AS (
      SELECT
        a.player_id                                                                         AS p1_id,
        b.player_id                                                                         AS p2_id,
        CAST(count(*) AS integer)                                                           AS gp,
        CAST(sum(CASE WHEN mp.result = 'WIN' THEN 1 ELSE 0 END) AS integer)                AS wins,
        CAST(sum(CASE WHEN mp.result = 'LOSS' THEN 1 ELSE 0 END) AS integer)               AS losses,
        CAST(sum(CASE WHEN mp.result = 'OTL'  THEN 1 ELSE 0 END) AS integer)               AS otl,
        CAST(sum(CASE WHEN mp.result = 'DNF'  THEN 1 ELSE 0 END) AS integer)               AS dnf,
        CAST(sum(mp.score_for) AS integer)                                                  AS total_gf,
        CAST(sum(mp.score_against) AS integer)                                              AS total_ga
      FROM player_match_stats a
      JOIN player_match_stats b ON a.match_id = b.match_id AND a.player_id < b.player_id
      JOIN match_pool mp ON mp.id = a.match_id
      GROUP BY a.player_id, b.player_id
      HAVING count(*) >= ${minGp}
    )
    SELECT
      ps.p1_id                            AS "p1Id",
      p1.gamertag                         AS "p1Gamertag",
      ps.p2_id                            AS "p2Id",
      p2.gamertag                         AS "p2Gamertag",
      ps.gp,
      ps.wins,
      ps.losses,
      ps.otl,
      ps.dnf,
      ps.total_gf                         AS "totalGf",
      ps.total_ga                         AS "totalGa"
    FROM pair_stats ps
    JOIN players p1 ON p1.id = ps.p1_id
    JOIN players p2 ON p2.id = ps.p2_id
    ORDER BY ps.gp DESC, ps.wins DESC
  `)

  return (result as unknown as Record<string, unknown>[]).map((r) => ({
    p1Id: Number(r.p1Id),
    p1Gamertag: String(r.p1Gamertag),
    p2Id: Number(r.p2Id),
    p2Gamertag: String(r.p2Gamertag),
    gp: Number(r.gp),
    wins: Number(r.wins),
    losses: Number(r.losses),
    otl: Number(r.otl),
    dnf: Number(r.dnf),
    totalGf: Number(r.totalGf),
    totalGa: Number(r.totalGa),
  }))
}

/**
 * Pairwise win-percentage matrix for BGM skaters in a given title/mode.
 *
 * Returns:
 *   - `players` — every player with at least `playerMinGp` skater appearances
 *     in BGM matches, ordered by GP descending (most-active first).
 *   - `pairs` — for each unordered pair (min playerId first), the shared
 *     record (`gp`, `wins`, `losses`, `otl`, `tied=0`, `pct`). Pairs with no
 *     shared games are absent from the map (the matrix renders an empty cell).
 *
 * Win % is computed from `wins / (gp - dnf)` so DNF games (disconnects) don't
 * drag the rate down — they're excluded from the denominator. When every shared
 * game was a DNF, `pct` is 0 and the cell still renders so the count is visible.
 */
export async function getPairWinMatrix(
  gameTitleId: number,
  gameMode: GameMode | null,
  playerMinGp = 5,
): Promise<PairWinMatrix> {
  const gameModeClause = gameMode !== null ? sql`AND m.game_mode = ${gameMode}` : sql``

  const playerRows = await db.execute(sql`
    SELECT
      pms.player_id                                                       AS "playerId",
      p.gamertag                                                          AS gamertag,
      pp.player_name                                                      AS "playerName",
      CAST(count(*) AS integer)                                           AS gp,
      CAST(sum(CASE WHEN m.result = 'WIN'  THEN 1 ELSE 0 END) AS integer) AS wins,
      CAST(sum(CASE WHEN m.result = 'LOSS' THEN 1 ELSE 0 END) AS integer) AS losses,
      CAST(sum(CASE WHEN m.result = 'OTL'  THEN 1 ELSE 0 END) AS integer) AS otl,
      CAST(sum(CASE WHEN m.result = 'DNF'  THEN 1 ELSE 0 END) AS integer) AS dnf
    FROM player_match_stats pms
    JOIN matches m ON m.id = pms.match_id
    JOIN players p ON p.id = pms.player_id
    LEFT JOIN player_profiles pp ON pp.player_id = p.id
    WHERE m.game_title_id = ${gameTitleId} ${gameModeClause}
      AND pms.is_goalie = false
    GROUP BY pms.player_id, p.gamertag, pp.player_name
    HAVING count(*) >= ${playerMinGp}
    ORDER BY count(*) DESC, p.gamertag ASC
  `)

  const players: PairWinMatrixPlayer[] = (playerRows as unknown as Record<string, unknown>[]).map(
    (r) => {
      const wins = Number(r.wins)
      const losses = Number(r.losses)
      const otl = Number(r.otl)
      const dnf = Number(r.dnf)
      const denom = Number(r.gp) - dnf
      return {
        playerId: Number(r.playerId),
        gamertag: String(r.gamertag),
        playerName: r.playerName === null || r.playerName === undefined ? null : String(r.playerName),
        gp: Number(r.gp),
        wins,
        losses,
        otl,
        dnf,
        pct: denom > 0 ? Math.round((wins / denom) * 100) : 0,
      }
    },
  )

  if (players.length === 0) return { players, pairs: {} }

  const pairRows = await db.execute(sql`
    WITH match_pool AS (
      SELECT id, result FROM matches m
      WHERE m.game_title_id = ${gameTitleId} ${gameModeClause}
    )
    SELECT
      a.player_id                                                           AS "p1Id",
      b.player_id                                                           AS "p2Id",
      CAST(count(*) AS integer)                                             AS gp,
      CAST(sum(CASE WHEN mp.result = 'WIN'  THEN 1 ELSE 0 END) AS integer) AS wins,
      CAST(sum(CASE WHEN mp.result = 'LOSS' THEN 1 ELSE 0 END) AS integer) AS losses,
      CAST(sum(CASE WHEN mp.result = 'OTL'  THEN 1 ELSE 0 END) AS integer) AS otl,
      CAST(sum(CASE WHEN mp.result = 'DNF'  THEN 1 ELSE 0 END) AS integer) AS dnf
    FROM player_match_stats a
    JOIN player_match_stats b
      ON a.match_id = b.match_id AND a.player_id < b.player_id
    JOIN match_pool mp ON mp.id = a.match_id
    WHERE a.is_goalie = false AND b.is_goalie = false
    GROUP BY a.player_id, b.player_id
  `)

  const pairs: Record<string, PairWinMatrixCell> = {}
  for (const raw of pairRows as unknown as Record<string, unknown>[]) {
    const p1Id = Number(raw.p1Id)
    const p2Id = Number(raw.p2Id)
    const gp = Number(raw.gp)
    const wins = Number(raw.wins)
    const losses = Number(raw.losses)
    const otl = Number(raw.otl)
    const dnf = Number(raw.dnf)
    const denom = gp - dnf
    const pct = denom > 0 ? Math.round((wins / denom) * 100) : 0
    pairs[`${String(p1Id)}-${String(p2Id)}`] = {
      pct,
      wins,
      losses,
      otl,
      dnf,
      gp,
    }
  }

  return { players, pairs }
}
