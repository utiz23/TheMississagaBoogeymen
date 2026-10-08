import { CARD_THEME_NAMES, CARD_THEME_ORDER, themeTier } from '@eanhl/db/cards'
import { PlayerCard } from '@/components/cards/player-card'
import type { CardViewModel } from '@/components/cards/card-model'

/**
 * Dev preview: this player's card in every theme, each at the tier that
 * unlocks it. Hover a card to run its effects.
 */
export function CardGallery({ card }: { card: CardViewModel }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-6 gap-y-8">
      {CARD_THEME_ORDER.map((theme) => {
        const tier = themeTier(theme)
        const label = `${CARD_THEME_NAMES[theme]} · T${String(tier)}`
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
