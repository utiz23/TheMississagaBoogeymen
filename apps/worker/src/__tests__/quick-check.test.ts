/**
 * Quick check (live events E1): only the EA match lists, then the database follow-ups for a new
 * game. Fake deps: no database, no EA.
 *   pnpm --filter @eanhl/worker build
 *   node --test apps/worker/dist/__tests__/quick-check.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_MATCH_TYPES,
  quickCheckMatchTypes,
  runQuickCheck,
  type QuickCheckDeps,
  type QuickCheckTitle,
} from '../quick-check.js'

const NHL27: QuickCheckTitle = { id: 3, slug: 'nhl27' }
const NHL28: QuickCheckTitle = { id: 4, slug: 'nhl28' }

function fakes(over: { active?: QuickCheckTitle[]; newIn?: string; failList?: boolean } = {}) {
  const calls: string[] = []
  const deps: QuickCheckDeps<QuickCheckTitle> = {
    listActiveTitles: () => {
      if (over.failList) return Promise.reject(new Error('db down'))
      return Promise.resolve(over.active ?? [NHL27])
    },
    ingestMatchList: (title, matchType) => {
      calls.push(`match-list ${title.slug} ${matchType}`)
      return Promise.resolve({ matchesNew: over.newIn === `${title.slug} ${matchType}` ? 1 : 0 })
    },
    throttle: () => {
      calls.push('throttle')
      return Promise.resolve()
    },
    afterNewGames: (title) => {
      calls.push(`after-new ${title.slug}`)
      return Promise.resolve()
    },
    afterAllNewGames: () => {
      calls.push('after-all-new')
      return Promise.resolve()
    },
    markFinished: () => {
      calls.push('mark-finished')
      return Promise.resolve()
    },
    log: () => undefined,
  }
  return { deps, calls }
}

void test('only the 3 match lists, 1 s throttle after each call, then the stamp', async () => {
  const { deps, calls } = fakes()
  const r = await runQuickCheck({ titleSlug: null, matchType: null }, deps)
  assert.deepEqual(calls, [
    'match-list nhl27 gameType5',
    'throttle',
    'match-list nhl27 gameType10',
    'throttle',
    'match-list nhl27 club_private',
    'throttle',
    'mark-finished',
  ])
  assert.deepEqual(r, {
    calls: 3,
    newGames: 0,
    titles: ['nhl27'],
    matchTypes: [...ALL_MATCH_TYPES],
  })
  // The deps have no member stats, club record, season rank, settings or opponent info at all:
  // a quick check cannot reach those endpoints.
  assert.deepEqual(Object.keys(deps).sort(), [
    'afterAllNewGames',
    'afterNewGames',
    'ingestMatchList',
    'listActiveTitles',
    'log',
    'markFinished',
    'throttle',
  ])
})

void test('the event names the match type: one call', async () => {
  const { deps, calls } = fakes()
  const r = await runQuickCheck({ titleSlug: 'nhl27', matchType: 'club_private' }, deps)
  assert.equal(r.calls, 1)
  assert.deepEqual(calls, ['match-list nhl27 club_private', 'throttle', 'mark-finished'])
  assert.deepEqual(quickCheckMatchTypes('gameType99'), [...ALL_MATCH_TYPES])
  assert.deepEqual(quickCheckMatchTypes(null), [...ALL_MATCH_TYPES])
})

void test('the event names an active title: only that one; an unknown title: every active one', async () => {
  const one = fakes({ active: [NHL27, NHL28] })
  await runQuickCheck({ titleSlug: 'nhl28', matchType: 'gameType5' }, one.deps)
  assert.deepEqual(
    one.calls.filter((c) => c.startsWith('match-list')),
    ['match-list nhl28 gameType5'],
  )
  const all = fakes({ active: [NHL27, NHL28] })
  const r = await runQuickCheck({ titleSlug: 'nhl19', matchType: 'gameType5' }, all.deps)
  assert.deepEqual(r.titles, ['nhl27', 'nhl28'])
  assert.equal(r.calls, 2)
})

void test('a new game: AI goalies + aggregates for its title, card progression once, then the stamp', async () => {
  const { deps, calls } = fakes({ newIn: 'nhl27 gameType10' })
  const r = await runQuickCheck({ titleSlug: null, matchType: null }, deps)
  assert.equal(r.newGames, 1)
  assert.deepEqual(calls.slice(-3), ['after-new nhl27', 'after-all-new', 'mark-finished'])
})

void test('the stamp runs even when the check fails', async () => {
  const { deps, calls } = fakes({ failList: true })
  await assert.rejects(runQuickCheck({ titleSlug: null, matchType: null }, deps), /db down/)
  assert.deepEqual(calls, ['mark-finished'])
})
