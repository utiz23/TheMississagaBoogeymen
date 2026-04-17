export { eaFetch, throttle, getApiBaseUrl, getRequestDelayMs, EaApiError } from './client.js'
export type { EaFetchOptions } from './client.js'

export {
  searchClub,
  fetchMatches,
  fetchMemberStats,
  searchMember,
  matchesUrl,
  fetchSeasonalStats,
} from './endpoints.js'
export type {
  ClubSearchParams,
  FetchMatchesParams,
  FetchMemberStatsParams,
  SearchMemberParams,
  FetchSeasonalStatsParams,
} from './endpoints.js'

export type {
  EaPlatform,
  EaMatchType,
  EaClubSearchResult,
  EaClubSearchResponse,
  EaPlayerMatchStats,
  EaMatchClubData,
  EaMatchClubAggregates,
  EaMatch,
  EaMatchesResponse,
  EaMemberStats,
  EaMemberStatsResponse,
  EaMemberSearchResult,
  EaMemberSearchResponse,
  EaClubSeasonalStats,
  EaClubSeasonalStatsResponse,
} from './types.js'
