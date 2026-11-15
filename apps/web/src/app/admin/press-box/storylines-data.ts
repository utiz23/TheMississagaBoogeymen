import {
  getLatestMatchId,
  getPinnedStoryline,
  listAdminTakes,
  listPressRoster,
  listRelationships,
  listStorylineBoard,
  listTalkCounts,
  type PinnedStoryline,
} from '@eanhl/db/queries'
import { loadFormPlayers } from './form-data'
import { currentTitle, hotAndCold, milestonesInReach } from './form'
import { buildTrends } from './storylines-trends'

/**
 * Everything the storylines page shows (design section 3.4). Read only. The storyline tables
 * (migration 0085) may not exist yet: `board.tableReady` is then false and the page says so.
 */
export async function loadStorylinesPage(now: Date) {
  const [board, pinned, takes, roster, relationships, talk, latest] = await Promise.all([
    listStorylineBoard(now),
    getPinnedStoryline().catch((): PinnedStoryline | null => null),
    listAdminTakes(),
    listPressRoster(),
    listRelationships({ now }).catch(() => []),
    listTalkCounts(now).catch(() => []),
    getLatestMatchId(),
  ])
  const players = await loadFormPlayers(roster, latest)
  const title = currentTitle(players)
  const { hot, cold } = hotAndCold(players, title, now)
  return {
    board,
    pinned,
    takes,
    roster,
    trends: buildTrends({
      hot,
      cold,
      milestones: milestonesInReach(players, title),
      talk,
      relationships,
      roster,
    }),
  }
}
