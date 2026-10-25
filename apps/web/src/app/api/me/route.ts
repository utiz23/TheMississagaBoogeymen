import { playerPath } from '@eanhl/db/lib/player-slug'
import { getViewer } from '@/lib/auth'

/**
 * The signed-in member, for the nav's account menu (nav-account.tsx): name,
 * picture, role and player page path — or `null` when signed out. Only the caller's
 * own record, through the same `getViewer` gate as the pages, so a disabled or
 * unlinked user reads as signed out here too.
 *
 * The nav reads this in the browser rather than from the root layout, so the
 * layout never reads `headers()` and every page stays as cacheable as before.
 */
export const dynamic = 'force-dynamic'

/** The shape `NavAccount` reads (its `MeBody`). */
type MeBody = {
  name: string
  image: string | null
  role: 'user' | 'admin'
  playerPath: string
} | null

export async function GET(): Promise<Response> {
  let body: MeBody = null
  try {
    const viewer = await getViewer()
    if (viewer !== null && viewer.playerId !== null) {
      body = {
        name: viewer.name,
        image: viewer.image,
        role: viewer.role === 'admin' ? 'admin' : 'user',
        playerPath: playerPath({ id: viewer.playerId, gamertag: viewer.gamertag ?? '' }),
      }
    }
  } catch {
    // Auth not configured (or DB down): the nav shows LOG IN, as when signed out.
  }
  return Response.json(body, { headers: { 'cache-control': 'no-store' } })
}
