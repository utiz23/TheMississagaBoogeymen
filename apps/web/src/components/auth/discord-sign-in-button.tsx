'use client'

import { useState } from 'react'
import { AUTH_BUTTON_PRIMARY } from './auth-panel'

/**
 * Starts Discord sign-in. Asks Better Auth for the Discord authorize URL and
 * navigates there; Discord sends the browser back to /api/auth/callback/discord.
 *
 * With `inviteToken` it is the invite flow: it asks to sign up and carries the
 * token in the server-side OAuth state. That request is only a request — the
 * server re-checks the invite before any account is created (src/lib/auth.ts).
 */
export function DiscordSignInButton({
  inviteToken,
  label = 'Sign in with Discord',
}: {
  inviteToken?: string
  label?: string
}) {
  const [state, setState] = useState<'idle' | 'pending' | 'error'>('idle')

  async function start() {
    setState('pending')
    try {
      const response = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'discord',
          callbackURL: inviteToken ? '/account?welcome=1' : '/account',
          errorCallbackURL: '/login',
          ...(inviteToken ? { requestSignUp: true, additionalData: { inviteToken } } : {}),
        }),
      })
      const body: unknown = await response.json().catch(() => null)
      const url =
        body !== null && typeof body === 'object' && 'url' in body
          ? (body as { url: unknown }).url
          : null
      if (!response.ok || typeof url !== 'string') throw new Error('no redirect')
      window.location.assign(url)
    } catch {
      setState('error')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void start()}
        disabled={state === 'pending'}
        className={`${AUTH_BUTTON_PRIMARY} w-full py-3 text-sm`}
      >
        {state === 'pending' ? 'Opening Discord…' : label}
      </button>
      {state === 'error' && (
        <p role="alert" className="text-sm text-fg-3">
          Couldn’t reach the sign-in service. Please try again.
        </p>
      )}
    </div>
  )
}
