/**
 * Why a member invite can or can't be accepted right now. Pure, so the web's
 * invite page, the sign-up gate and the acceptance transaction all apply the
 * same rule (plan: docs/superpowers/plans/2026-10-09-member-logins-step-1.md).
 */
export type InviteStatus =
  | 'ok'
  | 'not_found'
  | 'accepted'
  | 'revoked'
  | 'expired'
  | 'player_claimed'

export interface InviteStatusInput {
  expiresAt: Date
  acceptedAt: Date | null
  revokedAt: Date | null
  /** Another account already owns the invited player. */
  playerClaimed: boolean
}

export function evaluateInvite(
  invite: InviteStatusInput | null,
  now: Date = new Date(),
): InviteStatus {
  if (invite === null) return 'not_found'
  if (invite.acceptedAt !== null) return 'accepted'
  if (invite.revokedAt !== null) return 'revoked'
  if (invite.expiresAt <= now) return 'expired'
  if (invite.playerClaimed) return 'player_claimed'
  return 'ok'
}
