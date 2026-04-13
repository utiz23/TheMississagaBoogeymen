/**
 * Aggregate recomputation.
 *
 * Recomputes player_game_title_stats and club_game_title_stats for a given
 * game title using INSERT ... ON CONFLICT UPDATE from GROUP BY queries.
 *
 * Called after each ingestion cycle. Safe to call multiple times (idempotent).
 *
 * GAA (Goals Against Average): computed as (total_goals_against / total_toi_seconds) * 3600,
 * giving goals per 60 minutes. Requires toi_seconds to be non-null for at least one
 * goalie appearance; rows with NULL toi_seconds are excluded from both numerator and
 * denominator. Rows ingested before Phase 5.2 will have toi_seconds = NULL and will
 * produce NULL GAA until reprocessed.
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
      shot_attempts,
      toi_seconds,
      wins,
      losses,
      otl,
      save_pct,
      gaa,
      shutouts,
      total_saves,
      total_shots_against,
      total_goals_against
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

      -- Shot attempts: total across all appearances (skaters and goalies).
      SUM(pms.shot_attempts)::int                                  AS shot_attempts,

      -- TOI: total seconds across all appearances. NULL for pre-Phase-1 rows
      -- where toi_seconds was not yet extracted. PostgreSQL SUM ignores NULLs,
      -- returning NULL only if every value in the group is NULL.
      SUM(pms.toi_seconds)::int                                    AS toi_seconds,

      -- Goalie: wins / losses / OTL from the match result, only for goalie appearances
      SUM(CASE WHEN pms.is_goalie AND m.result = 'WIN'  THEN 1 ELSE 0 END)::int  AS wins,
      SUM(CASE WHEN pms.is_goalie AND m.result = 'LOSS' THEN 1 ELSE 0 END)::int  AS losses,
      SUM(CASE WHEN pms.is_goalie AND m.result = 'OTL'  THEN 1 ELSE 0 END)::int  AS otl,

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

      -- GAA: goals against per 60 minutes = (goals_against / toi_seconds) * 3600.
      -- Only computed when toi_seconds is available. Rows without toi_seconds
      -- (ingested before Phase 5.2) contribute 0 to numerator/denominator and
      -- will produce NULL until reprocessed.
      CASE
        WHEN SUM(CASE WHEN pms.is_goalie THEN COALESCE(pms.toi_seconds, 0) ELSE 0 END) > 0
        THEN ROUND(
          SUM(CASE WHEN pms.is_goalie THEN COALESCE(pms.goals_against, 0) ELSE 0 END)::numeric
            / NULLIF(
                SUM(CASE WHEN pms.is_goalie THEN COALESCE(pms.toi_seconds, 0) ELSE 0 END),
                0
              )
            * 3600,
          2
        )
        ELSE NULL
      END                                                          AS gaa,

      -- Shutouts: goalie appearances with 0 goals against
      SUM(
        CASE WHEN pms.is_goalie AND COALESCE(pms.goals_against, 0) = 0 THEN 1 ELSE 0 END
      )::int                                                       AS shutouts,

      -- Goalie totals: summed only for goalie appearances, 0 for non-goalies.
      -- Consistent with wins/losses pattern.
      SUM(
        CASE WHEN pms.is_goalie THEN COALESCE(pms.saves, 0) ELSE 0 END
      )::int                                                       AS total_saves,
      SUM(
        CASE WHEN pms.is_goalie THEN COALESCE(pms.shots_against, 0) ELSE 0 END
      )::int                                                       AS total_shots_against,
      SUM(
        CASE WHEN pms.is_goalie THEN COALESCE(pms.goals_against, 0) ELSE 0 END
      )::int                                                       AS total_goals_against

    FROM player_match_stats pms
    JOIN matches m ON pms.match_id = m.id
    WHERE m.game_title_id = ${gameTitleId}
    GROUP BY pms.player_id

    ON CONFLICT (player_id, game_title_id) DO UPDATE SET
      games_played        = EXCLUDED.games_played,
      goals               = EXCLUDED.goals,
      assists             = EXCLUDED.assists,
      points              = EXCLUDED.points,
      plus_minus          = EXCLUDED.plus_minus,
      shots               = EXCLUDED.shots,
      hits                = EXCLUDED.hits,
      pim                 = EXCLUDED.pim,
      takeaways           = EXCLUDED.takeaways,
      giveaways           = EXCLUDED.giveaways,
      faceoff_pct         = EXCLUDED.faceoff_pct,
      pass_pct            = EXCLUDED.pass_pct,
      shot_attempts       = EXCLUDED.shot_attempts,
      toi_seconds         = EXCLUDED.toi_seconds,
      wins                = EXCLUDED.wins,
      losses              = EXCLUDED.losses,
      otl                 = EXCLUDED.otl,
      save_pct            = EXCLUDED.save_pct,
      gaa                 = EXCLUDED.gaa,
      shutouts            = EXCLUDED.shutouts,
      total_saves         = EXCLUDED.total_saves,
      total_shots_against = EXCLUDED.total_shots_against,
      total_goals_against = EXCLUDED.total_goals_against
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
