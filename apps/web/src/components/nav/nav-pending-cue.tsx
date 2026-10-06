'use client'

import { useLinkStatus } from 'next/link'

/**
 * Marks its parent nav `<Link>` while a tap is still waiting for the page.
 *
 * Every nav link preloads its page in full, so this rarely shows: it covers a
 * tap that beats the preload. Next reports `pending` only while a navigation
 * actually waits on the network; a preloaded hop skips it.
 *
 * It renders nothing visible itself. The marker lets one rule in globals.css
 * (`body:has([data-nav-pending]) .nav-pending-bar`) light the strip along the
 * header's bottom edge. That works the same for the desktop links and for the
 * drawer, whose links sit in a portal outside the header and which closes on
 * tap, so a cue drawn inside it would never be seen.
 */
export function NavPendingCue() {
  const { pending } = useLinkStatus()
  return pending ? <span data-nav-pending hidden /> : null
}
