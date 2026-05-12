/**
 * EA Pro Clubs API — TypeScript response types.
 *
 * Fields marked CONFIRMED have been validated against real fixture captures.
 * Fields marked UNVERIFIED are provisional and may need updating.
 *
 * Known EA API quirks:
 *   - Almost all numeric values are returned as strings (e.g. goals: "3")
 *   - Some endpoints may return 400/500 without warning
 *   - The API is undocumented and changes between game releases
 */

// ─── Shared ───────────────────────────────────────────────────────────────────

/**
 * EA platform identifier.
 * Known values listed for autocomplete; (string & {}) accepts arbitrary platforms
 * without widening the union to plain string (which would drop autocomplete).
 */
export type EaPlatform = 'common-gen5' | 'common-gen4' | (string & {})

/** Known match types. The API may return others. */
export type EaMatchType = 'gameType5' | 'gameType10' | 'club_private'

// ─── Club Search ─────────────────────────────────────────────────────────────
// GET /clubs/search?platform=<platform>&clubName=<name>

/** UNVERIFIED: Shape of a single club in the search results. */
export interface EaClubSearchResult {
  clubId: string
  name: string
  platform?: string
  /** UNVERIFIED: May contain additional fields. */
  [key: string]: unknown
}

/** UNVERIFIED: Top-level response from the club search endpoint. */
export type EaClubSearchResponse = EaClubSearchResult[]

// ─── Matches ──────────────────────────────────────────────────────────────────
// GET /clubs/matches?clubIds=<id>&platform=<platform>&matchType=<matchType>

/**
 * Stats for a single player within a match.
 * All numeric values are strings per EA API convention.
 */
export interface EaPlayerMatchStats {
  /** DEFERRED: blazeId is absent in current production payloads. Not reliable. */
  blazeId?: string
  /** Player's gamertag / display name. CONFIRMED present. */
  playername: string
  /**
   * CONFIRMED position values: 'goalie', 'center', 'defenseMen', 'leftWing', 'rightWing'.
   * Use position === 'goalie' as the sole goalie indicator.
   */
  position?: string
  /** CONFIRMED: Time on ice in seconds as a string (e.g. "3600"). Present for all players. */
  toiseconds?: string
  /** String-encoded numbers — must be parsed before storage. */
  skgoals: string
  skassists: string
  skplusmin: string
  skshots: string
  skhits: string
  skpim: string
  sktakeaways: string
  skgiveaways: string
  skfow: string
  skfol: string
  skpassattempts: string
  skpasspct: string

  // ── Skater advanced — CONFIRMED present in fixtures ──────────────────────────
  /** Total shot attempts including blocked + missed. */
  skshotattempts?: string
  /** Blocked shots (defensive). */
  skbs?: string
  /** Powerplay goals. */
  skppg?: string
  /** Short-handed goals. */
  skshg?: string
  /** Interceptions. */
  skinterceptions?: string
  /** Penalties drawn. */
  skpenaltiesdrawn?: string
  /** Possession time in seconds. */
  skpossession?: string
  /** Deflections. */
  skdeflections?: string
  /** Saucer passes. */
  sksaucerpasses?: string

  // ── Per-match context — CONFIRMED present in fixtures ────────────────────────
  /** Console platform (e.g. 'xbsx', 'ps5'). */
  clientPlatform?: string
  /** "1" if player did not finish (disconnected). */
  player_dnf?: string

  /**
   * CONFIRMED field names. Present for ALL players (not goalie-only).
   * Non-goalies have these set to "0". Use position === 'goalie' to filter.
   */
  glsaves?: string
  glga?: string
  glshots?: string
  glsavepct?: string
  glgaa?: string

  // ── Goalie advanced — CONFIRMED present in fixtures ──────────────────────────
  glbrksaves?: string
  glbrkshots?: string
  gldsaves?: string
  glpensaves?: string
  glpenshots?: string
  glpokechecks?: string

  /** Catch-all for fields not yet identified. */
  [key: string]: unknown
}

/**
 * Club-level data within a match.
 * One entry per club (our club + opponent).
 *
 * CONFIRMED fields: score (string), result (numeric code, see below),
 * winnerByDnf, winnerByGoalieDnf, toa, details.name (club display name).
 */
