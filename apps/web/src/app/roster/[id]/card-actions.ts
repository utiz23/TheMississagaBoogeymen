'use server'

import { revalidatePath } from 'next/cache'
import { CARD_THEME_ORDER, isThemeEquippable, type CardThemeKey } from '@eanhl/db/cards'
import { getPlayerCardProgress, setPlayerCardPref } from '@eanhl/db/queries'
import { getViewer } from '@/lib/auth'
import { canEditPlayerCard } from '@/lib/card-permissions'

export type EquipResult = { ok: true } | { ok: false; message: string }

/**
 * Equip a card theme on a player's card, or `null` for AUTO (follow tier).
 * Everything is re-checked here — a Server Action is reachable by its id
 * whatever the page rendered: a signed-in member on their own player (or an
 * admin), a known theme, and one this player's newest card can wear.
 */
export async function equipCardTheme(
  playerId: number,
  theme: CardThemeKey | null,
): Promise<EquipResult> {
  const viewer = await getViewer()
  if (!canEditPlayerCard(viewer, playerId) || viewer === null) {
    return { ok: false, message: 'Sign in as this player to equip a theme.' }
  }
  if (!Number.isInteger(playerId) || playerId < 1) {
    return { ok: false, message: 'Unknown player.' }
  }
  if (theme !== null && !(CARD_THEME_ORDER as readonly string[]).includes(theme)) {
    return { ok: false, message: 'Unknown theme.' }
  }
  if (theme !== null) {
    const { standing } = await getPlayerCardProgress(playerId, 0)
    if (standing === null || !isThemeEquippable(theme, standing.tier, standing.mythicTheme)) {
      return { ok: false, message: 'That theme isn’t unlocked on this card.' }
    }
  }

  await setPlayerCardPref({ playerId, theme, userId: viewer.id })
  // Every surface that shows the card: the player page, the roster, home.
  revalidatePath(`/roster/${String(playerId)}`)
  revalidatePath('/roster')
  revalidatePath('/')
  return { ok: true }
}
