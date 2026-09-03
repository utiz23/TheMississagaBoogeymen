/**
 * DORMANT — the Better Auth instance and its session helpers, kept for the
 * post-launch account feature.
 *
 * Not imported by anything. This module was `src/lib/auth.ts`; nothing under
 * `src/app/` imports it any more, so no request path constructs Better Auth or
 * opens a session. See ./README.md.
 */

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { nextCookies } from 'better-auth/next-js'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { accounts, db, sessions, users, verifications } from '@eanhl/db'
import { getAccountUserById } from '@eanhl/db/queries'

const baseURL = process.env.BETTER_AUTH_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:3000'
const secret = process.env.BETTER_AUTH_SECRET ?? 'dev-only-change-me-before-production'

export const auth = betterAuth({
  baseURL,
  secret,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'user',
      },
      disabledAt: {
        type: 'date',
        required: false,
        input: false,
      },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const userId = typeof session.userId === 'string' ? session.userId : null
          if (userId === null) return false
          const user = await getAccountUserById(userId)
          if (user?.disabledAt !== null) return false
          return true
        },
      },
    },
  },
  disabledPaths: ['/sign-up/email'],
  plugins: [nextCookies()],
})

export async function getCurrentUser() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })
  if (!session) return null
  const account = await getAccountUserById(session.user.id)
  if (account?.disabledAt !== null) return null
  return account
}

export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}

export async function requireAdmin() {
  const user = await requireUser()
  if (user.role !== 'admin') redirect('/account')
  return user
}

/**
 * Non-redirecting admin check, for CONDITIONAL RENDERING rather than access
 * control. `requireAdmin` navigates away, which is right for an admin route
 * and wrong for "show this panel only to admins".
 *
 * Returns false for signed-out visitors, which is every visitor today — no
 * accounts exist yet.
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const user = await getCurrentUser()
  return user?.role === 'admin'
}
