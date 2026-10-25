import type { NewsItemRow, PressLevelSetBy } from '@eanhl/db/schema'

/** The news service's monthly limit in USD: a positive number, else 10 (same rule as the service). */
export function monthlyLimitUsd(value: string | undefined): number {
  const n = value === undefined || value.trim() === '' ? NaN : Number(value)
  return Number.isFinite(n) && n > 0 ? n : 10
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
