import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../client.js'
import { evaluateInvite, type InviteStatus } from '../lib/invite-status.js'
import {
  accountInvites,
  players,
  sessions,
  userPlayerClaims,
  users,
  type UserRole,
} from '../schema/index.js'

export { evaluateInvite, type InviteStatus } from '../lib/invite-status.js'

export function hashAccountInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Mint an invite bound to one player. Only the token's hash is stored; the raw
 * token is returned once for the caller to put in the invite link.
 *
 * Any other still-pending invite for the same player is revoked in the same
 * transaction, so a player only ever has one live link (re-running the
 * bootstrap CLI after a link expires just replaces it).
 *
 * `invitedByUserId` NULL = the operator's bootstrap CLI (no users exist yet).
 * `email` is legacy: Discord invites carry none.
 */
export async function createAccountInvite(args: {
  role: UserRole
  claimedPlayerId: number
  invitedByUserId: string | null
  expiresAt: Date
  email?: string | null
}) {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashAccountInviteToken(token)
  const id = randomUUID()

  const invite = await db.transaction(async (tx) => {
    await tx
      .update(accountInvites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(accountInvites.claimedPlayerId, args.claimedPlayerId),
          isNull(accountInvites.acceptedAt),
          isNull(accountInvites.revokedAt),
        ),
      )

    const rows = await tx
      .insert(accountInvites)
      .values({
        id,
        tokenHash,
        email: args.email ? normalizeEmail(args.email) : null,
        role: args.role,
        claimedPlayerId: args.claimedPlayerId,
        invitedByUserId: args.invitedByUserId,
        expiresAt: args.expiresAt,
      })
      .returning()
    return rows[0]!
  })

  return { invite, token }
}

export async function getAccountInviteByToken(token: string) {
  const tokenHash = hashAccountInviteToken(token)
  const rows = await db
    .select({
      id: accountInvites.id,
      email: accountInvites.email,
      role: accountInvites.role,
      claimedPlayerId: accountInvites.claimedPlayerId,
      claimedPlayerGamertag: players.gamertag,
      invitedByUserId: accountInvites.invitedByUserId,
      expiresAt: accountInvites.expiresAt,
      acceptedAt: accountInvites.acceptedAt,
      revokedAt: accountInvites.revokedAt,
      createdAt: accountInvites.createdAt,
      playerClaimed: sql<boolean>`${userPlayerClaims.userId} is not null`,
    })
    .from(accountInvites)
    .innerJoin(players, eq(accountInvites.claimedPlayerId, players.id))
    .leftJoin(userPlayerClaims, eq(userPlayerClaims.playerId, accountInvites.claimedPlayerId))
    .where(eq(accountInvites.tokenHash, tokenHash))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Accept an invite for a user Better Auth has just created (the Discord
 * sign-up hook). One transaction: lock the invite row, re-check it, link the
 * user to the invited player, give them the invite's role, mark it accepted.
 *
 * Returns the invite status instead of throwing on a business rule, so the
 * caller can delete the half-created user and show a specific reason. The
 * unique index on user_player_claims.player_id backs the `player_claimed`
 * check against a concurrent accept.
 */
export async function acceptInviteForNewUser(args: {
  token: string
  userId: string
}): Promise<InviteStatus> {
  const tokenHash = hashAccountInviteToken(args.token)
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(accountInvites)
      .where(eq(accountInvites.tokenHash, tokenHash))
      .for('update')
      .limit(1)
    const invite = rows[0]
    if (!invite) return 'not_found'

    const owner = await tx
      .select({ userId: userPlayerClaims.userId })
      .from(userPlayerClaims)
      .where(eq(userPlayerClaims.playerId, invite.claimedPlayerId))
      .limit(1)
    const status = evaluateInvite({ ...invite, playerClaimed: owner.length > 0 })
    if (status !== 'ok') return status

    await tx.insert(userPlayerClaims).values({
      userId: args.userId,
      playerId: invite.claimedPlayerId,
      assignedByUserId: invite.invitedByUserId ?? args.userId,
    })
    await tx
      .update(users)
      .set({ role: invite.role, updatedAt: new Date() })
      .where(eq(users.id, args.userId))
    await tx
      .update(accountInvites)
      .set({ acceptedAt: new Date(), acceptedByUserId: args.userId })
      .where(eq(accountInvites.id, invite.id))
    return 'ok'
  })
}

/** Remove a user outright; their accounts, sessions and claim cascade. */
export async function deleteAccountUser(userId: string) {
  await db.delete(users).where(eq(users.id, userId))
}

/** Sign a user out everywhere (used when an admin disables them). */
export async function revokeUserSessions(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId))
}

export async function hasAdminUser(): Promise<boolean> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.role, 'admin'))
  return (rows[0]?.n ?? 0) > 0
}

export async function setUserRole(userId: string, role: UserRole) {
  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId))
}

export async function getAccountUserById(userId: string) {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt,
      playerId: userPlayerClaims.playerId,
      gamertag: players.gamertag,
    })
    .from(users)
    .leftJoin(userPlayerClaims, eq(users.id, userPlayerClaims.userId))
    .leftJoin(players, eq(userPlayerClaims.playerId, players.id))
    .where(eq(users.id, userId))
    .limit(1)
  return rows[0] ?? null
}

export async function listAccountUsers() {
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt,
      playerId: userPlayerClaims.playerId,
      gamertag: players.gamertag,
    })
    .from(users)
    .leftJoin(userPlayerClaims, eq(users.id, userPlayerClaims.userId))
    .leftJoin(players, eq(userPlayerClaims.playerId, players.id))
    .orderBy(desc(users.createdAt))
}

export async function listAccountInvites() {
  return db
    .select({
      id: accountInvites.id,
      email: accountInvites.email,
      role: accountInvites.role,
      claimedPlayerId: accountInvites.claimedPlayerId,
      claimedPlayerGamertag: players.gamertag,
      expiresAt: accountInvites.expiresAt,
      acceptedAt: accountInvites.acceptedAt,
      revokedAt: accountInvites.revokedAt,
      createdAt: accountInvites.createdAt,
    })
    .from(accountInvites)
    .innerJoin(players, eq(accountInvites.claimedPlayerId, players.id))
    .orderBy(desc(accountInvites.createdAt))
}

export async function revokeAccountInvite(inviteId: string) {
  await db
    .update(accountInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(accountInvites.id, inviteId), isNull(accountInvites.acceptedAt)))
}

export async function setAccountDisabled(userId: string, disabled: boolean) {
  await db
    .update(users)
    .set({ disabledAt: disabled ? new Date() : null, updatedAt: new Date() })
    .where(eq(users.id, userId))
}

export async function assignUserPlayerClaim(args: {
  userId: string
  playerId: number
  assignedByUserId: string
}) {
  await db
    .insert(userPlayerClaims)
    .values({
      userId: args.userId,
      playerId: args.playerId,
      assignedByUserId: args.assignedByUserId,
    })
    .onConflictDoUpdate({
      target: userPlayerClaims.userId,
      set: {
        playerId: args.playerId,
        assignedByUserId: args.assignedByUserId,
        assignedAt: new Date(),
      },
    })
}
