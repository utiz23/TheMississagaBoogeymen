import { nightKey } from '@eanhl/db/news'
import {
  getLatestMatchId,
  getPressBoxNow,
  getPressBoxSettings,
  latestPressNight,
  listDisabledReporters,
  listNewsPlayerGames,
  listPressBoxAudit,
  listPressRoster,
  listRecentPressBoxRequests,
  listRecentStorylines,
  listRelationships,
  monthNewsSpendUsd,
} from '@eanhl/db/queries'
import { monthlyLimitUsd } from '@/lib/news/admin-display'
import { playerGameFromRow } from '@/lib/news/players'
import { currentTitle, hotAndCold, milestonesInReach, type FormPlayer } from './form'

/** The share of the monthly limit at which the press extras (scrums, interviews) stop. */
export const EXTRAS_STOP_SHARE = 0.8
/** The press service reports every pass (a few seconds apart): older than this means it is not running. */
export const PRESS_SEEN_MAX_MS = 5 * 60_000

/** The heat that applies now: a night heat only for the night it was set for. */
export function activeHeat(
  settings: {
    heat: 'cool' | 'normal' | 'hot'
    heatScope: 'next' | 'night'
    heatNight: string | null
  },
  tonight: string,
): { heat: 'cool' | 'normal' | 'hot'; scope: 'next' | 'night'; expired: boolean } {
  if (settings.heatScope === 'next') return { heat: settings.heat, scope: 'next', expired: false }
  if (settings.heatNight === tonight) return { heat: settings.heat, scope: 'night', expired: false }
  return { heat: 'normal', scope: 'night', expired: settings.heat !== 'normal' }
}

/** Reads everything the overview shows. Read only. */
export async function loadOverview(now: Date) {
  const [
    settings,
    disabled,
    spent,
    nowBox,
    relationships,
    storylines,
    audit,
    requests,
    roster,
    latest,
  ] = await Promise.all([
    getPressBoxSettings(),
    listDisabledReporters(),
    monthNewsSpendUsd(now),
    getPressBoxNow(now),
    listRelationships({ now }).catch(() => []),
    listRecentStorylines(now, 5).catch(() => []),
    // Before migration 0080 is applied these tables do not exist: the page still renders.
    listPressBoxAudit(20).catch(() => []),
    listRecentPressBoxRequests(3).catch(() => []),
    listPressRoster(),
    getLatestMatchId(),
  ])
  const tonight = (await latestPressNight(new Date(now.getTime() - 6 * 3_600_000))) ?? nightKey(now)

  // Form and milestones from the stats the site already has (every member's games, every title).
  const memberIds = roster.map((r) => r.playerId)
  const rows =
    latest === null ? [] : await listNewsPlayerGames({ playerIds: memberIds, lastMatchId: latest })
  const byPlayer = new Map<number, ReturnType<typeof playerGameFromRow>[]>()
  for (const r of rows) {
    const list = byPlayer.get(r.playerId) ?? []
    list.push(playerGameFromRow(r))
    byPlayer.set(r.playerId, list)
  }
  const players: FormPlayer[] = roster
    .filter((r) => r.pressLevel !== 'out')
    .map((r) => ({ playerId: r.playerId, name: r.name, games: byPlayer.get(r.playerId) ?? [] }))
  const title = currentTitle(players)

  return {
    settings,
    heat: activeHeat(settings, tonight),
    disabled,
    spent,
    limit: monthlyLimitUsd(process.env['NEWS_MONTHLY_LIMIT_USD']),
    now: nowBox,
    relationships: relationships.slice(0, 5),
    storylines,
    audit,
    requests,
    form: hotAndCold(players, title, now),
    milestones: milestonesInReach(players, title).slice(0, 6),
  }
}
