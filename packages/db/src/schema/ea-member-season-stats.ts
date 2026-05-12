import {
  bigserial,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { gameTitles } from './game-titles.js'
import { players } from './players.js'

/**
 * EA-authoritative season stats for all club members, one row per (game_title_id, gamertag).
 *
 * Sourced from the EA /members/stats endpoint — NOT derived from locally ingested matches.
 * EA provides full season totals (e.g. 442 GP vs ~15 locally ingested). No web surface
 * reads from this table; all stats/roster pages use player_game_title_stats (local aggregate).
 *
 * This table is maintained for two reasons:
 *  1. Debug/baseline comparison — structured SQL access to full EA totals vs local counts.
 *  2. Player resolution — the ingest-members write loop creates players+profiles for members
 *     not yet seen in any locally ingested match, so /roster/[id] links work immediately.
 *
 * TOI notes:
 *   - EA returns sktoi/gltoi in total MINUTES. Stored here as seconds (× 60) to match
 *     the toiSeconds convention used throughout the rest of the codebase.
 *
 * player_id:
 *   - Resolved at ingest time by upserting into the players table by gamertag.
 *   - Always non-null after ingest, enabling /roster/[id] links.
 *   - Forward-compat: when a stable ea_id becomes available, the FK can be strengthened
 *     without changing the column.
 */
export const eaMemberSeasonStats = pgTable(
  'ea_member_season_stats',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    /** EA gamertag / display name. Join key to players table. */
    gamertag: text('gamertag').notNull(),
    /** Resolved local player id. Always populated at ingest time. */
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),

    /**
     * EA favoritePosition. Used to route rows into skater vs goalie sections.
     * Known values: 'goalie', 'center', 'defenseMen', 'leftWing', 'rightWing'.
     */
    favoritePosition: text('favorite_position'),

    // ── Total GP (all games across all positions) ─────────────────────────────
    /** EA field: gamesplayed */
    gamesPlayed: integer('games_played').notNull().default(0),

    // ── Skater stats ──────────────────────────────────────────────────────────
    /** Games played as skater. EA field: skgp */
    skaterGp: integer('skater_gp').notNull().default(0),
    /** EA field: skgoals */
    goals: integer('goals').notNull().default(0),
    /** EA field: skassists */
    assists: integer('assists').notNull().default(0),
    /** EA field: skpoints */
    points: integer('points').notNull().default(0),
    /** Points per game (pre-computed by EA). EA field: skpointspg. numeric(5,2) */
    pointsPerGame: numeric('points_per_game', { precision: 5, scale: 2 }),
    /** EA field: skplusmin */
    plusMinus: integer('plus_minus').notNull().default(0),
    /** EA field: skpim */
    pim: integer('pim').notNull().default(0),
    /** Shots on goal. EA field: skshots */
    shots: integer('shots').notNull().default(0),
    /** Shooting % (goals / shots on goal × 100). EA field: skshotpct. numeric(5,2) */
    shotPct: numeric('shot_pct', { precision: 5, scale: 2 }),
    /** Total shot attempts (goals + missed + blocked). EA field: skshotattempts */
    shotAttempts: integer('shot_attempts').notNull().default(0),
    /** EA field: skhits */
    hits: integer('hits').notNull().default(0),
    /**
     * Total skater TOI in seconds (= EA sktoi minutes × 60).
     * Nullable so that rows with no skater time show as — in the UI.
     */
    toiSeconds: integer('toi_seconds'),
    /** Faceoff %. EA field: skfop. numeric(5,2) */
    faceoffPct: numeric('faceoff_pct', { precision: 5, scale: 2 }),
    /** Pass completion %. EA field: skpasspct. numeric(5,2) */
    passPct: numeric('pass_pct', { precision: 5, scale: 2 }),
    /** EA field: sktakeaways */
    takeaways: integer('takeaways').notNull().default(0),
    /** EA field: skgiveaways */
    giveaways: integer('giveaways').notNull().default(0),

    // ── Skater record (Tab 1: Club Overview) ──────────────────────────────────
    /** Skater wins. EA field: skwins */
    skaterWins: integer('skater_wins').notNull().default(0),
    /** Skater losses. EA field: sklosses */
    skaterLosses: integer('skater_losses').notNull().default(0),
    /** Skater overtime losses. EA field: skotl */
    skaterOtl: integer('skater_otl').notNull().default(0),
    /** Skater wins by opponent DNF. EA field: skwinnerByDnf */
    skaterWinnerByDnf: integer('skater_winner_by_dnf').notNull().default(0),
    /** Skater win % (0-100 integer). EA field: skwinpct */
    skaterWinPct: integer('skater_win_pct').notNull().default(0),
    /** Skater DNF count (player disconnected). EA field: skDNF */
    skaterDnf: integer('skater_dnf').notNull().default(0),
    /** Total games completed (no DNF). EA field: gamesCompleted */
    gamesCompleted: integer('games_completed').notNull().default(0),
    /** Games completed by force (FC). EA field: gamesCompletedFC */
    gamesCompletedFc: integer('games_completed_fc').notNull().default(0),
    /** Player quit/disconnect count. EA field: playerQuitDisc */
    playerQuitDisc: integer('player_quit_disc').notNull().default(0),

    // ── Position GP splits ────────────────────────────────────────────────────
    /** Games at LW. EA field: lwgp */
    lwGp: integer('lw_gp').notNull().default(0),
    /** Games at RW. EA field: rwgp */
    rwGp: integer('rw_gp').notNull().default(0),
    /** Games at C. EA field: cgp */
    cGp: integer('c_gp').notNull().default(0),
    /** Games at D. EA field: dgp */
    dGp: integer('d_gp').notNull().default(0),

    // ── Tab 2: Scoring & Shooting ─────────────────────────────────────────────
    /** Power play goals. EA field: skppg */
    powerPlayGoals: integer('power_play_goals').notNull().default(0),
    /** Short-handed goals. EA field: skshg */
    shortHandedGoals: integer('short_handed_goals').notNull().default(0),
    /** Game winning goals. EA field: skgwg */
    gameWinningGoals: integer('game_winning_goals').notNull().default(0),
    /** Hat tricks. EA field: skhattricks */
    hatTricks: integer('hat_tricks').notNull().default(0),
    /** Shots per game. EA field: skshotspg. numeric(5,2) */
    shotsPerGame: numeric('shots_per_game', { precision: 5, scale: 2 }),
    /** Shot on net % (shots / shotattempts × 100). EA field: skshotonnetpct. numeric(5,2) */
    shotOnNetPct: numeric('shot_on_net_pct', { precision: 5, scale: 2 }),
    /** Breakaway shot count. EA field: skbreakaways */
    breakaways: integer('breakaways').notNull().default(0),
    /** Goals scored on breakaways. EA field: skbrkgoals */
    breakawayGoals: integer('breakaway_goals').notNull().default(0),
    /** Breakaway conversion %. EA field: skbreakawaypct. numeric(5,2) */
    breakawayPct: numeric('breakaway_pct', { precision: 5, scale: 2 }),

    // ── Tab 3: Playmaking ─────────────────────────────────────────────────────
    /** Completed passes. EA field: skpasses */
    passes: integer('passes').notNull().default(0),
    /** Pass attempts. EA field: skpassattempts */
    passAttempts: integer('pass_attempts').notNull().default(0),
    /** Interceptions. EA field: skinterceptions */
    interceptions: integer('interceptions').notNull().default(0),
    /** Deke attempts. EA field: skdekes */
    dekes: integer('dekes').notNull().default(0),
    /** Successful dekes. EA field: skdekesmade */
    dekesMade: integer('dekes_made').notNull().default(0),
    /** Deflections. EA field: skdeflections */
    deflections: integer('deflections').notNull().default(0),
    /** Saucer passes. EA field: sksaucerpasses */
    saucerPasses: integer('saucer_passes').notNull().default(0),
    /** Screen chance count. EA field: skscrnchances */
    screenChances: integer('screen_chances').notNull().default(0),
    /** Goals scored while screening. EA field: skscrngoals */
    screenGoals: integer('screen_goals').notNull().default(0),
    /** Total possession time in seconds. EA field: skpossession */
    possessionSeconds: integer('possession_seconds').notNull().default(0),
    /** X-Factor zone ability times used. EA field: xfactor_zoneability_times_used */
    xfactorZoneUsed: integer('xfactor_zone_used').notNull().default(0),

    // ── Tab 4: Defense & Discipline ───────────────────────────────────────────
    /** Hits per game. EA field: skhitspg. numeric(5,2) */
    hitsPerGame: numeric('hits_per_game', { precision: 5, scale: 2 }),
    /** Fights. EA field: skfights */
    fights: integer('fights').notNull().default(0),
    /** Fights won. EA field: skfightswon */
    fightsWon: integer('fights_won').notNull().default(0),
    /** Blocked shots. EA field: skbs */
    blockedShots: integer('blocked_shots').notNull().default(0),
    /** PK clear zone. EA field: skpkclearzone */
    pkClearZone: integer('pk_clear_zone').notNull().default(0),
    /** Offsides. EA field: skoffsides */
    offsides: integer('offsides').notNull().default(0),
    /** Offsides per game. EA field: skoffsidespg. numeric(5,2) */
    offsidesPerGame: numeric('offsides_per_game', { precision: 5, scale: 2 }),
    /** Penalties drawn. EA field: skpenaltiesdrawn */
    penaltiesDrawn: integer('penalties_drawn').notNull().default(0),

    // ── Tab 5: Faceoffs & Utility ─────────────────────────────────────────────
    /** Total faceoffs taken. EA field: skfo */
    faceoffTotal: integer('faceoff_total').notNull().default(0),
    /** Faceoffs won. EA field: skfow */
    faceoffWins: integer('faceoff_wins').notNull().default(0),
    /** Faceoffs lost. EA field: skfol */
    faceoffLosses: integer('faceoff_losses').notNull().default(0),
    /** Penalty shot attempts. EA field: skpenaltyattempts */
    penaltyShotAttempts: integer('penalty_shot_attempts').notNull().default(0),
    /** Penalty shot goals. EA field: skpenaltyshotgoals */
    penaltyShotGoals: integer('penalty_shot_goals').notNull().default(0),
    /** Penalty shot %. EA field: skpenaltyshotpct. numeric(5,2) */
    penaltyShotPct: numeric('penalty_shot_pct', { precision: 5, scale: 2 }),
    /** Previous season goals. EA field: skprevgoals */
    prevGoals: integer('prev_goals').notNull().default(0),
    /** Previous season assists. EA field: skprevassists */
    prevAssists: integer('prev_assists').notNull().default(0),

    // ── Goalie stats (null when goalieGp = 0) ─────────────────────────────────
    /** Games played as goalie. EA field: glgp */
    goalieGp: integer('goalie_gp').notNull().default(0),
    /** EA field: glwins */
    goalieWins: integer('goalie_wins'),
    /** EA field: gllosses */
    goalieLosses: integer('goalie_losses'),
    /** EA field: glotl */
    goalieOtl: integer('goalie_otl'),
    /**
     * Save percentage (0–100 range). EA field: glsavepct.
     * numeric(5,2) — e.g. 67.00 represents 67.00%.
     */
    goalieSavePct: numeric('goalie_save_pct', { precision: 5, scale: 2 }),
    /** Goals Against Average (pre-computed by EA). EA field: glgaa. numeric(4,2) */
    goalieGaa: numeric('goalie_gaa', { precision: 4, scale: 2 }),
    /** EA field: glso */
    goalieShutouts: integer('goalie_shutouts'),
    /** Total saves. EA field: glsaves */
    goalieSaves: integer('goalie_saves'),
    /** Total shots against. EA field: glshots */
    goalieShots: integer('goalie_shots'),
    /** Total goals against. EA field: glga */
    goalieGoalsAgainst: integer('goalie_goals_against'),
    /**
     * Total goalie TOI in seconds (= EA gltoi minutes × 60).
     * Nullable when goalieGp = 0.
     */
    goalieToiSeconds: integer('goalie_toi_seconds'),

    /* ── Goalie completion / disposition ────────────────────────────────── */
    /**
     * Goalie games completed (EA field: glgc). Subset of goalie_gp where the
     * goalie didn't DNF / disconnect. For Silky's NHL 26 row glgc=16 of glgp=25.
     */
    goalieGamesCompleted: integer('goalie_games_completed'),
    /** Goalie games completed via forced completion. EA field: glgcFC */
    goalieGamesCompletedFc: integer('goalie_games_completed_fc'),
    /** Goalie did-not-finish count. EA field: glDNF */
    goalieDnf: integer('goalie_dnf'),
    /** Goalie did-not-finish via matchmaking. EA field: glDNFmm */
    goalieDnfMm: integer('goalie_dnf_mm'),
    /** Goalie wins by DNF (opponent quit). EA field: glwinnerByDnf */
    goalieWinnerByDnf: integer('goalie_winner_by_dnf'),
    /** Goalie quit-disconnect count. EA field: glQuitDisc */
    goalieQuitDisc: integer('goalie_quit_disc'),
    /** Goalie pre-computed win percentage. EA field: glwinpct. numeric(5,2) */
    goalieWinPct: numeric('goalie_win_pct', { precision: 5, scale: 2 }),

    /* ── Goalie save splits ─────────────────────────────────────────────── */
    /** Desperation saves (e.g. paddle/diving). EA field: gldsaves */
    goalieDesperationSaves: integer('goalie_desperation_saves'),
    /** Poke checks. EA field: glpokechecks */
    goaliePokeChecks: integer('goalie_poke_checks'),
    /** PK zone clears as goalie. EA field: glpkclearzone */
    goaliePkClearZone: integer('goalie_pk_clear_zone'),
    /** Shutout periods (full periods without conceding). EA field: glsoperiods */
    goalieShutoutPeriods: integer('goalie_shutout_periods'),

    /* ── Goalie penalty shots ───────────────────────────────────────────── */
    /** Penalty shots faced. EA field: glpenshots */
    goaliePenShots: integer('goalie_pen_shots'),
    /** Penalty shot saves. EA field: glpensaves */
    goaliePenSaves: integer('goalie_pen_saves'),
    /** Penalty shot save %. EA field: glpensavepct. numeric(5,2) */
    goaliePenSavePct: numeric('goalie_pen_save_pct', { precision: 5, scale: 2 }),

    /* ── Goalie breakaway shots ─────────────────────────────────────────── */
    /** Breakaway shots faced. EA field: glbrkshots */
    goalieBrkShots: integer('goalie_brk_shots'),
    /** Breakaway saves. EA field: glbrksaves */
    goalieBrkSaves: integer('goalie_brk_saves'),
    /** Breakaway save %. EA field: glbrksavepct. numeric(5,2) */
    goalieBrkSavePct: numeric('goalie_brk_save_pct', { precision: 5, scale: 2 }),

    /* ── Goalie shootouts ───────────────────────────────────────────────── */
    /** Shootout shots faced. EA field: glsoshots */
    goalieSoShots: integer('goalie_so_shots'),
    /** Shootout saves. EA field: glsosaves */
    goalieSoSaves: integer('goalie_so_saves'),
    /** Shootout save %. EA field: glsosavepct. numeric(5,2) */
    goalieSoSavePct: numeric('goalie_so_save_pct', { precision: 5, scale: 2 }),

    /* ── Goalie previous season ─────────────────────────────────────────── */
    /** Goalie wins last season. EA field: glprevwins */
    goaliePrevWins: integer('goalie_prev_wins'),
    /** Goalie shutouts last season. EA field: glprevso */
    goaliePrevShutouts: integer('goalie_prev_shutouts'),

    /**
     * Shot/goal location grids. JSON shape: { shotsIce: number[16],
     * goalsIce: number[16], shotsNet: number[5], goalsNet: number[5] }.
     * Null for goalie rows and pre-NHL-26 game titles.
     */
    shotLocations: jsonb('shot_locations').$type<ShotLocations | null>(),
    /**
     * Goalie shot/goal location grids — same shape as shotLocations, but the
     * arrays count shots FACED and goals ALLOWED at each ice / net zone (from
     * EA's `glShotsLocationOnIce*` / `glGoalsLocationOnIce*` / Net counterparts).
     * Null for skater rows and pre-NHL-26 game titles.
     */
    goalieShotLocations: jsonb('goalie_shot_locations').$type<ShotLocations | null>(),

    // ── Context ───────────────────────────────────────────────────────────────
    /** Console platform reported by EA. e.g. 'xbsx', 'ps5'. EA field: clientPlatform */
    clientPlatform: text('client_platform'),
    /** Timestamp of the most recent fetch from EA for this game title. */
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('ea_member_season_stats_uniq').on(table.gameTitleId, table.gamertag)],
)

/**
 * Per-player shot/goal location grids for NHL 26.
 *
 * Sourced from the EA `/members/stats` endpoint. EA returns 42 individual
 * fields (`skShotsLocationOnIce1`–`16`, `skGoalsLocationOnIce1`–`16`,
 * `skShotsLocationOnNet1`–`5`, `skGoalsLocationOnNet1`–`5`); we collapse
 * them into four fixed-length integer arrays.
 *
 * `null` for goalie rows and any pre-NHL-26 ingestion (no source fields
 * present on the raw payload). Sum invariant on writes:
 *   sum(shotsIce) === sum(shotsNet)
 *   sum(goalsIce) === sum(goalsNet)
 */
export type ShotLocations = {
  shotsIce: number[]   // length 16
  goalsIce: number[]   // length 16
  shotsNet: number[]   // length 5
  goalsNet: number[]   // length 5
}

export type EaMemberSeasonStats = typeof eaMemberSeasonStats.$inferSelect
export type NewEaMemberSeasonStats = typeof eaMemberSeasonStats.$inferInsert
