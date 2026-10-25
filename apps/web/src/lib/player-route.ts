import type { MemberGamertag } from '@eanhl/db/queries'
import { playerSlug } from '@eanhl/db/lib/player-slug'

/**
 * Player page URLs — `/roster/<gamertag slug>` (rule: @eanhl/db/lib/player-slug).
 *
 * Pure, so the resolution rules are unit-tested (player-route.test.ts) apart
 * from the page and the DB. `members` is `listMemberGamertags()`: current
 * gamertags first, then earlier ones, most recent first.
 */

export type PlayerRoute =
  | { kind: 'page'; playerId: number }
  | { kind: 'redirect'; path: string }
  | { kind: 'missing' }

/**
 * Each member's canonical path. Two current gamertags with the same slug: the
 * lower id keeps the slug, the other keeps its numeric URL.
 */
export function memberPaths(members: readonly MemberGamertag[]): Map<number, string> {
  const owner = new Map<string, number>()
  for (const m of members) {
    if (!m.current) continue
    const slug = playerSlug(m.gamertag)
    if (slug === null) continue
    const held = owner.get(slug)
    if (held === undefined || m.playerId < held) owner.set(slug, m.playerId)
  }
  const paths = new Map<number, string>()
  for (const m of members) {
    if (!m.current) continue
    const slug = playerSlug(m.gamertag)
    paths.set(
      m.playerId,
      `/roster/${slug !== null && owner.get(slug) === m.playerId ? slug : String(m.playerId)}`,
    )
  }
  return paths
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * What `/roster/<segment>` shows. The canonical path renders; anything else
 * that names a member redirects to it: the numeric id (old links, Discord
 * posts), another spelling of the slug ("Stick%20Menace"), or an earlier
 * gamertag. A current gamertag always wins over someone's earlier one — player
 * 2 once used "Utiz23", which is player 28's gamertag now.
 */
export function resolvePlayerRoute(
  segment: string,
  members: readonly MemberGamertag[],
): PlayerRoute {
  const paths = memberPaths(members)
  const raw = decodeSegment(segment)
  const pageOrRedirect = (playerId: number): PlayerRoute => {
    const path = paths.get(playerId)
    if (path === undefined) return { kind: 'missing' }
    return path === `/roster/${segment}` ? { kind: 'page', playerId } : { kind: 'redirect', path }
  }

  if (/^\d+$/.test(raw)) return pageOrRedirect(Number(raw))

  const key = playerSlug(raw)
  if (key === null) return { kind: 'missing' }
  for (const [playerId, path] of paths) {
    if (path === `/roster/${key}`) return pageOrRedirect(playerId)
  }
  const earlier = members.find((m) => !m.current && playerSlug(m.gamertag) === key)
  return earlier === undefined ? { kind: 'missing' } : pageOrRedirect(earlier.playerId)
}
