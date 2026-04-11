export { eaFetch, throttle, getApiBaseUrl, getRequestDelayMs, EaApiError } from './client.js'
export type { EaFetchOptions } from './client.js'

export {
  searchClub,
  fetchMatches,
  fetchMemberStats,
  searchMember,
  matchesUrl,
} from './endpoints.js'
export type {
  ClubSearchParams,
  FetchMatchesParams,
  FetchMemberStatsParams,
  SearchMemberParams,
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
} from './types.js'
