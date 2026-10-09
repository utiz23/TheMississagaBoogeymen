/**
 * The pure half of member logins: environment checks, the Discord provider
 * settings, the closed endpoint list and the login-page error dictionary.
 * No database, no Better Auth instance, so tests import it directly
 * (auth-config.test.ts). The live instance is built in ./auth.ts.
 *
 * Plan: docs/superpowers/plans/2026-10-09-member-logins-step-1.md. Decisions:
 * Discord only, invite-only, `identify` scope only (no email address).
 */

export interface AuthEnv {
  secret: string
  baseURL: string
  discordClientId: string
  discordClientSecret: string
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

/**
 * Read and check the auth environment. Fails closed: there is no fallback
 * secret, and in production a short secret, a non-https URL or missing Discord
 * credentials throw. The throw happens on first use of `getAuth()`, so only the
 * auth routes fail — the build and the public pages are unaffected.
 */
export function readAuthEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuthEnv {
  const secret = env['BETTER_AUTH_SECRET'] ?? ''
  const baseURL = env['BETTER_AUTH_URL'] ?? ''
  const discordClientId = env['DISCORD_CLIENT_ID'] ?? ''
  const discordClientSecret = env['DISCORD_CLIENT_SECRET'] ?? ''

  const problems: string[] = []
  if (secret.length < 32) problems.push('BETTER_AUTH_SECRET must be at least 32 characters')
  if (!discordClientId || !discordClientSecret) {
    problems.push('DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET are required')
  }
  let url: URL | null = null
  try {
    url = new URL(baseURL)
  } catch {
    problems.push('BETTER_AUTH_URL must be an absolute URL')
  }
  if (url && url.protocol !== 'https:' && !LOCAL_HOSTS.has(url.hostname)) {
    problems.push('BETTER_AUTH_URL must use https outside localhost')
  }
  if (problems.length > 0) {
    throw new Error(`Member logins are misconfigured: ${problems.join('; ')}.`)
  }
  return { secret, baseURL: url!.origin, discordClientId, discordClientSecret }
}

/** The fields we read from Discord's `/users/@me` (identify scope). */
export interface DiscordProfile {
  id: string
  username: string
  global_name?: string | null
}

/**
 * Discord account → user row. Discord gives no email under `identify`, but
 * `users.email` is NOT NULL UNIQUE and Better Auth needs one, so it is a
 * synthetic, undeliverable address (RFC 2606 `.invalid`) — still unique per
 * Discord account. The avatar URL is filtered by `customDiscordAvatar` in
 * the user hooks (./auth.ts).
 */
export function mapDiscordProfile(profile: DiscordProfile) {
  return {
    email: `discord-${profile.id}@users.invalid`,
    emailVerified: false,
    name: profile.global_name || profile.username,
  }
}

const CUSTOM_AVATAR =
  /^https:\/\/cdn\.discordapp\.com\/avatars\/\d+\/a?_?[0-9a-f]+\.(png|gif|webp)$/

/**
 * The member's own Discord profile picture link, kept so the nav can show it
 * to them (operator, 2026-10-09). Only a custom avatar on Discord's CDN is
 * kept; Discord's generic default (`/embed/avatars/…`) and anything else
 * become null, and the site shows the card silhouette instead.
 */
export function customDiscordAvatar(url: unknown): string | null {
  return typeof url === 'string' && CUSTOM_AVATAR.test(url) ? url : null
}

export const DISCORD_SCOPES = ['identify'] as const

/**
 * Better Auth endpoints this site never offers. Sign-in and sign-up happen only
 * through Discord; profile edits arrive with step 2 under their own design.
 */
export const DISABLED_AUTH_PATHS = [
  '/sign-up/email',
  '/sign-in/email',
  '/request-password-reset',
  '/reset-password',
  '/change-password',
  '/set-password',
  '/verify-password',
  '/change-email',
  '/update-user',
  '/delete-user',
  '/link-social',
  '/unlink-account',
  '/get-access-token',
  '/refresh-token',
  '/account-info',
  '/send-verification-email',
  '/verify-email',
] as const

/** Session length: signed in for 30 days, renewed at most daily while active. */
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24

/**
 * `?error=` code on /login → the sentence shown. A fixed dictionary: the query
 * value is never echoed, so the page can't be made to display arbitrary text.
 */
const LOGIN_ERRORS: Readonly<Record<string, string>> = {
  signup_disabled:
    'That Discord account isn’t a member account yet. Ask the admin for an invite link.',
  invite_not_found: 'That invite link isn’t valid. Ask the admin for a new one.',
  invite_expired: 'That invite link has expired. Ask the admin for a new one.',
  invite_revoked: 'That invite link was cancelled. Ask the admin for a new one.',
  invite_accepted: 'That invite link has already been used.',
  invite_player_claimed: 'That player is already linked to another member.',
  unable_to_create_session: 'This account can’t sign in right now. Ask the admin.',
  access_denied: 'Sign-in was cancelled at Discord.',
}

const GENERIC_LOGIN_ERROR = 'Sign-in didn’t work. Please try again.'

export function loginErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null
  return LOGIN_ERRORS[code] ?? GENERIC_LOGIN_ERROR
}
