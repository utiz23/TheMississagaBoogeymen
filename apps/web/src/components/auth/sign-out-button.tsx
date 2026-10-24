'use client'

import { useState } from 'react'
import { AUTH_BUTTON_SECONDARY } from './auth-panel'

/**
 * Signs out, then reloads onto the home page — a full load, so the nav's
 * signed-in control (which lives in the persistent root layout) starts fresh.
 * Shared by this button and the nav's account menu.
 */
export async function signOutAndReload(): Promise<void> {
  try {
    await fetch('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
  } finally {
    window.location.assign('/')
  }
}

export function SignOutButton() {
  const [pending, setPending] = useState(false)

  function signOut() {
    setPending(true)
    void signOutAndReload()
  }

  return (
    <button type="button" onClick={signOut} disabled={pending} className={AUTH_BUTTON_SECONDARY}>
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
