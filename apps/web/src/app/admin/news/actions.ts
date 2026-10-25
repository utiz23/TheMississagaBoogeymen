'use server'

import { revalidatePath } from 'next/cache'
import { setNewsEnabled, setPressLevel, softDeleteNewsItem } from '@eanhl/db/queries'
import { PRESS_LEVELS, type PressLevel } from '@eanhl/db/schema'
import { requireAdmin } from '@/lib/auth'
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

export async function setNewsEnabledAction(on: boolean): Promise<void> {
  await requireAdmin()
  await setNewsEnabled(on === true)
  refresh()
}

export async function deleteNewsItemAction(id: number): Promise<void> {
  await requireAdmin()
  if (!Number.isInteger(id) || id < 1) return
  await softDeleteNewsItem(id)
  refresh()
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
