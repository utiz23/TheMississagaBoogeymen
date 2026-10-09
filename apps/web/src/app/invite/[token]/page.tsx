import type { Metadata } from 'next'
import Link from 'next/link'
import { evaluateInvite, getAccountInviteByToken } from '@eanhl/db/queries'
import { AUTH_BUTTON_SECONDARY, AuthNotice, AuthPanel } from '@/components/auth/auth-panel'
import { DiscordSignInButton } from '@/components/auth/discord-sign-in-button'
import { getViewer } from '@/lib/auth'
import { loginErrorMessage } from '@/lib/auth-config'

export const metadata: Metadata = { title: 'Member invite' }
export const dynamic = 'force-dynamic'

/**
 * An invite link: shows which player it links and starts Discord sign-up.
 * The token is in the path; Referrer-Policy same-origin keeps it from leaking
 * to Discord. Opening the page changes nothing — the invite is only spent when
 * the account is created (src/lib/auth.ts).
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const [invite, viewer] = await Promise.all([getAccountInviteByToken(token), getViewer()])
  const status = evaluateInvite(invite)

  if (viewer) {
    return (
      <AuthPanel label="Member invite" title="Already signed in">
        <p className="text-sm text-fg-3">
          You’re signed in as {viewer.name}
          {viewer.gamertag ? ` (${viewer.gamertag})` : ''}. Each Discord account links one player,
          so this invite is for someone else.
        </p>
        <Link prefetch href="/account" className={AUTH_BUTTON_SECONDARY}>
          Your account
        </Link>
      </AuthPanel>
    )
  }

  if (status !== 'ok' || invite === null) {
    return (
      <AuthPanel label="Member invite" title="Invite not usable">
        <AuthNotice tone="error">{loginErrorMessage(`invite_${status}`)}</AuthNotice>
        <Link prefetch href="/login" className={AUTH_BUTTON_SECONDARY}>
          Member sign-in
        </Link>
      </AuthPanel>
    )
  }

  return (
    <AuthPanel label="Member invite" title={invite.claimedPlayerGamertag}>
      <p className="text-sm text-fg-3">
        You’ve been invited to join the Boogeymen site as{' '}
        <strong className="text-fg-1">{invite.claimedPlayerGamertag}</strong>
        {invite.role === 'admin' ? ', with admin access' : ''}. Continue with the Discord account
        you’ll sign in with from now on.
      </p>
      <DiscordSignInButton inviteToken={token} label="Join with Discord" />
      <p className="text-sm text-fg-4">
        The site only asks Discord for your user ID and display name — no email address.
      </p>
    </AuthPanel>
  )
}
