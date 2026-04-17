export { eaFetch, throttle, getApiBaseUrl, getRequestDelayMs, EaApiError } from './client.js'
export type { EaFetchOptions } from './client.js'

export {
  searchClub,
  fetchMatches,
  fetchMemberStats,
  searchMember,
  matchesUrl,
  fetchClubInfo,
  fetchSeasonalStats,
  fetchSeasonRank,
  fetchSettings,
} from './endpoints.js'
export type {
  ClubSearchParams,
  FetchMatchesParams,
  FetchMemberStatsParams,
  SearchMemberParams,
  FetchClubInfoParams,
  FetchSeasonalStatsParams,
  FetchSeasonRankParams,
  FetchSettingsParams,
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
  EaClubInfoEntry,
  EaClubInfoResponse,
  EaClubSeasonalStats,
  EaClubSeasonalStatsResponse,
  EaClubSeasonRankEntry,
  EaClubSeasonRankResponse,
  EaSettingsDivisionEntry,
  EaSettingsResponse,
} from './types.js'
