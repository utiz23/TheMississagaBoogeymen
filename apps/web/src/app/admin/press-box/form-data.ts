import { listNewsPlayerGames, type PressRosterEntry } from '@eanhl/db/queries'
import { playerGameFromRow } from '@/lib/news/players'
import type { FormPlayer } from './form'

/**
 * Every member's games (every title, oldest first) from the stats the site already has, for the
 * form and milestone reads of the Press Box. A "Leave me out" player is not listed. Read only.
 */
export async function loadFormPlayers(
  roster: readonly PressRosterEntry[],
  latestMatchId: number | null,
): Promise<FormPlayer[]> {
  const memberIds = roster.map((r) => r.playerId)
  const rows =
    latestMatchId === null
      ? []
      : await listNewsPlayerGames({ playerIds: memberIds, lastMatchId: latestMatchId })
  const byPlayer = new Map<number, ReturnType<typeof playerGameFromRow>[]>()
  for (const r of rows) {
    const list = byPlayer.get(r.playerId) ?? []
    list.push(playerGameFromRow(r))
    byPlayer.set(r.playerId, list)
  }
  return roster
    .filter((r) => r.pressLevel !== 'out')
    .map((r) => ({ playerId: r.playerId, name: r.name, games: byPlayer.get(r.playerId) ?? [] }))
}
