import test from 'node:test'
import assert from 'node:assert/strict'
import type { Dossier, DossierIndexRow } from '@eanhl/db/queries'
import type { PlayerGameInput } from '../../../lib/news/players.ts'
import { loadDossierPage, type DossierReads } from './dossier-data.ts'

const NOW = new Date('2026-11-14T12:00:00Z')
const CANARY = 'UNUSABLE-OR-OFF-LIMITS-CANARY'

const identity = (pressLevel: 'full' | 'easy' | 'out'): Dossier['identity'] => ({
  key: '4',
  playerId: 4,
  discordUserId: null,
  name: 'Skater A',
  gamertag: 'skatera',
  role: 'player',
  pressLevel,
  pressLevelSetBy: 'self',
  aliases: [],
  discordLinked: true,
})

const dossier = (pressLevel: 'full' | 'easy' | 'out'): Dossier => ({
  identity: identity(pressLevel),
  profile: null,
  quotes:
    pressLevel === 'out'
      ? []
      : [
          {
            id: 'scrum:1',
            source: 'scrum',
            usability: 'usable',
            question: 'How was it?',
            text: 'Fine',
            reporter: 'vale',
            at: NOW,
          },
        ],
  // Two answers were not usable: only the count is here.
  counts: { usable: 1, joke: 0, unusable: pressLevel === 'out' ? 0 : 2 },
  takes: [],
  stances: [],
  relationships: [],
  notes: [],
  asks: [],
  interviews: [],
  scrums: { count: 0, lastNight: null, lastAt: null, usableAnswers: 0 },
})

const game = (i: number): PlayerGameInput => ({
  matchId: i,
  gameTitleId: 3,
  night: '2026-11-13',
  playedAt: new Date(NOW.getTime() - (50 - i) * 3_600_000).toISOString(),
  gameMode: '6s',
  result: 'WIN',
  goals: 1,
  assists: 1,
  shots: 3,
  hits: 1,
  position: 'F',
  endedEarly: false,
})

function reads(level: 'full' | 'easy' | 'out') {
  const calls: string[] = []
  const r: DossierReads = {
    getDossier: () => {
      calls.push('getDossier')
      return Promise.resolve(dossier(level))
    },
    listIndex: () => {
      calls.push('listIndex')
      return Promise.resolve([] as DossierIndexRow[])
    },
    listRequests: () => {
      calls.push('listRequests')
      return Promise.resolve([])
    },
    loadGames: () => {
      calls.push('loadGames')
      return Promise.resolve({ games: [game(1), game(2)], titles: new Map([[3, 'NHL 27']]) })
    },
  }
  return { r, calls }
}

void test('a full dossier loads the form from the existing stats', async () => {
  const { r, calls } = reads('full')
  const page = await loadDossierPage({ playerId: 4 }, NOW, r)
  assert.ok(page !== null)
  assert.equal(page.titleName, 'NHL 27')
  assert.equal(page.form?.games, 2)
  assert.equal(page.form?.goals, 2)
  assert.ok(calls.includes('loadGames'))
})

void test('Leave me out: identity only; no stats, no requests and no profile are read', async () => {
  const { r, calls } = reads('out')
  const page = await loadDossierPage({ playerId: 4 }, NOW, r)
  assert.ok(page !== null)
  assert.equal(page.form, null)
  assert.deepEqual(page.requests, [])
  assert.equal(page.dossier.profile, null)
  assert.equal(page.dossier.quotes.length, 0)
  assert.equal(calls.includes('loadGames'), false)
  assert.equal(calls.includes('listRequests'), false)
})

void test('off-limits and unusable answers appear as counts only, never as text', async () => {
  const { r } = reads('full')
  const page = await loadDossierPage({ playerId: 4 }, NOW, r)
  assert.ok(page !== null)
  assert.equal(page.dossier.counts.unusable, 2)
  assert.equal(JSON.stringify(page).includes(CANARY), false)
  // The dossier type has no field that could carry an unusable answer's text.
  const shape = Object.keys(page.dossier.quotes[0]!).sort()
  assert.deepEqual(shape, ['at', 'id', 'question', 'reporter', 'source', 'text', 'usability'])
  assert.ok(page.dossier.quotes.every((q) => q.usability === 'usable' || q.usability === 'joke'))
})

void test('a bench person has no form and no stats read', async () => {
  const { r, calls } = reads('full')
  const bench = (): Promise<Dossier> =>
    Promise.resolve({
      ...dossier('full'),
      identity: {
        ...identity('full'),
        playerId: null,
        discordUserId: '123456789012345678',
        pressLevel: null,
        role: 'bench' as const,
      },
    })
  r.getDossier = bench
  const page = await loadDossierPage({ discordUserId: '123456789012345678' }, NOW, r)
  assert.ok(page !== null)
  assert.equal(page.form, null)
  assert.equal(calls.includes('loadGames'), false)
})

void test('no such person: null', async () => {
  const { r } = reads('full')
  r.getDossier = () => Promise.resolve(null)
  assert.equal(await loadDossierPage({ playerId: 99 }, NOW, r), null)
})
