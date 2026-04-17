/**
 * EA Pro Clubs API — typed endpoint functions.
 *
 * Each function maps to one EA API endpoint. All are thin wrappers around
 * eaFetch — no transformation happens here. Raw payloads are returned as-is
 * for storage in raw_match_payloads before any parsing.
 *
 * ⚠ Return types are marked UNVERIFIED until fixture-driven contract tests
 * confirm the actual response shapes.
 */

import { eaFetch, getApiBaseUrl, type EaFetchOptions } from './client.js'
import type {
  EaClubSearchResponse,
  EaClubInfoResponse,
  EaMatchesResponse,
  EaMemberStatsResponse,
  EaMemberSearchResponse,
  EaClubSeasonalStatsResponse,
  EaClubSeasonRankResponse,
  EaSettingsResponse,
  EaMatchType,
  EaPlatform,
} from './types.js'

// ─── Club Search ──────────────────────────────────────────────────────────────

export interface ClubSearchParams {
  platform: EaPlatform
  clubName: string
  baseUrl?: string
}

/**
 * Search for a club by name.
 * Used once during setup to discover our club ID, then cached.
 *
 * UNVERIFIED: Response shape needs fixture confirmation.
 */
export async function searchClub(
  params: ClubSearchParams,
  options?: EaFetchOptions,
): Promise<EaClubSearchResponse> {
  const base = getApiBaseUrl(params.baseUrl)
  const url = `${base}/clubs/search?platform=${encodeURIComponent(params.platform)}&clubName=${encodeURIComponent(params.clubName)}`
  return eaFetch<EaClubSearchResponse>(url, options)
}

// ─── Matches ──────────────────────────────────────────────────────────────────

export interface FetchMatchesParams {
  platform: EaPlatform
  clubId: string
  matchType: EaMatchType
  baseUrl?: string
}

/**
 * Fetch recent matches for a club.
 * EA only returns the last ~5 matches — must be polled continuously.
 *
 * UNVERIFIED: Response shape needs fixture confirmation.
 * UNKNOWN: Is matchId unique across game titles? (Treat as non-unique until confirmed.)
 */
export async function fetchMatches(
  params: FetchMatchesParams,
  options?: EaFetchOptions,
): Promise<EaMatchesResponse> {
  const base = getApiBaseUrl(params.baseUrl)
  const url = `${base}/clubs/matches?clubIds=${encodeURIComponent(params.clubId)}&platform=${encodeURIComponent(params.platform)}&matchType=${encodeURIComponent(params.matchType)}`
  return eaFetch<EaMatchesResponse>(url, options)
}

/** Returns the full URL used for fetchMatches — stored as source_endpoint in raw_match_payloads. */
export function matchesUrl(params: FetchMatchesParams): string {
  const base = getApiBaseUrl(params.baseUrl)
  return `${base}/clubs/matches?clubIds=${encodeURIComponent(params.clubId)}&platform=${encodeURIComponent(params.platform)}&matchType=${encodeURIComponent(params.matchType)}`
}

// ─── Member Stats ─────────────────────────────────────────────────────────────

export interface FetchMemberStatsParams {
  platform: EaPlatform
  clubId: string
  baseUrl?: string
}

/**
 * Fetch aggregate season stats for all club members.
 * Returns cumulative stats, not per-match.
 *
 * UNVERIFIED: Response shape needs fixture confirmation.
 * DEFERRED: Verify whether blazeId is present and matches match-level player data.
 */
export async function fetchMemberStats(
  params: FetchMemberStatsParams,
  options?: EaFetchOptions,
): Promise<EaMemberStatsResponse> {
  const base = getApiBaseUrl(params.baseUrl)
  const url = `${base}/members/stats?clubId=${encodeURIComponent(params.clubId)}&platform=${encodeURIComponent(params.platform)}`
  return eaFetch<EaMemberStatsResponse>(url, options)
}

// ─── Member Search ────────────────────────────────────────────────────────────

export interface SearchMemberParams {
  platform: EaPlatform
  memberName: string
  baseUrl?: string
}

/**
 * Search for a member by gamertag.
 * Useful for manual player lookups and identity verification.
 *
 * UNVERIFIED: Response shape needs fixture confirmation.
 */
