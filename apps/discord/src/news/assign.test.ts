import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assignArticle,
  assignGamePosts,
  isAllowed,
  isoWeekNumber,
  type Activity,
} from './assign.ts'
import { oct12Facts } from './test-fixtures.ts'
import type { NewsFacts } from '@eanhl/db/news'

const NOW = new Date('2026-10-13T04:00:00.000Z')
const NIGHT = '2026-10-12'
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

void test('blowout_loss with Mercer already posted tonight: first is quill', () => {
  const activity: Activity = [{ reporter: 'mercer', night: NIGHT, createdAt: daysAgo(0.01) }]
  const r = assignGamePosts('blowout_loss', NOW, NIGHT, activity)
  assert.equal(r.first, 'quill')
  assert.equal(r.second, 'voss')
})

void test('blowout_loss with a clean record: mercer first, quill second', () => {
  const r = assignGamePosts('blowout_loss', NOW, NIGHT, [])
  assert.deepEqual(r, { first: 'mercer', second: 'quill', secondIsReply: false })
})

void test('routine_win and quiet_win have no second post', () => {
  assert.equal(assignGamePosts('routine_win', NOW, NIGHT, []).second, null)
  assert.equal(assignGamePosts('quiet_win', NOW, NIGHT, []).second, null)
  assert.equal(assignGamePosts('routine_win', NOW, NIGHT, []).first, 'barlow')
  assert.equal(assignGamePosts('quiet_win', NOW, NIGHT, []).first, 'quill')
})

void test('ot_loss: Barlow after Mercer is a reply', () => {
  const r = assignGamePosts('ot_loss', NOW, NIGHT, [])
  assert.equal(r.first, 'mercer')
  assert.equal(r.second, 'barlow')
  assert.equal(r.secondIsReply, true)
})

void test('ot_win with Rink recently used still gives vale and barlow', () => {
  const r = assignGamePosts('ot_win', NOW, NIGHT, [])
  assert.equal(r.first, 'vale')
  assert.equal(r.second, 'barlow')
  assert.equal(r.secondIsReply, false)
})

void test('goalie_steal: voss then quill; quill replies to nobody', () => {
  const r = assignGamePosts('goalie_steal', NOW, NIGHT, [])
  assert.deepEqual(r, { first: 'voss', second: 'quill', secondIsReply: false })
})

void test('Rink: 10 days ago is not allowed, 15 days ago is', () => {
  assert.equal(
    isAllowed('rink', NOW, NIGHT, [{ reporter: 'rink', night: null, createdAt: daysAgo(10) }]),
    false,
  )
  assert.equal(
    isAllowed('rink', NOW, NIGHT, [{ reporter: 'rink', night: null, createdAt: daysAgo(15) }]),
    true,
  )
  assert.equal(isAllowed('rink', NOW, NIGHT, []), true)
})

void test('Mercer: one per night, three per 7 days', () => {
  const other = '2026-10-10'
  assert.equal(
    isAllowed('mercer', NOW, NIGHT, [
      { reporter: 'mercer', night: NIGHT, createdAt: daysAgo(0.1) },
    ]),
    false,
  )
  const three: Activity = [1, 2, 3].map((d) => ({
    reporter: 'mercer',
    night: `x${String(d)}`,
    createdAt: daysAgo(d),
  }))
  assert.equal(isAllowed('mercer', NOW, other, three), false)
  assert.equal(isAllowed('mercer', NOW, other, three.slice(1)), true)
  const old: Activity = [8, 9, 10].map((d) => ({
    reporter: 'mercer',
    night: `y${String(d)}`,
    createdAt: daysAgo(d),
  }))
  assert.equal(isAllowed('mercer', NOW, other, old), true)
  assert.equal(isAllowed('barlow', NOW, NIGHT, three), true)
})

void test('Rink in a game slot is skipped when not allowed', () => {
  const activity: Activity = [{ reporter: 'rink', night: null, createdAt: daysAgo(3) }]
  assert.equal(assignGamePosts('goalie_steal', NOW, NIGHT, []).first, 'voss')
  // goalie_steal [voss, quill, rink]: rink would only be third anyway
  assert.equal(assignGamePosts('goalie_steal', NOW, NIGHT, activity).second, 'quill')
})

void test('isoWeekNumber', () => {
  assert.equal(isoWeekNumber('2026-10-12'), 42)
  assert.equal(isoWeekNumber('2026-01-01'), 1)
  assert.equal(isoWeekNumber('2027-01-01'), 53)
  assert.equal(isoWeekNumber('2024-12-30'), 1)
})

function nightFacts(wins: number, losses: number, otl: number, games: number): NewsFacts {
  const f = oct12Facts('night')
  const g = f.games[0]!
  return {
    ...f,
    games: Array.from({ length: games }, () => g),
    nightTotals: { ...f.nightTotals, wins, losses, otl },
  }
}

void test('assignArticle by night situation', () => {
  assert.equal(assignArticle('night', nightFacts(3, 0, 0, 3), NOW, []), 'vale')
  assert.equal(assignArticle('night', nightFacts(2, 1, 0, 3), NOW, []), 'barlow')
  assert.equal(assignArticle('night', nightFacts(1, 1, 0, 2), NOW, []), 'halberd')
  assert.equal(assignArticle('night', nightFacts(1, 2, 0, 3), NOW, []), 'quill')
  assert.equal(assignArticle('night', nightFacts(0, 3, 0, 3), NOW, []), 'mercer')
  assert.equal(assignArticle('night', nightFacts(1, 0, 0, 1), NOW, []), 'barlow')
})

void test('assignArticle: Rink first on a long sweep or winless night, if allowed', () => {
  assert.equal(assignArticle('night', nightFacts(4, 0, 0, 4), NOW, []), 'rink')
  assert.equal(assignArticle('night', nightFacts(0, 4, 0, 4), NOW, []), 'rink')
  const recent: Activity = [{ reporter: 'rink', night: null, createdAt: daysAgo(5) }]
  assert.equal(assignArticle('night', nightFacts(4, 0, 0, 4), NOW, recent), 'vale')
  assert.equal(assignArticle('night', nightFacts(0, 4, 0, 4), NOW, recent), 'mercer')
})

void test('assignArticle: Mercer already posted tonight falls through on a winless night', () => {
  const activity: Activity = [{ reporter: 'mercer', night: NIGHT, createdAt: daysAgo(0.05) }]
  assert.equal(assignArticle('night', nightFacts(0, 3, 0, 3), NOW, activity), 'barlow')
})

void test('assignArticle for the week rotates by ISO week number mod 4', () => {
  const wk = (key: string): NewsFacts => ({ ...oct12Facts('week'), key })
  // 2026-10-12 is ISO week 42 -> 42 % 4 = 2 -> quill
  assert.equal(assignArticle('week', wk('2026-10-12'), NOW, []), 'quill')
  assert.equal(assignArticle('week', wk('2026-10-19'), NOW, []), 'voss') // week 43
  assert.equal(assignArticle('week', wk('2026-10-26'), NOW, []), 'quill') // week 44 -> 0
  assert.equal(assignArticle('week', wk('2026-11-02'), NOW, []), 'halberd') // week 45 -> 1
})
