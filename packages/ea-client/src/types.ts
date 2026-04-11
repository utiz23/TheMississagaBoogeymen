/**
 * EA Pro Clubs API — TypeScript response types.
 *
 * ⚠ UNVERIFIED: These types are provisional, based on the field list in the
 * project blueprint. They have NOT been validated against real API responses.
 *
 * Before Phase 2 transform implementation:
 *   1. Run `pnpm --filter ea-client capture` (or call endpoints manually)
 *   2. Save real responses to __fixtures__/
 *   3. Run contract tests: `pnpm --filter ea-client test`
 *   4. Update these types to match real shapes
 *   5. Remove or update the UNVERIFIED comments for confirmed fields
 *
 * Known EA API quirks (from blueprint):
 *   - Almost all numeric values are returned as strings (e.g. goals: "3")
 *   - Some endpoints may return 400/500 without warning
 *   - The API is undocumented and changes between game releases
 */

// ─── Shared ───────────────────────────────────────────────────────────────────

/** EA platform identifier. */
export type EaPlatform = 'common-gen5' | 'common-gen4' | string

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
 * UNVERIFIED: Stats for a single player within a match.
 * All numeric values are strings per EA API convention.
 *
 * Fields marked DEFERRED need fixture confirmation:
 *   - blazeId presence/stability
 *   - exactfield names for goalie-specific stats
 */
export interface EaPlayerMatchStats {
  /** DEFERRED: Present if blazeId is always included. Nullable until confirmed. */
  blazeId?: string
  /** Player's gamertag / display name. */
  playername: string
  /** Position code. UNVERIFIED: exact values (e.g. 'center', 'C', 'goalie'?) */
  position?: string
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
  /** Goalie fields — UNVERIFIED field names. Only present for goalies. */
  glsaves?: string
  glga?: string
  glshots?: string
  glsavepct?: string
  glgaa?: string
  /** Catch-all for fields not yet identified. */
  [key: string]: unknown
}

/**
 * UNVERIFIED: Club-level aggregate data within a match.
 * One entry per club (our club + opponent).
 */
export interface EaMatchClubData {
  clubId: string
  clubDivision?: string
  /** Score as a string. UNVERIFIED field name. */
  scoreString?: string
  score?: string
  goals?: string
  /** UNVERIFIED: keyed by blazeId or some player identifier. */
  players?: Record<string, EaPlayerMatchStats>
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
 * UNVERIFIED: Top-level shape of a single match in the matches response.
 *
 * CRITICAL UNKNOWNS (resolve in Phase 1 fixture capture):
 *   1. Is `matchId` the field name, or something else?
 *   2. How are our club and opponent distinguished? (by position in array, or by clubId comparison?)
 *   3. Is there a timestamp field? What format?
 *   4. Is there an in-game season field?
 */
export interface EaMatch {
  /** UNVERIFIED: Field name and type. May be 'matchId', 'id', etc. */
  matchId: string
  /** UNVERIFIED: Match timestamp. Format unknown (unix epoch string? ISO string?) */
  timestamp?: string
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
  /** DEFERRED: blazeId may differ between this endpoint and match data. */
  blazeId?: string
  memberId?: string
  proName: string
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
