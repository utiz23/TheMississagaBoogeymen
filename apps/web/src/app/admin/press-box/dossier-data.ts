import type { Dossier, DossierIndexRow, DossierKey, listPersonRequests } from '@eanhl/db/queries'
import type { PlayerGameInput } from '../../../lib/news/players.ts'
import { buildDossierForm, type DossierFormView } from './dossier-form.ts'

/** What one dossier page shows (design 3.2). */
export interface DossierPage {
  dossier: Dossier
  form: DossierFormView | null
  titleName: string | null
  requests: Awaited<ReturnType<typeof listPersonRequests>>
  index: DossierIndexRow[]
}

/** The reads a dossier page needs; a test passes fakes and counts the calls. */
export interface DossierReads {
  getDossier(key: DossierKey, now: Date): Promise<Dossier | null>
  listIndex(now: Date): Promise<DossierIndexRow[]>
  listRequests(key: DossierKey): Promise<DossierPage['requests']>
  /** A member's games (oldest first, every title), and the title names. */
  loadGames(playerId: number): Promise<{
    games: PlayerGameInput[]
    titles: Map<number, string>
  }>
}

/**
 * Loads one dossier page. A "Leave me out" player gets identity only: no stats, no requests, no
 * quotes (the dossier query already returns nothing else, and this function does not read the
 * player's games either).
 */
export async function loadDossierPage(
  key: DossierKey,
  now: Date,
  reads: DossierReads,
): Promise<DossierPage | null> {
  const [dossier, index] = await Promise.all([reads.getDossier(key, now), reads.listIndex(now)])
  if (dossier === null) return null
  if (dossier.identity.pressLevel === 'out') {
    return { dossier, form: null, titleName: null, requests: [], index }
  }
  const [requests, games] = await Promise.all([
    reads.listRequests(key),
    'playerId' in key ? reads.loadGames(key.playerId) : Promise.resolve(null),
  ])
  const form =
    games === null || !('playerId' in key)
      ? null
      : buildDossierForm(key.playerId, dossier.identity.name, games.games, now)
  return {
    dossier,
    form,
    titleName: form === null || games === null ? null : (games.titles.get(form.titleId) ?? null),
    requests,
    index,
  }
}
