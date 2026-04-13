/**
 * EA Pro Clubs API — TypeScript response types.
 *
 * Fields marked CONFIRMED have been validated against real fixture captures.
 * Fields marked UNVERIFIED are provisional and may need updating.
 * Fields marked DEFERRED need real fixture data (e.g. OTL match) to confirm.
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
 * CONFIRMED fields: score (string), result ("1"=WIN, "2"=LOSS), winnerByDnf,
 * winnerByGoalieDnf, toa, details.name (club display name).
 *
 * DEFERRED: OTL result code — no overtime matches in current fixtures.
 */
export interface EaMatchClubData {
  /** CONFIRMED: Score as a string (e.g. "5"). */
  score?: string
  /** CONFIRMED: Also available alongside score. */
  goals?: string
  scoreString?: string
  /** CONFIRMED: "1" = WIN, "2" = LOSS. DEFERRED: OTL code unknown. */
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
 * UNVERIFIED: Stats for a single member from the member stats endpoint.
 * This endpoint returns season-aggregate stats, not per-match.
 */
export interface EaMemberStats {
  /** Name is present in fixtures and is the only reliable identifier. */
  name: string
  /** DEFERRED: blazeId not present in current fixtures. */
  blazeId?: string
  /** DEFERRED: memberId not present in current fixtures. */
  memberId?: string
  /** UNVERIFIED: position fields may exist (favoritePosition, proPos). */
  proName?: string
  proPos?: string
  [key: string]: unknown
}

/** UNVERIFIED: Top-level response from the member stats endpoint. */
export interface EaMemberStatsResponse {
  members?: EaMemberStats[]
  [key: string]: unknown
}

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