export interface EaMatchClubData {
  /** CONFIRMED: Score as a string (e.g. "5"). */
  score?: string
  /** CONFIRMED: Also available alongside score. */
  goals?: string
  scoreString?: string
  /**
   * CONFIRMED: Numeric result code as a string. Decoded by
   * `apps/worker/src/transform.ts → deriveResult()`:
   *   "1"     regulation WIN
   *   "2"     regulation LOSS
   *   "5"     OT/SO WIN (still 2pts)
   *   "6"     OT/SO LOSS → matches.result = 'OTL'
   *   "10"    DNF
   *   "16385" WIN by opponent forfeit
   * Full investigation:
   * `research/investigations/ea-overtime-detection.md`.
   */
  result?: string
  /** CONFIRMED: "1" if opponent won by the other team disconnecting. */
  winnerByDnf?: string
  /** CONFIRMED: "1" if opponent won by their goalie disconnecting. */
  winnerByGoalieDnf?: string
  /** CONFIRMED: Time on attack in seconds. */
  toa?: string
  /** CONFIRMED: Nested object containing display name at details.name. */
  details?: Record<string, unknown>

  // ── Game mode — CONFIRMED present in fixtures ─────────────────────────────────
  /**
   * CONFIRMED: Numeric game type. Known values: 5 = 6's, 10 = playoffs (6's),
   * 200 = 3's. Stored raw alongside the derived gameMode field on matches.
   */
  cNhlOnlineGameType?: string | number

  // ── Club pass and powerplay stats — CONFIRMED present in fixtures ─────────────
  /** Total pass attempts. */
  passa?: string | number
  /** Total pass completions. */
  passc?: string | number
  /** Powerplay goals. */
  ppg?: string | number
  /** Powerplay opportunities. */
  ppo?: string | number

  /** Catch-all. */
  [key: string]: unknown
}

/**
 * UNVERIFIED: Aggregate stats for a club within a single match.
 * Separate from EaMatchClubData — may be nested or flat.
 */
export interface EaMatchClubAggregates {
  shots?: string
  hits?: string
  faceoffwins?: string
  faceofftotal?: string
  toa?: string
  pim?: string
  [key: string]: unknown
}

/**
 * Top-level shape of a single match in the matches response.
 *
 * CONFIRMED fields: matchId (string), timestamp (epoch seconds), clubs, players, aggregate.
 * Club/opponent distinction: by comparing clubId key against our known eaClubId.
 * No in-game season field found in fixtures.
 */
export interface EaMatch {
  /** CONFIRMED: Top-level string field (e.g. "16476207380260"). */
  matchId: string
  /** CONFIRMED: Epoch seconds as a number (e.g. 1775876848). */
  timestamp?: number
  /** Human-ish timestamp object present in fixtures. */
  timeAgo?: Record<string, unknown>
  /** UNVERIFIED: Club data keyed by clubId. */
  clubs?: Record<string, EaMatchClubData>
  /** UNVERIFIED: Player stats keyed by clubId → blazeId. */
  players?: Record<string, Record<string, EaPlayerMatchStats>>
  /** UNVERIFIED: Aggregate stats keyed by clubId. */
  aggregate?: Record<string, EaMatchClubAggregates>
  /** Catch-all. */
  [key: string]: unknown
}

/** UNVERIFIED: Top-level response from the matches endpoint. */
export type EaMatchesResponse = EaMatch[]

// ─── Member Stats ─────────────────────────────────────────────────────────────
// GET /members/stats?clubId=<id>&platform=<platform>

/**
 * CONFIRMED via HAR capture (research/ea-api/www.ea.com.har): /members/stats
 * returns ~150 fields per member as string-encoded values. Below lists the
 * skater-side fields we capture. Goalie + spatial fields are deliberately
 * left as catch-all (`[key: string]: unknown`) until their own implementation passes.
 *
 * All numeric values are strings per EA convention. Transform layer parses.
 */
export interface EaMemberStats {
  /** Gamertag — only reliable identifier. */
  name: string
  /** DEFERRED: blazeId not present in current fixtures. */
  blazeId?: string
  /** Console platform identifier. */
  clientPlatform?: string
  /** Position label: 'goalie' | 'center' | 'defenseMen' | 'leftWing' | 'rightWing'. */
  favoritePosition?: string

  // ── Aggregate record (Tab 1: Club Overview) ────────────────────────────────
  gamesplayed?: string
  gamesCompleted?: string
  gamesCompletedFC?: string
  playerDNF?: string
  playerQuitDisc?: string

  // ── Position GP splits ─────────────────────────────────────────────────────
  skgp?: string
  glgp?: string
  lwgp?: string
  rwgp?: string
  cgp?: string
  dgp?: string

  // ── Skater record + DNF (Tab 1) ────────────────────────────────────────────
  skwins?: string
  sklosses?: string
  skotl?: string
  skwinnerByDnf?: string
  skwinpct?: string
  skDNF?: string

  // ── Skater scoring (Tab 2) ─────────────────────────────────────────────────
  skgoals?: string
  skassists?: string
  skpoints?: string
  skpointspg?: string
  skppg?: string
  skshg?: string
  skgwg?: string
  skhattricks?: string
  skplusmin?: string
  skpim?: string
  skprevgoals?: string
  skprevassists?: string

