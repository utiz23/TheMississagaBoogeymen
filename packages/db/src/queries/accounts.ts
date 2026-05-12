import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../client.js'
import {
  accounts,
  accountInvites,
  players,
  userPlayerClaims,
  users,
  type UserRole,
} from '../schema/index.js'

export function hashAccountInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function createAccountInvite(args: {
  email: string
  role: UserRole
  claimedPlayerId: number
  invitedByUserId: string
  expiresAt: Date
}) {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashAccountInviteToken(token)
  const id = randomUUID()

  const rows = await db
    .insert(accountInvites)
    .values({
      id,
      tokenHash,
      email: normalizeEmail(args.email),
      role: args.role,
      claimedPlayerId: args.claimedPlayerId,
      invitedByUserId: args.invitedByUserId,
      expiresAt: args.expiresAt,
    })
    .returning()

  return { invite: rows[0]!, token }
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
    })
    .from(accountInvites)
    .innerJoin(players, eq(accountInvites.claimedPlayerId, players.id))
    .where(eq(accountInvites.tokenHash, tokenHash))
    .limit(1)
  return rows[0] ?? null
}

export function isInviteUsable(invite: {
  expiresAt: Date
  acceptedAt: Date | null
  revokedAt: Date | null
}): boolean {
  return invite.acceptedAt === null && invite.revokedAt === null && invite.expiresAt > new Date()
}

export async function markInviteAcceptedAndAssignPlayer(args: {
  inviteId: string
  userId: string
  playerId: number
  assignedByUserId: string
}) {
  await db.transaction(async (tx) => {
    await tx
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

    await tx
      .update(accountInvites)
      .set({ acceptedAt: new Date(), acceptedByUserId: args.userId })
      .where(and(eq(accountInvites.id, args.inviteId), isNull(accountInvites.acceptedAt)))
  })
}

export async function createInvitedAccount(args: {
  userId: string
  accountId: string
  email: string
  name: string
  role: UserRole
  passwordHash: string
  inviteId: string
  playerId: number
  assignedByUserId: string
}) {
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: args.userId,
      email: normalizeEmail(args.email),
      name: args.name,
      role: args.role,
      emailVerified: true,
    })

    await tx.insert(accounts).values({
      id: args.accountId,
      accountId: args.userId,
      providerId: 'credential',
      userId: args.userId,
      password: args.passwordHash,
    })

    await tx.insert(userPlayerClaims).values({
      userId: args.userId,
      playerId: args.playerId,
      assignedByUserId: args.assignedByUserId,
    })

    await tx
      .update(accountInvites)
      .set({ acceptedAt: new Date(), acceptedByUserId: args.userId })
      .where(and(eq(accountInvites.id, args.inviteId), isNull(accountInvites.acceptedAt)))
  })
}

export async function createBootstrapAdmin(args: {
  userId: string
  accountId: string
  email: string
  name: string
  passwordHash: string
  playerId: number
}) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`lock table ${users} in exclusive mode`)

    const existing = await tx.select({ n: sql<number>`count(*)::int` }).from(users)
    if ((existing[0]?.n ?? 0) > 0) {
      throw new Error('Bootstrap admin already exists')
    }

    await tx.insert(users).values({
      id: args.userId,
      email: normalizeEmail(args.email),
      name: args.name,
      role: 'admin',
      emailVerified: true,
    })

    await tx.insert(accounts).values({
      id: args.accountId,
      accountId: args.userId,
      providerId: 'credential',
      userId: args.userId,
      password: args.passwordHash,
    })

    await tx.insert(userPlayerClaims).values({
      userId: args.userId,
      playerId: args.playerId,
      assignedByUserId: args.userId,
    })
  })
}

export async function hasAccountUsers(): Promise<boolean> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(users)
  return (rows[0]?.n ?? 0) > 0
}

export async function setUserRole(userId: string, role: UserRole) {
  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId))
}

export async function getUserByEmail(email: string) {
  const rows = await db.select().from(users).where(eq(users.email, normalizeEmail(email))).limit(1)
  return rows[0] ?? null
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

export async function listClaimablePlayers() {
  return db
    .select({
      id: players.id,
      gamertag: players.gamertag,
      isClaimed: sql<boolean>`${userPlayerClaims.userId} is not null`,
    })
    .from(players)
    .leftJoin(userPlayerClaims, eq(players.id, userPlayerClaims.playerId))
    .orderBy(players.gamertag)
}
