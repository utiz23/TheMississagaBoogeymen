import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNewsFactsResponse, type NewsFactsResponse } from './contract.js'
import { PRESS_LEVELS, REPORTERS, REPORTER_IDS, RELATIONSHIPS, reporterBySlug } from './index.js'

function sample(): NewsFactsResponse {
  return {
    facts: {
      kind: 'night',
      key: '2026-10-12',
      gameTitleName: 'NHL 26',
      games: [
        {
          matchId: 2501,
          night: '2026-10-12',
          playedAt: '2026-10-12T23:28:49.000Z',
          gameTitleName: 'NHL 26',
          gameMode: '6s',
          result: 'LOSS',
          overtime: false,
          scoreFor: 2,
          scoreAgainst: 6,
          opponentName: 'Shake N Bake',
          team: {
            shotsFor: 14,
            shotsAgainst: 29,
            hitsFor: 20,
            hitsAgainst: 18,
            ppGoals: 0,
            ppOpportunities: 3,
            passPct: 71.5,
            timeOnAttackSeconds: 210,
          },
          periods: [{ period: 1, goalsFor: 1, goalsAgainst: 2 }],
          players: [
            {
              playerId: 2,
              name: 'Silky',
              isGoalie: false,
              goals: 1,
              assists: 0,
              points: 1,
              shots: 4,
              hits: 3,
              plusMinus: -2,
              pim: 2,
              saves: null,
              goalsAgainst: null,
              savePct: null,
              gameScore: 6.5,
              star: 3,
            },
            {
              playerId: 9,
              name: 'Wall',
              isGoalie: true,
              goals: 0,
              assists: 0,
              points: 0,
              shots: 0,
              hits: 0,
              plusMinus: 0,
              pim: 0,
              saves: 23,
              goalsAgainst: 6,
              savePct: 79.31,
              gameScore: null,
              star: null,
            },
          ],
          aiGoalieInNet: false,
          guestCount: 1,
        },
        {
          matchId: 2502,
          night: '2026-10-12',
          playedAt: '2026-10-13T02:10:00.000Z',
          gameTitleName: 'NHL 26',
          gameMode: null,
          result: 'OTL',
          overtime: true,
          scoreFor: 3,
          scoreAgainst: 4,
          opponentName: 'WestKent Creamers',
          team: {
            shotsFor: 3,
            shotsAgainst: 16,
            hitsFor: 5,
            hitsAgainst: 9,
            ppGoals: null,
            ppOpportunities: null,
            passPct: null,
            timeOnAttackSeconds: null,
          },
          periods: null,
          players: [],
          aiGoalieInNet: true,
          guestCount: 0,
        },
      ],
      nightTotals: {
        goalsFor: 5,
        goalsAgainst: 10,
        shotsFor: 17,
        shotsAgainst: 45,
        wins: 0,
        losses: 1,
        otl: 1,
      },
      record: { wins: 10, losses: 4, otl: 1 },
      streak: { kind: 'L', count: 2 },
      unlocks: [{ playerId: 2, name: 'Silky', text: 'Badge unlocked' }],
      milestones: [{ playerId: 2, name: 'Silky', stat: 'goals', value: 100 }],
      recentNights: [
        { night: '2026-10-10', wins: 3, losses: 1, otl: 0, goalsFor: 14, goalsAgainst: 8 },
      ],
      people: [{ playerId: 2, name: 'Silky', position: 'C', pressLevel: 'full' }],
    },
    forbiddenNames: ['Hidden Guy'],
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

void test('contract: a full sample round-trips', () => {
  const s = sample()
  assert.deepEqual(parseNewsFactsResponse(clone(s)), s)
})

void test('contract: a null streak is accepted', () => {
  const s = sample()
  s.facts.streak = null
  assert.deepEqual(parseNewsFactsResponse(clone(s)), s)
})

void test('contract: rejects a bad result', () => {
  const s = clone(sample()) as unknown as { facts: { games: { result: string }[] } }
  s.facts.games[0]!.result = 'DNF'
  assert.throws(() => parseNewsFactsResponse(s), /result/)
})

void test('contract: rejects a non-integer playerId', () => {
  const s = clone(sample())
  s.facts.people[0]!.playerId = 2.5
  assert.throws(() => parseNewsFactsResponse(s), /playerId/)
})

void test('contract: rejects pressLevel out (and anything else)', () => {
  const s = clone(sample()) as unknown as { facts: { people: { pressLevel: string }[] } }
  s.facts.people[0]!.pressLevel = 'out'
  assert.throws(() => parseNewsFactsResponse(s), /pressLevel/)
  s.facts.people[0]!.pressLevel = 'loud'
  assert.throws(() => parseNewsFactsResponse(s), /pressLevel/)
})

void test('contract: rejects a missing forbiddenNames and non-string entries', () => {
  const s = clone(sample()) as unknown as Record<string, unknown>
  delete s['forbiddenNames']
  assert.throws(() => parseNewsFactsResponse(s), /forbiddenNames/)
  s['forbiddenNames'] = [1]
  assert.throws(() => parseNewsFactsResponse(s), /forbiddenNames/)
})

void test('contract: rejects bad enums, star values and non-objects', () => {
  const a = clone(sample()) as unknown as { facts: { kind: string } }
  a.facts.kind = 'month'
  assert.throws(() => parseNewsFactsResponse(a), /kind/)
  const b = clone(sample()) as unknown as {
    facts: { games: { players: { star: number }[] }[] }
  }
  b.facts.games[0]!.players[0]!.star = 4
  assert.throws(() => parseNewsFactsResponse(b), /star/)
  const c = clone(sample()) as unknown as { facts: { games: { gameMode: string }[] } }
  c.facts.games[0]!.gameMode = '5s'
  assert.throws(() => parseNewsFactsResponse(c), /gameMode/)
  const d = clone(sample()) as unknown as { facts: { streak: { kind: string } } }
  d.facts.streak.kind = 'T'
  assert.throws(() => parseNewsFactsResponse(d), /streak/)
  assert.throws(() => parseNewsFactsResponse(null), /root/)
  assert.throws(() => parseNewsFactsResponse([]), /root/)
})

void test('contract: rejects a key or night that is not YYYY-MM-DD', () => {
  const a = clone(sample())
  a.facts.key = 'tonight'
  assert.throws(() => parseNewsFactsResponse(a), /facts\.key/)
  const b = clone(sample())
  b.facts.games[0]!.night = '2026-10-12T00:00:00Z'
  assert.throws(() => parseNewsFactsResponse(b), /games\[0\]\.night/)
  const c = clone(sample())
  c.facts.recentNights[0]!.night = '10/10/2026'
  assert.throws(() => parseNewsFactsResponse(c), /recentNights\[0\]\.night/)
})

void test('contract: rejects a missing nested number', () => {
  const s = clone(sample()) as unknown as {
    facts: { games: { team: Record<string, unknown> }[] }
  }
  delete s.facts.games[0]!.team['shotsFor']
  assert.throws(() => parseNewsFactsResponse(s), /shotsFor/)
})

void test('reporters: seven, unique slugs, lookup by slug', () => {
  assert.equal(REPORTER_IDS.length, 7)
  const slugs = REPORTER_IDS.map((id) => REPORTERS[id].slug)
  assert.equal(new Set(slugs).size, 7)
  assert.deepEqual(slugs, [
    'wade-barlow',
    'talia-voss',
    'dex-mercer',
    'june-halberd',
    'rico-vale',
    'mara-quill',
    'father-rink',
  ])
  for (const id of REPORTER_IDS) {
    const r = REPORTERS[id]
    assert.equal(r.id, id)
    assert.ok(r.name && r.outlet && r.byline && r.initials && r.bio && r.voice)
    assert.match(r.tint, /^#[0-9a-f]{6}$/)
    assert.equal(reporterBySlug(r.slug), r)
  }
  assert.equal(reporterBySlug('nobody'), null)
  assert.equal(reporterBySlug('__proto__'), null)
})

void test('reporters: Barlow voice drops the quote line; no markdown headings', () => {
  const v = REPORTERS.barlow.voice
  assert.ok(!/one quote/i.test(v))
  assert.match(v, /one line quoting another reporter, or none/)
  for (const id of REPORTER_IDS) assert.ok(!/^#/m.test(REPORTERS[id].voice), id)
})

void test('relationships: seven lines between known reporters; press levels re-exported', () => {
  assert.equal(RELATIONSHIPS.length, 7)
  for (const r of RELATIONSHIPS) {
    assert.ok(REPORTER_IDS.includes(r.from))
    assert.ok(REPORTER_IDS.includes(r.to))
    assert.ok(r.note.length > 0)
  }
  assert.deepEqual([...PRESS_LEVELS], ['full', 'easy', 'out'])
})
