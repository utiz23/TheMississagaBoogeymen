import Link from 'next/link'
import { getViewer } from '@/lib/auth'
import { getMemberGamertags } from '@/lib/member-gamertags'
import { GUIDE_PATH, ownProfileHref } from '@/lib/news/guide'
import { memberPaths } from '@/lib/player-route'

/** The signed-in member's own player page, or null (signed out, or auth trouble). */
export async function loadOwnProfileHref(): Promise<string | null> {
  try {
    const viewer = await getViewer()
    if (viewer === null) return null
    let paths: Map<number, string> | null
    try {
      paths = memberPaths(await getMemberGamertags())
    } catch {
      paths = null
    }
    return ownProfileHref(viewer.playerId, paths)
  } catch {
    return null
  }
}

/**
 * A short note: the reporters are made up, and how to set your press level.
 * Shown on every reporter page; links to the full guide.
 */
export async function PressGuideNote() {
  const profile = await loadOwnProfileHref()
  return (
    <aside className="space-y-1 border border-border-subtle px-4 py-3 text-sm text-fg-3">
      <p className="font-condensed text-xs font-bold uppercase tracking-widest text-fg-4">
        How to read the Press Room
      </p>
      <p>
        The nine reporters are made up. The scores and stats come from the real games. You choose
        how they treat you:{' '}
        {profile !== null ? (
          <>
            open{' '}
            <Link prefetch href={profile} className="text-fg-1 underline">
              your player page
            </Link>
            , press EDIT PROFILE and set Press coverage.
          </>
        ) : (
          <>sign in, open your player page, press EDIT PROFILE and set Press coverage.</>
        )}{' '}
        <Link prefetch href={GUIDE_PATH} className="text-fg-1 underline">
          Read the full guide
        </Link>
        .
      </p>
    </aside>
  )
}
