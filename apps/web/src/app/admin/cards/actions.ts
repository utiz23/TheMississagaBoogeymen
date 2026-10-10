'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { MYTHIC_THEMES, type MythicThemeKey } from '@eanhl/db/cards'
import { awardMythic, clearMythic, listInvitablePlayers, loadCardTitles } from '@eanhl/db/queries'
import { requireAdmin } from '@/lib/auth'

/**
 * Mythic card awards (admin tools C2). Same rules as the `card-mythic` CLI —
 * both call @eanhl/db's awardMythic/clearMythic. Each action re-checks admin.
 */

function intFrom(formData: FormData, name: string): number | null {
  const n = Number(formData.get(name))
  return Number.isInteger(n) && n > 0 ? n : null
}

async function validCard(formData: FormData) {
  const playerId = intFrom(formData, 'playerId')
  const gameTitleId = intFrom(formData, 'gameTitleId')
  if (playerId === null || gameTitleId === null) return null
  const [members, titles] = await Promise.all([listInvitablePlayers(), loadCardTitles()])
  if (!members.some((p) => p.id === playerId)) return null
  if (!titles.some((t) => t.id === gameTitleId)) return null
  return { playerId, gameTitleId }
}

export async function awardMythicAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const card = await validCard(formData)
  const theme = formData.get('theme')
  if (card === null || !(MYTHIC_THEMES as readonly unknown[]).includes(theme)) {
    redirect('/admin/cards?result=invalid')
  }
  await awardMythic({ ...card, theme: theme as MythicThemeKey })
  revalidatePath('/', 'layout')
  redirect('/admin/cards?result=awarded')
}

export async function clearMythicAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const card = await validCard(formData)
  if (card === null) redirect('/admin/cards?result=invalid')
  const cleared = await clearMythic(card)
  revalidatePath('/', 'layout')
  redirect(`/admin/cards?result=${cleared === null ? 'nothing' : 'cleared'}`)
}
