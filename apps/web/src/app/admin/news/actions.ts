'use server'

import { revalidatePath } from 'next/cache'
import {
  getNewsEnabled,
  setNewsEnabled,
  setPressLevel,
  setReporterEnabled,
  skipNewsBacklog,
  softDeleteNewsItem,
  softDeleteNewsItemWithCorrection,
} from '@eanhl/db/queries'
import { PRESS_LEVELS, type PressLevel } from '@eanhl/db/schema'
import { requireAdmin } from '@/lib/auth'
import { parseReporterId } from '@/lib/news/admin-display'
import { switchNewsDesk } from '@/lib/news/switch'
import { pressLevelSetBy } from '@/lib/profile-edit'

/**
 * Admin-only news desk actions behind /admin/news. Each one re-checks the
 * caller is a signed-in admin (a Server Action is reachable by its id), then
 * refreshes the news pages so a change shows at once.
 */

function refresh(): void {
  revalidatePath('/news', 'layout')
  revalidatePath('/admin/news')
}

/** Switching on after off skips the recent backlog first (nothing about the time it was off). */
export async function setNewsEnabledAction(on: boolean): Promise<void> {
  await requireAdmin()
  await switchNewsDesk(on === true, {
    getEnabled: getNewsEnabled,
    setEnabled: setNewsEnabled,
    skipBacklog: skipNewsBacklog,
    now: () => new Date(),
  })
  refresh()
}

export async function deleteNewsItemAction(id: number): Promise<void> {
  await requireAdmin()
  if (!Number.isInteger(id) || id < 1) return
  await softDeleteNewsItem(id)
  refresh()
  revalidatePath(`/admin/news/${String(id)}`)
}

/** "Delete with a correction" (C3b.5): the same reporter posts a one-line correction. */
export async function deleteNewsItemWithCorrectionAction(id: number): Promise<void> {
  await requireAdmin()
  if (!Number.isInteger(id) || id < 1) return
  await softDeleteNewsItemWithCorrection(id)
  refresh()
  revalidatePath(`/admin/news/${String(id)}`)
}

export async function setPressLevelAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin()
  const playerId = Number(formData.get('playerId'))
  const level = formData.get('pressLevel')
  if (!Number.isInteger(playerId) || playerId < 1) return
  if (typeof level !== 'string' || !(PRESS_LEVELS as readonly string[]).includes(level)) return
  await setPressLevel(playerId, level as PressLevel, pressLevelSetBy(admin, playerId))
  refresh()
}

/** Switch one reporter on or off (C3b.3). Off: assignment skips him; his old items stay. */
export async function setReporterEnabledAction(reporter: string, enabled: boolean): Promise<void> {
  await requireAdmin()
  const id = parseReporterId(reporter)
  if (id === null) return
  await setReporterEnabled(id, enabled === true)
  refresh()
}
