import {
  claimNewsJob,
  countNightGames,
  getNewsEnabled,
  hasNewsJob,
  insertNewsItem,
  listAdminNewsItems,
  listDiscordDeletions,
  listEndedNights,
  listGameJobCandidates,
  listUndeliveredNewsItems,
  markDiscordDeleted,
  markNewsItemFailed,
  markNewsItemPosted,
  markNewsItemSkipped,
  markNewsJob,
  monthNewsSpendUsd,
  recentReporterSummaries,
  recordNewsUsage,
  reporterActivity,
} from '@eanhl/db/queries'
import { REPORTER_IDS, type ReporterId } from '@eanhl/db/news'
import type { NewsStore } from './cycle.ts'

/**
 * A reply is the second post of the same game job, so its target is among the
 * newest items. Only used when a failed reply is retried.
 */
const REPLY_LOOKUP_LIMIT = 50

const isReporter = (r: string): r is ReporterId => (REPORTER_IDS as readonly string[]).includes(r)

export const newsDbStore: NewsStore = {
  listDiscordDeletions,
  markDiscordDeleted,
  getNewsEnabled,
  monthNewsSpendUsd,
  listUndeliveredNewsItems,
  newsItemReporter: async (id) =>
    (await listAdminNewsItems(REPLY_LOOKUP_LIMIT)).find((i) => i.id === id)?.reporter ?? null,
  listGameJobCandidates,
  listEndedNights,
  countNightGames,
  claimNewsJob,
  markNewsJob,
  hasNewsJob,
  insertNewsItem,
  markNewsItemPosted,
  markNewsItemFailed,
  markNewsItemSkipped,
  reporterActivity: async (args) =>
    (await reporterActivity(args)).flatMap((a) =>
      isReporter(a.reporter) ? [{ ...a, reporter: a.reporter }] : [],
    ),
  recentReporterSummaries,
  recordNewsUsage,
}
