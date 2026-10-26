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
 * never public). It has `send_after` = now, so the news service sends it on its next
 * pass; the site shows it at once. Same reporter and night as the deleted item.
 */
export function correctionItem(
  original: Pick<NewsItemRow, 'reporter' | 'kind' | 'night' | 'isTest'>,
  now: Date,
): NewNewsItem | null {
  if (original.isTest) return null
  return {
    kind: 'post',
    reporter: original.reporter,
    night: original.night,
    body: correctionText(original.reporter, original.kind),
    mentions: [],
    facts: null,
    isTest: false,
    sendAfter: now,
  }
}