  // ── Skater shooting (Tab 2) ────────────────────────────────────────────────
  skshots?: string
  skshotpct?: string
  skshotspg?: string
  skshotattempts?: string
  skshotonnetpct?: string
  skbreakaways?: string
  skbrkgoals?: string
  skbreakawaypct?: string

  // ── Skater playmaking (Tab 3) ──────────────────────────────────────────────
  skpasses?: string
  skpassattempts?: string
  skpasspct?: string
  skinterceptions?: string
  skdekes?: string
  skdekesmade?: string
  skdeflections?: string
  sksaucerpasses?: string
  skscrnchances?: string
  skscrngoals?: string
  skpossession?: string
  xfactor_zoneability_times_used?: string

  // ── Skater defense & discipline (Tab 4) ────────────────────────────────────
  skhits?: string
  skhitspg?: string
  skfights?: string
  skfightswon?: string
  skbs?: string
  skpkclearzone?: string
  skoffsides?: string
  skoffsidespg?: string
  skpenaltiesdrawn?: string
  sktakeaways?: string
  skgiveaways?: string

  // ── Skater faceoffs + utility (Tab 5) ──────────────────────────────────────
  skfo?: string
  skfow?: string
  skfol?: string
  skfop?: string
  skpenaltyattempts?: string
  skpenaltyshotgoals?: string
  skpenaltyshotpct?: string
  sktoi?: string

  // ── Goalie fields (captured for completeness; expanded in goalie plan) ─────
  glwins?: string
  gllosses?: string
  glotl?: string
  glsavepct?: string
  glgaa?: string
  glso?: string
  glsaves?: string
  glshots?: string
  glga?: string
  gltoi?: string

  // ── Shot location grids (NHL 26 only — null/missing for prior titles) ────
  // 16 ice-surface zones (offensive zone half-rink). Indices 1–16.
  // Physical zone-to-index mapping discovered empirically — see
  // apps/web/src/components/roster/shot-map-zones.ts.
  skShotsLocationOnIce1?: string
  skShotsLocationOnIce2?: string
  skShotsLocationOnIce3?: string
  skShotsLocationOnIce4?: string
  skShotsLocationOnIce5?: string
  skShotsLocationOnIce6?: string
  skShotsLocationOnIce7?: string
  skShotsLocationOnIce8?: string
  skShotsLocationOnIce9?: string
  skShotsLocationOnIce10?: string
  skShotsLocationOnIce11?: string
  skShotsLocationOnIce12?: string
  skShotsLocationOnIce13?: string
  skShotsLocationOnIce14?: string
  skShotsLocationOnIce15?: string
  skShotsLocationOnIce16?: string

  skGoalsLocationOnIce1?: string
  skGoalsLocationOnIce2?: string
  skGoalsLocationOnIce3?: string
  skGoalsLocationOnIce4?: string
  skGoalsLocationOnIce5?: string
  skGoalsLocationOnIce6?: string
  skGoalsLocationOnIce7?: string
  skGoalsLocationOnIce8?: string
  skGoalsLocationOnIce9?: string
  skGoalsLocationOnIce10?: string
  skGoalsLocationOnIce11?: string
  skGoalsLocationOnIce12?: string
  skGoalsLocationOnIce13?: string
  skGoalsLocationOnIce14?: string
  skGoalsLocationOnIce15?: string
  skGoalsLocationOnIce16?: string

  // 5 net-grid zones. Indices 1–5.
  skShotsLocationOnNet1?: string
  skShotsLocationOnNet2?: string
  skShotsLocationOnNet3?: string
  skShotsLocationOnNet4?: string
  skShotsLocationOnNet5?: string

  skGoalsLocationOnNet1?: string
  skGoalsLocationOnNet2?: string
  skGoalsLocationOnNet3?: string
  skGoalsLocationOnNet4?: string
  skGoalsLocationOnNet5?: string

  /** Catch-all for spatial fields, X-Factor variants, and any field not yet typed. */
  [key: string]: unknown
}

/** UNVERIFIED: Top-level response from the member stats endpoint. */
export interface EaMemberStatsResponse {
  members?: EaMemberStats[]
  [key: string]: unknown
}

// ─── Club Seasonal Stats ─────────────────────────────────────────────────────
// GET /clubs/seasonalStats?platform=<platform>&clubIds=<id>
// Response is an object keyed by club ID string.

/** CONFIRMED fields from clubs/seasonalStats. All values are strings. */
export interface EaClubSeasonalStats {
  /** The club's EA ID (e.g. "19224"). CONFIRMED: present as a field in the response object. */
  clubId?: string
  /** Season wins as a string integer (e.g. "283"). */
  wins?: string
  /** Season losses as a string integer. */
  losses?: string
  /** Season overtime losses as a string integer. */
  otl?: string
  /** Formatted record string (e.g. "283-188-20"). */
  record?: string
  /** Ranking points as a string integer. */
  rankingPoints?: string
  /** Goals scored as a string integer. */
  goals?: string
  /** Goals allowed as a string integer. */
  goalsAgainst?: string
  [key: string]: unknown
}

