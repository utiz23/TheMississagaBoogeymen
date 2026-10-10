'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { listPinCandidates, revokeAllSessionsExcept, setPlayerPinned } from '@eanhl/db/queries'
import { getCurrentSessionId, requireAdmin } from '@/lib/auth'

/**
 * Admin hub actions (release C1). Each re-checks the caller is a signed-in
 * admin: a Server Action is reachable by its id whatever the page rendered.
 */

function playerIdFrom(formData: FormData): number | null {
  const id = Number(formData.get('playerId'))
  return Number.isInteger(id) && id > 0 ? id : null
}

/** Pin a player to the roster: they become a team member (player page, roster, carousel). */
export async function pinPlayerAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = playerIdFrom(formData)
  // Only offered candidates: not an AI goalie, not already a member.
  if (id !== null && (await listPinCandidates()).some((p) => p.id === id)) {
    await setPlayerPinned(id, true)
    revalidatePath('/', 'layout')
  }
  redirect('/admin#roster-pins')
}

export async function unpinPlayerAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = playerIdFrom(formData)
  if (id !== null) {
    await setPlayerPinned(id, false)
    revalidatePath('/', 'layout')
  }
  redirect('/admin#roster-pins')
}

/** End every session but the caller's own. Needs the confirm box ticked. */
export async function signOutEveryoneAction(formData: FormData): Promise<void> {
  await requireAdmin()
  if (formData.get('confirm') !== 'yes') redirect('/admin?signout=unconfirmed#sessions')
  const keep = await getCurrentSessionId()
  if (keep === null) redirect('/login')
  const ended = await revokeAllSessionsExcept(keep)
  redirect(`/admin?signout=${String(ended)}#sessions`)
}
