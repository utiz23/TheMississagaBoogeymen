import { showcaseChanges, type DiscordCardUpdates } from '@eanhl/db/discord'
import {
  getCardEventBatch,
  getCardProgressForPlayers,
  getClubMemberIds,
  getEARoster,
  getRosterCarryOvers,
  listAllGameTitles,
} from '@eanhl/db/queries'
import { cardFromRosterRow } from '@/components/cards/card-adapters'
import type { CardViewModel } from '@/components/cards/card-model'

/** Cards in the image; extra players appear in the text only. */
const MAX_CARDS = 9

/**
 * One batch of card changes for the Discord post: the counted changes per
 * real teammate (members, never AI goalies), and each player's current card
 * for that title, built the way the site builds it.
 */
export async function loadDiscordCardUpdates(batchEventId: number): Promise<{
  data: DiscordCardUpdates
  cards: { playerId: number; card: CardViewModel; caption: string }[]
} | null> {
  const batch = await getCardEventBatch(batchEventId)
  if (!batch) return null
  const [titles, memberIdList] = await Promise.all([listAllGameTitles(), getClubMemberIds()])
  const members = new Set(memberIdList)
  const aiGoalies = new Set(batch.events.filter((e) => e.aiGoalie).map((e) => e.playerId))
  const shown = showcaseChanges(batch.events, (id) => members.has(id) && !aiGoalies.has(id))
  const gamertags = new Map(batch.events.map((e) => [e.playerId, e.gamertag]))

  const ids = shown.map((p) => p.playerId)
  const [roster, carryOvers, summaries] = await Promise.all([
    ids.length === 0 ? Promise.resolve([]) : getEARoster(batch.gameTitleId),
    ids.length === 0 ? Promise.resolve([]) : getRosterCarryOvers(batch.gameTitleId),
    getCardProgressForPlayers(ids, batch.gameTitleId),
  ])
  const rows = new Map([...roster, ...carryOvers].map((r) => [r.playerId, r]))

  const cards = shown
    .flatMap((p) => {
      const row = rows.get(p.playerId)
      return row
        ? [
            {
              playerId: p.playerId,
              card: cardFromRosterRow(row, summaries.get(p.playerId)),
              caption: p.changes.join(' · '),
            },
          ]
        : []
    })
    .slice(0, MAX_CARDS)
  const names = new Map(cards.map((c) => [c.playerId, c.card.front.name]))

  return {
    data: {
      batchEventId,
      gameTitleName: titles.find((t) => t.id === batch.gameTitleId)?.name ?? '',
      players: shown.map((p) => ({
        playerId: p.playerId,
        name: names.get(p.playerId) ?? gamertags.get(p.playerId) ?? `#${String(p.playerId)}`,
        changes: p.changes,
      })),
      cardCount: cards.length,
    },
    cards,
  }
}
