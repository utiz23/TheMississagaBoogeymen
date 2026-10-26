import { REPORTER_IDS, type ReporterId } from '@eanhl/db/news'
import type { NewsItemRow, PressLevelSetBy } from '@eanhl/db/schema'

/** The news service's monthly limit in USD: a positive number, else 20 (same rule as the service). */
export function monthlyLimitUsd(value: string | undefined): number {
  const n = value === undefined || value.trim() === '' ? NaN : Number(value)
  return Number.isFinite(n) && n > 0 ? n : 20
}

/** What the admin list shows for an item: the headline of an article, else the start of the text. */
export function itemPreview(item: Pick<NewsItemRow, 'kind' | 'headline' | 'body'>): string {
  if (item.kind === 'article' && item.headline !== null && item.headline.trim() !== '') {
    return item.headline.trim()
  }
  const text = item.body.replace(/\s+/g, ' ').trim()
  return text.length > 120 ? `${text.slice(0, 120).trimEnd()}…` : text
}

/** Who chose a press level, for the admin table. */
export function pressLevelSetByLabel(setBy: PressLevelSetBy | null): string {
  if (setBy === 'admin') return 'set by you'
  if (setBy === 'self') return 'by the player'
  return 'default'
}

/** The `[id]` of /admin/news/[id]: a positive whole number written in digits, else null. */
export function parseAdminItemId(raw: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
}

/** The item's link on the admin list. */
export function adminItemHref(id: number): string {
  return `/admin/news/${String(id)}`
}

/** The rules version on the admin item page; older items were written before versions existed. */
export function rulesVersionLabel(version: string | null): string {
  return version !== null && version.trim() !== '' ? version : 'before versions'
}

/** A reporter id from a form or an action argument, or null when it is none of the nine. */
export function parseReporterId(value: unknown): ReporterId | null {
  return typeof value === 'string' && (REPORTER_IDS as readonly string[]).includes(value)
    ? (value as ReporterId)
    : null
}
