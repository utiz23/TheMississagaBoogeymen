import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AuthNotice, AuthPanel } from '@/components/auth/auth-panel'
import { DiscordSignInButton } from '@/components/auth/discord-sign-in-button'
import { getViewer } from '@/lib/auth'
import { loginErrorMessage } from '@/lib/auth-config'

export const metadata: Metadata = { title: 'Member sign-in' }
/** Per member, per request — never prerendered (auth settings exist only at runtime). */
export const dynamic = 'force-dynamic'

/**
 * Member sign-in: one Discord button. New members come in through an invite
 * link (/invite/[token]); this page only signs existing members back in.
 * `?error=` comes from Better Auth's callback and is shown through a fixed
 * dictionary, never echoed.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>
}) {
  if (await getViewer()) redirect('/account')

  const { error } = await searchParams
  const message = loginErrorMessage(typeof error === 'string' ? error : null)

  return (
    <AuthPanel label="Members" title="Sign in">
      {message && <AuthNotice tone="error">{message}</AuthNotice>}
      <p className="text-sm text-fg-3">
        Team members sign in with their Discord account. Signing in lets you equip your player card.
      </p>
      <DiscordSignInButton />
      <p className="text-sm text-fg-4">
        New here? Membership is by invite — ask the club admin for your invite link.
      </p>
    </AuthPanel>
  )
}