export async function searchMember(
  params: SearchMemberParams,
  options?: EaFetchOptions,
): Promise<EaMemberSearchResponse> {
  const base = getApiBaseUrl(params.baseUrl)
  const url = `${base}/members/search?platform=${encodeURIComponent(params.platform)}&memberName=${encodeURIComponent(params.memberName)}`
  return eaFetch<EaMemberSearchResponse>(url, options)
}

// ─── Club Info ────────────────────────────────────────────────────────────────

export interface FetchClubInfoParams {
  platform: EaPlatform
  /** One or more club IDs. Batched into a single request. */
  clubIds: string[]
  baseUrl?: string
}

/**
 * Fetch metadata for one or more clubs by ID.
 * Used to retrieve opponent crest asset IDs for logo display.
 *
 * Response is keyed by club ID string. A club may be absent from the response
 * if the EA API returns no data for it.
 *
 * CONFIRMED: customKit.crestAssetId is the key field for logo display.
 */
export async function fetchClubInfo(
  params: FetchClubInfoParams,
  options?: EaFetchOptions,
): Promise<EaClubInfoResponse> {
  const base = getApiBaseUrl(params.baseUrl)
  const url = `${base}/clubs/info?platform=${encodeURIComponent(params.platform)}&clubIds=${encodeURIComponent(params.clubIds.join(','))}`
  return eaFetch<EaClubInfoResponse>(url, options)
}

// ─── Club Seasonal Stats ──────────────────────────────────────────────────────

export interface FetchSeasonalStatsParams {
  platform: EaPlatform
  clubId: string
  baseUrl?: string
}

/**
 * Fetch seasonal aggregate stats for a club (official EA record).
 * Returns the EA-official W-L-OTL record and ranking points for the current game title.
 *
 * Response is keyed by club ID — use response[clubId] to access the club's data.
 *
 * CONFIRMED response fields: wins, losses, otl, record, rankingPoints, totalGames,
 * goals, goalsAgainst. All values are strings.
 */
export async function fetchSeasonalStats(
  params: FetchSeasonalStatsParams,
  options?: EaFetchOptions,
): Promise<EaClubSeasonalStatsResponse> {
  const base = getApiBaseUrl(params.baseUrl)
  const url = `${base}/clubs/seasonalStats?platform=${encodeURIComponent(params.platform)}&clubIds=${encodeURIComponent(params.clubId)}`
  return eaFetch<EaClubSeasonalStatsResponse>(url, options)
}

// ─── Club Season Rank ─────────────────────────────────────────────────────────

export interface FetchSeasonRankParams {
  platform: EaPlatform
  clubId: string
  baseUrl?: string
}

/**
 * Fetch the current competitive season rank for a club.
 *
 * Returns division placement, season W-L-OTL, points, and projected points.
 * This is NOT the all-time official record — see fetchSeasonalStats for that.
 *
 * UNVERIFIED: Response shape assumed to match clubs/info (Record keyed by club ID).
 * All returned field names are UNVERIFIED — treat all fields as optional.
 */
export async function fetchSeasonRank(
  params: FetchSeasonRankParams,
  options?: EaFetchOptions,
): Promise<EaClubSeasonRankResponse> {
  const base = getApiBaseUrl(params.baseUrl)
  const url = `${base}/clubs/seasonRank?platform=${encodeURIComponent(params.platform)}&clubIds=${encodeURIComponent(params.clubId)}`
  return eaFetch<EaClubSeasonRankResponse>(url, options)
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface FetchSettingsParams {
  platform: EaPlatform
  baseUrl?: string
}

/**
 * Fetch platform-level settings including division thresholds.
 *
 * Returns promotion/relegation point thresholds keyed by division number.
 * Used alongside clubs/seasonRank to display division context.
 *
 * UNVERIFIED: Response shape and all field names from HAR analysis only.
 */
export async function fetchSettings(
  params: FetchSettingsParams,
  options?: EaFetchOptions,
): Promise<EaSettingsResponse> {
  const base = getApiBaseUrl(params.baseUrl)
  const url = `${base}/settings?platform=${encodeURIComponent(params.platform)}`
  return eaFetch<EaSettingsResponse>(url, options)
}
