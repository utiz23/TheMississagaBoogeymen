'use server'

import { revalidatePath } from 'next/cache'
import {
  createAccountInvite,
  listInvitablePlayers,
  revokeAccountInvite,
  revokeUserSessions,
  setAccountDisabled,
} from '@eanhl/db/queries'
import { requireAdmin } from '@/lib/auth'
import { readAuthEnv } from '@/lib/auth-config'
import { formatClubDateTime } from '@/lib/format'
import { INVITE_LIFETIMES, type CreateInviteState } from './invite-form'

/**
 * Admin-only account actions behind /admin/accounts. Every action re-checks
 * the caller is a signed-in admin — a Server Action is reachable by its id
 * whether or not the page rendered its form.
 */

export async function createInviteAction(
  _previous: CreateInviteState,
  formData: FormData,
): Promise<CreateInviteState> {
  const admin = await requireAdmin()

  const playerId = Number(formData.get('playerId'))
  const role = formData.get('role') === 'admin' ? 'admin' : 'user'
  const lifetime = String(formData.get('hours'))
  const hours = INVITE_LIFETIMES[lifetime] ?? null
  if (!Number.isInteger(playerId) || playerId < 1 || hours === null) {
    return { status: 'error', message: 'Pick a player and how long the link works.' }
  }

  const player = (await listInvitablePlayers()).find((p) => p.id === playerId)
  if (!player) return { status: 'error', message: 'That player can’t be invited.' }
  if (player.isClaimed) {
    return { status: 'error', message: `${player.gamertag} already has a member account.` }
  }

  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000)
  const { token } = await createAccountInvite({
    role,
    claimedPlayerId: playerId,
    invitedByUserId: admin.id,
    expiresAt,
  })
  revalidatePath('/admin/accounts')
  return {
    status: 'ok',
    url: `${readAuthEnv().baseURL}/invite/${token}`,
    gamertag: player.gamertag,
    expires: formatClubDateTime(expiresAt) ?? '',
  }
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const inviteId = formData.get('inviteId')
  if (typeof inviteId === 'string' && inviteId.length > 0) await revokeAccountInvite(inviteId)
  revalidatePath('/admin/accounts')
}

export async function setUserDisabledAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin()
  const userId = formData.get('userId')
  const disable = formData.get('disable') === '1'
  // An admin can't lock themselves out.
  if (typeof userId !== 'string' || userId.length === 0 || userId === admin.id) return
  await setAccountDisabled(userId, disable)
  if (disable) await revokeUserSessions(userId)
  revalidatePath('/admin/accounts')
}