/**
 * Top-level response from the clubs/seasonalStats endpoint.
 * CONFIRMED: Returns an array. Each element contains the stats for one club
 * (identified by the clubId field within the object).
 */
export type EaClubSeasonalStatsResponse = EaClubSeasonalStats[]

// ─── Club Info ───────────────────────────────────────────────────────────────
// GET /clubs/info?platform=<platform>&clubIds=<id1,id2,...>
// Response is an object keyed by club ID string.

/** CONFIRMED fields from clubs/info. Used to retrieve opponent crest data. */
export interface EaClubInfoEntry {
  /** Club EA ID as a number. */
  clubId?: number | string
  /** Club display name. */
  name?: string
  teamId?: number | string
  regionId?: number | string
  /**
   * Custom kit data. Present when the club has a custom crest.
   * crestAssetId maps to the EA CDN:
   * https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/custom-crests/{crestAssetId}.png
   */
  customKit?: {
    isCustomTeam?: string
    crestAssetId?: string
    useBaseAsset?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** Response from clubs/info — keyed by club ID string. */
export type EaClubInfoResponse = Record<string, EaClubInfoEntry>

// ─── Club Season Rank ─────────────────────────────────────────────────────────
// GET /clubs/seasonRank?platform=<platform>&clubIds=<id>
// CONFIRMED: Response is an array. Each element has a clubId field identifying the club.
// Use .find(e => e.clubId === title.eaClubId) to locate the club's entry.

/** CONFIRMED: Single club entry from clubs/seasonRank. All numeric values are strings except where noted. */
export interface EaClubSeasonRankEntry {
  /** The club's EA ID string. Use to identify the row for a specific club. */
  clubId?: string
  /** Season wins — NOT the all-time official record. */
  wins?: string
  /** Season losses. */
  losses?: string
  /** Season ties. */
  ties?: string
  /** Season OTL. */
  otl?: string
  /** Total season games played. */
  gamesPlayed?: string
  /** Goals scored this season. */
  goals?: string
  /** Goals against this season. */
  goalsAgainst?: string
  /** Current division points. */
  points?: string
  /** Ranking/season points (may equal points). */
  rankingPoints?: string
  /** Projected end-of-season points. */
  projectedPoints?: string
  /** Current division number (1 = top, higher = lower). Confirmed as integer (not string). */
  currentDivision?: number | string
  /** Number of seasons played. */
  seasons?: number | string
  /** Previous season wins. */
  prevWins?: string
  /** Previous season losses. */
  prevLosses?: string
  /** Previous season OTL. */
  prevOtl?: string
  /** Previous season points. */
  prevPoints?: string
  /** Previous season projected points. */
  prevProjectedPoints?: string
  [key: string]: unknown
}

/** CONFIRMED: Response from clubs/seasonRank — array of club entries, each with a clubId field. */
export type EaClubSeasonRankResponse = EaClubSeasonRankEntry[]

// ─── Settings ─────────────────────────────────────────────────────────────────
// GET /settings?platform=<platform>
// UNVERIFIED: Response shape and field names from HAR analysis.

/** CONFIRMED: Division threshold entry from the settings endpoint. Numeric fields are integers (not strings). */
export interface EaSettingsDivisionEntry {
  /** Division number. */
  divisionId?: number
  /** Division name (e.g. "Division 10"). */
  divisionName?: string
  /** Division group ID. */
  divisionGroupId?: number
  /** Conference or league name (e.g. "Bronze Conference"). */
  divisionGroupName?: string
  /** Points needed to be promoted to the next division. Integer. */
  pointsForPromotion?: number | string
  /** Minimum points required to hold current division (avoid relegation). Integer. */
  pointsToHoldDivision?: number | string
  /** Points required to win the division title. Integer. */
  pointsToTitle?: number | string
  [key: string]: unknown
}

/** UNVERIFIED: Response from settings — keyed by division number string. */
export type EaSettingsResponse = Record<string, EaSettingsDivisionEntry>

// ─── Member Search ────────────────────────────────────────────────────────────
// GET /members/search?platform=<platform>&memberName=<name>

/** UNVERIFIED: Single result from the member search endpoint. */
export interface EaMemberSearchResult {
  blazeId?: string
  name?: string
  [key: string]: unknown
}

/** UNVERIFIED: Top-level response from the member search endpoint. */
export type EaMemberSearchResponse = EaMemberSearchResult[]
