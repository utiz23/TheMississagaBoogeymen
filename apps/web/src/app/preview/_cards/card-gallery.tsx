import { CARD_THEME_NAMES, CARD_THEME_ORDER, themeTier } from '@eanhl/db/cards'
import { PlayerCard } from '@/components/cards/player-card'
import type { CardViewModel } from '@/components/cards/card-model'
import { PREVIEW_THEMES } from './preview-params'

/**
 * Dev preview: this player's card in every theme, each at the tier that
 * unlocks it. Hover a card to run its effects. Mythics land in round 2.
 */
export function CardGallery({ card }: { card: CardViewModel }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-6 gap-y-8">
      {CARD_THEME_ORDER.map((theme) => {
        const tier = themeTier(theme)
        const label = `${CARD_THEME_NAMES[theme]} · T${String(tier)}`
        if (!PREVIEW_THEMES.includes(theme)) {
          return (
            <figure key={theme} className="flex flex-col items-center gap-2">
              <div className="flex h-[430px] w-[264px] items-center justify-center rounded-[18px] border border-dashed border-zinc-700 font-condensed text-xs font-bold uppercase tracking-[0.22em] text-zinc-500">
                Mythic · Round 2
              </div>
              <figcaption className="font-condensed text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
                {label}
              </figcaption>
            </figure>
          )
        }
        return (
          <figure key={theme} className="flex flex-col items-center gap-2">
            <PlayerCard card={{ ...card, front: { ...card.front, theme, tier } }} context="list" />
            <figcaption className="font-condensed text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
              {label}
            </figcaption>
          </figure>
        )
      })}
    </div>
  )
}
