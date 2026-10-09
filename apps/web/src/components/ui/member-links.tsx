import type { ReactNode } from 'react'
import { getClubMemberIds } from '@eanhl/db/queries'
import { MemberLinksProvider } from './player-link'

/**
 * Wraps a page that can show guests so its PlayerLinks link team members
 * only. If the member list fails to load, links behave as before (every
 * resolved player links) rather than vanishing.
 */
export async function MemberLinks({ children }: { children: ReactNode }) {
  let ids: number[] | null
  try {
    ids = await getClubMemberIds()
  } catch {
    ids = null
  }
  if (ids === null) return <>{children}</>
  return <MemberLinksProvider ids={ids}>{children}</MemberLinksProvider>
}
