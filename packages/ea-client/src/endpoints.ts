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
  EaMatchesResponse,
  EaMemberStatsResponse,
  EaMemberSearchResponse,
  EaClubSeasonalStatsResponse,
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
