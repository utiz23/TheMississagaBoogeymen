/**
 * Aggregate recomputation.
 *
 * Recomputes player_game_title_stats and club_game_title_stats for a given
 * game title using INSERT ... ON CONFLICT UPDATE from GROUP BY queries.
 *
 * Called after each ingestion cycle. Safe to call multiple times (idempotent).
 *
 * Note on GAA: Goals Against Average requires time-on-ice data, which is not
 * currently tracked in the schema. The gaa column is left NULL until that data
 * is confirmed available from the EA API.
 */

import { db } from '@eanhl/db'
import { sql } from 'drizzle-orm'

/**
 * Recompute player_game_title_stats and club_game_title_stats for one game title.
 * Uses raw SQL to express the GROUP BY aggregation compactly.
 */
export async function recomputeAggregates(gameTitleId: number): Promise<void> {
  await recomputePlayerStats(gameTitleId)
  await recomputeClubStats(gameTitleId)
}

async function recomputePlayerStats(gameTitleId: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO player_game_title_stats (
      player_id,
      game_title_id,
      games_played,
      goals,
      assists,
      points,
      plus_minus,
      shots,
      hits,
      pim,
      takeaways,
      giveaways,
      faceoff_pct,
      pass_pct,
      wins,
      losses,
      save_pct,
      gaa,
      shutouts
    )
    SELECT
      pms.player_id,
      ${gameTitleId}::int                                          AS game_title_id,
      COUNT(*)::int                                                AS games_played,
      SUM(pms.goals)::int                                          AS goals,
      SUM(pms.assists)::int                                        AS assists,
      (SUM(pms.goals) + SUM(pms.assists))::int                     AS points,
      SUM(pms.plus_minus)::int                                     AS plus_minus,
      SUM(pms.shots)::int                                          AS shots,
      SUM(pms.hits)::int                                           AS hits,
      SUM(pms.pim)::int                                            AS pim,
      SUM(pms.takeaways)::int                                      AS takeaways,
      SUM(pms.giveaways)::int                                      AS giveaways,

      -- Faceoff pct: wins / total faced-off * 100
      CASE
        WHEN SUM(pms.faceoff_wins + pms.faceoff_losses) > 0
        THEN ROUND(
          SUM(pms.faceoff_wins)::numeric
            / NULLIF(SUM(pms.faceoff_wins + pms.faceoff_losses), 0)
            * 100,
          2
        )
        ELSE NULL
      END                                                          AS faceoff_pct,

      -- Pass pct: completions / attempts * 100
      CASE
        WHEN SUM(pms.pass_attempts) > 0
        THEN ROUND(
          SUM(pms.pass_completions)::numeric
            / NULLIF(SUM(pms.pass_attempts), 0)
            * 100,
          2
        )
        ELSE NULL
      END                                                          AS pass_pct,

      -- Goalie: wins / losses from the match result, only for goalie appearances
      SUM(CASE WHEN pms.is_goalie AND m.result = 'WIN'  THEN 1 ELSE 0 END)::int  AS wins,
      SUM(CASE WHEN pms.is_goalie AND m.result = 'LOSS' THEN 1 ELSE 0 END)::int  AS losses,

      -- Save pct: saves / shots_against * 100
      CASE
        WHEN SUM(CASE WHEN pms.is_goalie THEN COALESCE(pms.shots_against, 0) ELSE 0 END) > 0
        THEN ROUND(
          SUM(CASE WHEN pms.is_goalie THEN COALESCE(pms.saves, 0) ELSE 0 END)::numeric
            / NULLIF(
                SUM(CASE WHEN pms.is_goalie THEN COALESCE(pms.shots_against, 0) ELSE 0 END),
                0
              )
            * 100,
          2
        )
        ELSE NULL
      END                                                          AS save_pct,

      -- GAA requires time-on-ice, not yet in schema. Left NULL.
      NULL::numeric                                                AS gaa,

      -- Shutouts: goalie appearances with 0 goals against
      SUM(
        CASE WHEN pms.is_goalie AND COALESCE(pms.goals_against, 0) = 0 THEN 1 ELSE 0 END
      )::int                                                       AS shutouts

    FROM player_match_stats pms
    JOIN matches m ON pms.match_id = m.id
    WHERE m.game_title_id = ${gameTitleId}
    GROUP BY pms.player_id

    ON CONFLICT (player_id, game_title_id) DO UPDATE SET
      games_played = EXCLUDED.games_played,
      goals        = EXCLUDED.goals,
      assists      = EXCLUDED.assists,
      points       = EXCLUDED.points,
      plus_minus   = EXCLUDED.plus_minus,
      shots        = EXCLUDED.shots,
      hits         = EXCLUDED.hits,
      pim          = EXCLUDED.pim,
      takeaways    = EXCLUDED.takeaways,
      giveaways    = EXCLUDED.giveaways,
      faceoff_pct  = EXCLUDED.faceoff_pct,
      pass_pct     = EXCLUDED.pass_pct,
      wins         = EXCLUDED.wins,
      losses       = EXCLUDED.losses,
      save_pct     = EXCLUDED.save_pct,
      gaa          = EXCLUDED.gaa,
      shutouts     = EXCLUDED.shutouts
  `)
}

async function recomputeClubStats(gameTitleId: number): Promise<void> {
  await db.execute(sql`
    WITH pass_agg AS (
      SELECT
        ROUND(
          SUM(pms.pass_completions)::numeric
            / NULLIF(SUM(pms.pass_attempts), 0)
            * 100,
          2
        ) AS pass_pct
      FROM player_match_stats pms
      JOIN matches m ON pms.match_id = m.id
      WHERE m.game_title_id = ${gameTitleId}
    )
    INSERT INTO club_game_title_stats (
      game_title_id,
      games_played,
      wins,
      losses,
      otl,
      goals_for,
      goals_against,
      shots_per_game,
      hits_per_game,
      faceoff_pct,
      pass_pct
    )
    SELECT
      ${gameTitleId}::int                                                         AS game_title_id,
      COUNT(*)::int                                                               AS games_played,
      SUM(CASE WHEN result = 'WIN'  THEN 1 ELSE 0 END)::int                      AS wins,
      SUM(CASE WHEN result = 'LOSS' THEN 1 ELSE 0 END)::int                      AS losses,
      SUM(CASE WHEN result = 'OTL'  THEN 1 ELSE 0 END)::int                      AS otl,
      SUM(score_for)::int                                                         AS goals_for,
      SUM(score_against)::int                                                     AS goals_against,
      ROUND(AVG(shots_for)::numeric, 2)                                           AS shots_per_game,
      ROUND(AVG(hits_for)::numeric, 2)                                            AS hits_per_game,
      ROUND(AVG(faceoff_pct::numeric), 2)                                         AS faceoff_pct,
      (SELECT pass_pct FROM pass_agg)                                             AS pass_pct
    FROM matches
    WHERE game_title_id = ${gameTitleId}

    ON CONFLICT (game_title_id) DO UPDATE SET
      games_played   = EXCLUDED.games_played,
      wins           = EXCLUDED.wins,
      losses         = EXCLUDED.losses,
      otl            = EXCLUDED.otl,
      goals_for      = EXCLUDED.goals_for,
      goals_against  = EXCLUDED.goals_against,
      shots_per_game = EXCLUDED.shots_per_game,
      hits_per_game  = EXCLUDED.hits_per_game,
      faceoff_pct    = EXCLUDED.faceoff_pct,
      pass_pct       = EXCLUDED.pass_pct
  `)
}
