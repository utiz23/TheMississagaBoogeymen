'use server'

import { revalidatePath } from 'next/cache'
import { updatePlayerProfile } from '@eanhl/db/queries'
import { getViewer } from '@/lib/auth'
import { canEditPlayerCard } from '@/lib/card-permissions'
import { parseProfileForm, type ProfileFormState } from '@/lib/profile-edit'

/**
 * Save a player's profile from the EDIT PROFILE form. Re-checks everything:
 * a signed-in member on their own player edits the four self fields; an
 * admin edits any player, including position, archetype and club role.
 */
export async function saveProfileAction(
  playerId: number,
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const viewer = await getViewer()
  if (viewer === null || !canEditPlayerCard(viewer, playerId)) {
    return { status: 'error', message: 'Only this player can edit their profile.', errors: {} }
  }
  if (!Number.isInteger(playerId) || playerId < 1) {
    return { status: 'error', message: 'Unknown player.', errors: {} }
  }

  const get = (name: string) => {
    const v = formData.get(name)
    return typeof v === 'string' ? v : null
  }
  const parsed = parseProfileForm(get, viewer.role === 'admin')
  if (!parsed.ok) {
    return { status: 'error', message: 'Check the highlighted fields.', errors: parsed.errors }
  }

  try {
    await updatePlayerProfile(playerId, parsed.patch)
  } catch {
    return { status: 'error', message: 'Saving failed. Please try again.', errors: {} }
  }
  // Names, jerseys and flags appear across the site (cards, home, stats, games).
  revalidatePath('/', 'layout')
  return { status: 'saved', at: Date.now() }
}
