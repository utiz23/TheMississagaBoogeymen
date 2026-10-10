/**
 * Member logins: the Better Auth instance and the session helpers.
 *
 * Discord only, invite-only. The security gate is `user.create.before`: a user
 * row is created only while the OAuth state carries a usable invite token, and
 * `user.create.after` links the invited player and role in one transaction
 * (deleting the user if that fails). `session.create.before` refuses a session
 * to any user without a player claim, so a half-created user can never sign in.
 * Pure settings live in ./auth-config.ts. Plan:
 * docs/superpowers/plans/2026-10-09-member-logins-step-1.md.
 */

import { cache } from 'react'
import { betterAuth } from 'better-auth'
import { APIError, getOAuthState } from 'better-auth/api'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { nextCookies } from 'better-auth/next-js'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { accounts, db, sessions, users, verifications } from '@eanhl/db'
import {
  acceptInviteForNewUser,
  deleteAccountUser,
  evaluateInvite,
  getAccountInviteByToken,
  getAccountUserById,
  type InviteStatus,
} from '@eanhl/db/queries'
import {
  DISABLED_AUTH_PATHS,
  customDiscordAvatar,
  DISCORD_SCOPES,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  mapDiscordProfile,
  readAuthEnv,
  type DiscordProfile,
} from './auth-config.ts'

/** The invite token travels in Better Auth's server-side OAuth state. */
async function inviteTokenFromState(): Promise<string | null> {
  const state = await getOAuthState()
  const token: unknown = state?.['inviteToken']
  return typeof token === 'string' && token.length > 0 ? token : null
}

function refuse(code: string): never {
  // The message becomes the `?error=` code on /login (see loginErrorMessage).
  throw new APIError('FORBIDDEN', { message: code })
}

function createAuth() {
  const env = readAuthEnv()
  return betterAuth({
    baseURL: env.baseURL,
    secret: env.secret,
    telemetry: { enabled: false },
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    emailAndPassword: { enabled: false },
    socialProviders: {
      discord: {
        clientId: env.discordClientId,
        clientSecret: env.discordClientSecret,
        disableDefaultScope: true,
        scope: [...DISCORD_SCOPES],
        // Sign-in never creates a user unless the request asks to sign up,
        // which only the invite flow does — and the hook below still checks.
        disableImplicitSignUp: true,
        // Each sign-in refreshes the display name and avatar link from Discord.
        overrideUserInfoOnSignIn: true,
        mapProfileToUser: (profile) => mapDiscordProfile(profile as DiscordProfile),
      },
    },
    account: {
      accountLinking: { enabled: false },
      updateAccountOnSignIn: false,
    },
    user: {
      additionalFields: {
        role: { type: 'string', required: false, defaultValue: 'user', input: false },
        disabledAt: { type: 'date', required: false, input: false },
      },
    },
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    rateLimit: {
      enabled: true,
      storage: 'memory',
      window: 60,
      max: 30,
      customRules: {
        '/sign-in/social': { window: 60, max: 10 },
        '/callback/*': { window: 60, max: 10 },
      },
    },
    advanced: {
      // Behind the Cloudflare tunnel the visitor's address is cf-connecting-ip.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
      useSecureCookies: env.baseURL.startsWith('https://'),
    },
    onAPIError: { errorURL: `${env.baseURL}/login` },
    disabledPaths: [...DISABLED_AUTH_PATHS],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const token = await inviteTokenFromState()
            if (token === null) refuse('signup_disabled')
            const status = evaluateInvite(await getAccountInviteByToken(token))
            if (status !== 'ok') refuse(`invite_${status}`)
            // The role comes from the invite, set after creation — never from
            // input. Only a custom Discord avatar link is kept.
            return {
              data: {
                ...user,
                image: customDiscordAvatar(user.image),
                role: 'user',
                disabledAt: null,
              },
            }
          },
          after: async (user) => {
            const token = await inviteTokenFromState()
            let status: InviteStatus | 'error'
            try {
              status =
                token === null
                  ? 'not_found'
                  : await acceptInviteForNewUser({ token, userId: user.id })
            } catch {
              status = 'error'
            }
            if (status !== 'ok') {
              // Any failure — a refused invite or a thrown query — removes the
              // half-created user, so the Discord account isn't left stranded
              // (unable to sign in, yet never offered sign-up again).
              await deleteAccountUser(user.id).catch(() => undefined)
              refuse(`invite_${status}`)
            }
          },
        },
        update: {
          // The sign-in refresh: same avatar rule as on creation.
          before: async (data) =>
            'image' in data ? { data: { ...data, image: customDiscordAvatar(data.image) } } : true,
        },
      },
      account: {
        create: {
          // Discord tokens are never kept: the site doesn't call Discord later.
          before: async (account) => ({
            data: {
              ...account,
              accessToken: null,
              refreshToken: null,
              idToken: null,
              accessTokenExpiresAt: null,
              refreshTokenExpiresAt: null,
            },
          }),
        },
      },
      session: {
        create: {
          before: async (session) => {
            const userId = typeof session.userId === 'string' ? session.userId : null
            if (userId === null) return false
            const user = await getAccountUserById(userId)
            if (!user || user.disabledAt !== null || user.playerId === null) return false
            // Data minimisation: sessions don't record IP or browser.
            return { data: { ...session, ipAddress: null, userAgent: null } }
          },
        },
      },
    },
    plugins: [nextCookies()],
  })
}

let instance: ReturnType<typeof createAuth> | null = null

/** Built on first use, so a misconfiguration fails the auth routes, not the build. */
export function getAuth() {
  instance ??= createAuth()
  return instance
}

export type Viewer = NonNullable<Awaited<ReturnType<typeof getAccountUserById>>>

/**
 * The signed-in member for this request, or null. Cached per request so a page
 * and its components share one lookup. Disabled or unlinked users count as
 * signed out.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() })
  if (!session) return null
  const user = await getAccountUserById(session.user.id)
  if (!user || user.disabledAt !== null || user.playerId === null) return null
  return user
})

/** The current request's session id (for "sign everyone else out"), or null. */
export async function getCurrentSessionId(): Promise<string | null> {
  const session = await getAuth().api.getSession({ headers: await headers() })
  return session?.session.id ?? null
}

export async function requireUser(): Promise<Viewer> {
  const user = await getViewer()
  if (!user) redirect('/login')
  return user
}

export async function requireAdmin(): Promise<Viewer> {
  const user = await requireUser()
  if (user.role !== 'admin') redirect('/account')
  return user
}
