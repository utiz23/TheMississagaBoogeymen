import {
  getDossier,
  getLatestMatchId,
  listAllGameTitles,
  listDossierIndex,
  listNewsPlayerGames,
  listPersonRequests,
} from '@eanhl/db/queries'
import { playerGameFromRow } from '@/lib/news/players'
import type { DossierReads } from './dossier-data'

/** The dossier page reads on the database. */
export const dbReads: DossierReads = {
  getDossier,
  listIndex: listDossierIndex,
  listRequests: (key) => listPersonRequests(key),
  loadGames: async (playerId) => {
    const [latest, titles] = await Promise.all([getLatestMatchId(), listAllGameTitles()])
    const rows =
      latest === null
        ? []
        : await listNewsPlayerGames({ playerIds: [playerId], lastMatchId: latest })
    return {
      games: rows.map(playerGameFromRow),
      titles: new Map(titles.map((t) => [t.id, t.name])),
    }
  },
}
