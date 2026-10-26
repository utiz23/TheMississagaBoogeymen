import type { NewNewsItem, NewsItemRow } from '../schema/index.js'
import { REPORTERS, type ReporterId } from './reporters.js'

/**
 * The one-line correction a reporter posts after the admin deletes an item for a
 * wrong fact (spec §12.18-6). Built in code: no Claude call, nothing invented.
 */
export function correctionText(reporter: ReporterId, kind: 'post' | 'article'): string {
  return `Correction: an earlier ${kind} from ${REPORTERS[reporter].name} had a wrong fact and was removed.`
}

/**
 * The correction post for a deleted item, or null when none is wanted (a test item was
 * never public). The site shows it at once. It goes to Discord only when the deleted
 * item had a Discord message: then `send_after` = now and the news service sends it on
 * its next pass; otherwise it is marked skipped ("site only"). Same reporter and night
 * as the deleted item. `isCorrection` keeps it out of the reporters' activity and counts.
 */
export function correctionItem(
  original: Pick<NewsItemRow, 'reporter' | 'kind' | 'night' | 'isTest' | 'discordMessageId'>,
  now: Date,
  rulesVersion: string,
): NewNewsItem | null {
  if (original.isTest) return null
  const onDiscord = original.discordMessageId !== null
  return {
    kind: 'post',
    reporter: original.reporter,
    night: original.night,
    body: correctionText(original.reporter, original.kind),
    mentions: [],
    facts: null,
    isTest: false,
    isCorrection: true,
    rulesVersion,
    ...(onDiscord
      ? { sendAfter: now }
      : {
          discordStatus: 'skipped' as const,
          lastError: 'site only: the deleted item was never on Discord',
        }),
  }
}
