'use server'

import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { UserRole } from '@eanhl/db'
import {
  assignUserPlayerClaim,
  createAccountInvite,
  createInvitedAccount,
  getAccountInviteByToken,
  getUserByEmail,
  isInviteUsable,
  revokeAccountInvite,
  setAccountDisabled,
} from '@eanhl/db/queries'
import { auth, requireAdmin } from '@/lib/auth'

function field(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function roleFromForm(value: string): UserRole {
  return value === 'admin' ? 'admin' : 'user'
}

function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
}

export async function signInWithPassword(formData: FormData) {
  const email = field(formData, 'email').toLowerCase()
  const password = field(formData, 'password')
  if (!email || !password) redirect('/login?error=missing')

  try {
    await auth.api.signInEmail({
      body: { email, password },
      headers: await headers(),
    })
  } catch {
    redirect('/login?error=invalid')
  }
  redirect('/me')
}

export async function signOutCurrentUser() {
  await auth.api.signOut({
    headers: await headers(),
  })
  redirect('/login')
}

export async function acceptInvite(formData: FormData) {
  const token = field(formData, 'token')
  const name = field(formData, 'name')
  const password = field(formData, 'password')

  if (!token || !name || password.length < 8) {
    redirect(`/login?token=${encodeURIComponent(token)}&error=invalid_invite_form`)
  }

  const invite = await getAccountInviteByToken(token)
  if (!invite || !isInviteUsable(invite)) {
    redirect('/login?error=invite_unusable')
  }

  const existing = await getUserByEmail(invite.email)
  if (existing) {
    redirect('/login?error=email_exists')
  }

  const userId = randomUUID()
  const accountId = randomUUID()
  const passwordHash = await hashPassword(password)

  try {
    await createInvitedAccount({
      userId,
      accountId,
      email: invite.email,
      name,
      role: invite.role,
      passwordHash,
      inviteId: invite.id,
      playerId: invite.claimedPlayerId,
      assignedByUserId: invite.invitedByUserId,
    })
  } catch {
    redirect(`/login?token=${encodeURIComponent(token)}&error=accept_failed`)
  }

  await auth.api.signInEmail({
    body: { email: invite.email, password },
    headers: await headers(),
  })
  redirect('/me')
}

/**
 * NOTE — there is deliberately no initial-admin server action in this file.
 *
 * A public "first visitor creates the admin" action was removed: an empty
 * `users` table is not authorization, so anyone who reached /login before the
 * operator did could have taken the account. The initial admin is now created
 * only by the local operator CLI `pnpm --filter worker init-admin`, which
 * requires host + database access. Account creation after that stays
 * invite-only via `acceptInvite` above.
 *
 * Do not reintroduce a web-reachable path to the initial-admin query in
 * @eanhl/db/queries. A regression guard
 * (apps/web/src/lib/no-public-admin-bootstrap.test.ts) fails if anything under
 * apps/web/src references it by name.
 */

export async function createInvite(formData: FormData) {
  const admin = await requireAdmin()
  const email = field(formData, 'email').toLowerCase()
  const role = roleFromForm(field(formData, 'role'))
  const playerId = Number.parseInt(field(formData, 'playerId'), 10)
  const days = Number.parseInt(field(formData, 'expiresInDays') || '7', 10)

  if (!email || !Number.isFinite(playerId) || playerId <= 0) {
    redirect('/admin/accounts?error=invite_invalid')
  }

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + (Number.isFinite(days) && days > 0 ? days : 7))

  let inviteUrl: string
  try {
    const created = await createAccountInvite({
      email,
      role,
      claimedPlayerId: playerId,
      invitedByUserId: admin.id,
      expiresAt,
    })
    inviteUrl = `${appBaseUrl()}/login?token=${encodeURIComponent(created.token)}`
  } catch {
    redirect('/admin/accounts?error=invite_failed')
  }
  redirect(`/admin/accounts?invite=${encodeURIComponent(inviteUrl)}`)
}

export async function revokeInvite(formData: FormData) {
  await requireAdmin()
  const inviteId = field(formData, 'inviteId')
  if (inviteId) await revokeAccountInvite(inviteId)
  redirect('/admin/accounts')
}

export async function setUserDisabled(formData: FormData) {
  const admin = await requireAdmin()
  const userId = field(formData, 'userId')
  const disabled = field(formData, 'disabled') === 'true'
  if (userId && userId !== admin.id) await setAccountDisabled(userId, disabled)
  redirect('/admin/accounts')
}

export async function assignClaim(formData: FormData) {
  const admin = await requireAdmin()
  const userId = field(formData, 'userId')
  const playerId = Number.parseInt(field(formData, 'playerId'), 10)
  if (userId && Number.isFinite(playerId) && playerId > 0) {
    await assignUserPlayerClaim({ userId, playerId, assignedByUserId: admin.id })
  }
  redirect('/admin/accounts')
}
