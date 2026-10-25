import type { ReactNode } from 'react'
import { getMemberGamertags } from '@/lib/member-gamertags'
import { memberPaths } from '@/lib/player-route'
import { MemberLinksProvider } from './player-link'

/**
 * Wraps a page that can show guests so its PlayerLinks link team members
 * only, each to its gamertag URL. If the member list fails to load, links
 * behave as before (every resolved player links, by id) rather than vanishing.
 */
export async function MemberLinks({ children }: { children: ReactNode }) {
  let paths: Map<number, string> | null
  try {
    paths = memberPaths(await getMemberGamertags())
  } catch {
    paths = null
  }
  if (paths === null) return <>{children}</>
  return <MemberLinksProvider paths={[...paths]}>{children}</MemberLinksProvider>
}
