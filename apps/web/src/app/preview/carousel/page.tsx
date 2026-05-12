/**
 * Carousel-only preview page. Used by the visual companion comparison —
 * iframes this URL to render <PlayerCarousel> in isolation (no nav, no other
 * home-page sections). Inline <style> hides the root layout's TopNav and
 * neutralises <main>'s padding so the carousel sits flush.
 *
 * Not linked from anywhere; intentionally bare-bones.
 */
import type { Metadata } from 'next'
import { listGameTitles, getEARoster } from '@eanhl/db/queries'
import { PlayerCarousel } from '@/components/home/player-carousel'
import type { RosterRow } from '@/components/home/player-card'

export const metadata: Metadata = { title: 'Carousel preview' }
export const revalidate = 300

function selectFeaturedPlayers(roster: RosterRow[]): RosterRow[] {
  return [...roster].sort((a, b) => b.points - a.points || b.gamesPlayed - a.gamesPlayed)
}

export default async function CarouselPreviewPage() {
  const titles = await listGameTitles()
  const gameTitle = titles[0] ?? null
  if (gameTitle === null) {
    return <div className="p-8 text-zinc-400">No game titles configured.</div>
  }
  const roster = await getEARoster(gameTitle.id)
  const featuredPlayers = selectFeaturedPlayers(roster)

  return (
    <>
      <style>{`
        body > header { display: none !important; }
        body > main { max-width: none !important; padding: 0 !important; margin: 0 !important; }
      `}</style>
      <div className="px-4 py-8">
        {featuredPlayers.length > 0 ? (
          <PlayerCarousel players={featuredPlayers} />
        ) : (
          <p className="text-zinc-400">No featured players.</p>
        )}
      </div>
    </>
  )
}
