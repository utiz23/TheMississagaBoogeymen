import { describeUnlock, type DiscordUnlock } from '@eanhl/db/discord'
import {
  getCardProgressForPlayers,
  getClubMemberIds,
  getEARoster,
  getPlayerDiscordUserId,
  getRosterCarryOvers,
  getUnlockEvent,
} from '@eanhl/db/queries'
import type { BadgeFamilyId } from '@eanhl/db/cards'
import { cardFromRosterRow } from '@/components/cards/card-adapters'
import type { CardViewModel } from '@/components/cards/card-model'

/**
 * One unlock's message data and graphic. Null (⇒ 404, the poster skips it)
 * when the event doesn't count any more: not a member, an AI goalie, a cleared
 * mythic, a non-counting kind.
 */
export async function loadDiscordUnlock(eventId: number): Promise<{
  data: DiscordUnlock
  badge: { familyId: BadgeFamilyId; level: number } | null
  card: CardViewModel | null
} | null> {
  const ev = await getUnlockEvent(eventId)
  if (!ev || ev.aiGoalie) return null
  if (!(await getClubMemberIds()).includes(ev.playerId)) return null
  const d = describeUnlock(ev, { mythicTheme: ev.mythicTheme })
  if (!d) return null

  const [roster, carryOvers, summaries] = await Promise.all([
    getEARoster(ev.gameTitleId),
    getRosterCarryOvers(ev.gameTitleId),
    getCardProgressForPlayers([ev.playerId], ev.gameTitleId),
  ])
  const row = [...roster, ...carryOvers].find((r) => r.playerId === ev.playerId)
  const base = row ? cardFromRosterRow(row, summaries.get(ev.playerId)) : null
  const card =
    base === null
      ? null
      : d.cardTheme === undefined
        ? base
        : {
            ...base,
            front: {
              ...base.front,
              theme: d.cardTheme,
              tier: d.cardTier ?? base.front.tier,
              level: d.kind === 'mythic' ? 10 : base.front.level,
            },
          }
  const name = (base?.front.name ?? ev.gamertag).toUpperCase()
  // Only a new card pings (spec); other kinds never look the ID up.
  const discordUserId =
    d.kind === 'tier' || d.kind === 'mythic' ? await getPlayerDiscordUserId(ev.playerId) : null
  const graphic = d.graphic === 'badge' ? 'badge' : card ? 'card' : 'none'
  return {
    data: {
      eventId,
      playerId: ev.playerId,
      name,
      kind: d.kind,
      subject: d.subject,
      graphic,
      discordUserId,
    },
    badge: d.badge ?? null,
    card: graphic === 'card' ? card : null,
  }
}
