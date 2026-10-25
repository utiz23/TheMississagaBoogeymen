import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNewsFactsResponse, type NewsFactsResponse } from './contract.js'
import {
  FEATURE_KINDS,
  FEATURE_REPORTER,
  PRESS_LEVELS,
  REPORTERS,
  REPORTER_IDS,
  RELATIONSHIPS,
  reporterBySlug,
} from './index.js'

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
          unnamedTeammates: 1,
          unnamedGoals: 1,
          unnamedAssists: 2,
          goals: [
            { period: '1st', clock: '05:12', side: 'for', scorer: 'Silky', assists: [] },
            { period: 'OT', clock: '01:40', side: 'against', scorer: null, assists: [] },
          ],
          clockMeaning: 'elapsed',
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
          unnamedTeammates: 0,
          unnamedGoals: 0,
          unnamedAssists: 0,
          goals: null,
          clockMeaning: null,
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
      history: [],
      weekPlayers: [],
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

void test('contract: unnamedTeammates is required and must be an integer', () => {
  const ok = parseNewsFactsResponse(clone(sample()))
  assert.equal(ok.facts.games[0]!.unnamedTeammates, 1)
  const s = clone(sample()) as unknown as { facts: { games: Record<string, unknown>[] } }
  delete s.facts.games[0]!['unnamedTeammates']
  assert.throws(() => parseNewsFactsResponse(s), /games\[0\]\.unnamedTeammates/)
  s.facts.games[0]!['unnamedTeammates'] = 1.5
  assert.throws(() => parseNewsFactsResponse(s), /unnamedTeammates is not an integer/)
})

void test('contract: unnamedGoals and unnamedAssists are required non-negative integers', () => {
  const ok = parseNewsFactsResponse(clone(sample()))
  assert.equal(ok.facts.games[0]!.unnamedGoals, 1)
  assert.equal(ok.facts.games[0]!.unnamedAssists, 2)
  for (const key of ['unnamedGoals', 'unnamedAssists']) {
    const missing = clone(sample()) as unknown as { facts: { games: Record<string, unknown>[] } }
    delete missing.facts.games[0]![key]
    assert.throws(() => parseNewsFactsResponse(missing), new RegExp(`games\\[0\\]\\.${key}`))
    const frac = clone(sample()) as unknown as { facts: { games: Record<string, unknown>[] } }
    frac.facts.games[0]![key] = 1.5
    assert.throws(() => parseNewsFactsResponse(frac), /is not an integer/)
    const neg = clone(sample()) as unknown as { facts: { games: Record<string, unknown>[] } }
    neg.facts.games[0]![key] = -1
    assert.throws(() => parseNewsFactsResponse(neg), /is negative/)
  }
})

void test('reporters: nine, unique slugs, lookup by slug (rev 2 adds Pettibone and Bergstrom last)', () => {
  assert.equal(REPORTER_IDS.length, 9)
  const slugs = REPORTER_IDS.map((id) => REPORTERS[id].slug)
  assert.equal(new Set(slugs).size, 9)
  assert.deepEqual(slugs, [
    'wade-barlow',
    'talia-voss',
    'dex-mercer',
    'june-halberd',
    'rico-vale',
    'mara-quill',
    'father-rink',
    'gord-pettibone',
    'lyle-bergstrom',
  ])
  assert.deepEqual(REPORTER_IDS.slice(7), ['pettibone', 'bergstrom'])
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

void test('reporters: Pettibone and Bergstrom (spec 12.2)', () => {
  const p = REPORTERS.pettibone
  assert.equal(p.name, 'Gord Pettibone')
  assert.equal(p.outlet, 'The Daily Slapshot')
  assert.equal(p.byline, 'Notes by Gord Pettibone, The Daily Slapshot')
  assert.equal(p.initials, 'GP')
  assert.equal(p.tint, '#facc15')
  const b = REPORTERS.bergstrom
  assert.equal(b.name, 'Lyle Bergstrom')
  assert.equal(b.outlet, 'Big Country Hockey')
  assert.equal(b.byline, 'Lyle Bergstrom, Big Country Hockey')
  assert.equal(b.initials, 'LB')
  assert.equal(b.tint, '#fb923c')
  for (const word of ['frankly', 'overrated', 'the truth is', 'soft', 'embarrassing']) {
    assert.ok(p.voice.includes(word), `pettibone: ${word}`)
  }
  for (const word of ['compete', 'honest', 'the room', 'this time of year', 'in my experience']) {
    assert.ok(b.voice.includes(word), `bergstrom: ${word}`)
  }
  assert.match(p.voice, /notes column/)
  assert.match(b.voice, /big picture/)
  // The shared rules travel in the voice: hockey-only criticism, facts only from the sheet.
  for (const r of [p, b]) {
    assert.match(r.voice, /criticism is about hockey only/i, r.id)
    assert.match(r.voice, /only from the fact sheet/i, r.id)
  }
  // Bergstrom's experience never becomes a fact: no "back in my day" claims.
  assert.match(b.voice, /never makes "back in my day" claims/)
  assert.match(b.voice, /numbers on the sheet/)
  // No real person: the new names appear nowhere else in the cast.
  for (const id of REPORTER_IDS.slice(0, 7)) {
    assert.ok(!/Pettibone|Bergstrom/.test(REPORTERS[id].voice), id)
  }
})

void test('relationships: rev 2 lines (spec 12.2)', () => {
  const has = (from: string, to: string, re: RegExp) =>
    assert.ok(
      RELATIONSHIPS.some((r) => r.from === from && r.to === to && re.test(r.note)),
      `${from} -> ${to}`,
    )
  has('pettibone', 'quill', /spreadsheet/)
  has('quill', 'pettibone', /fact-check/)
  has('pettibone', 'mercer', /outrage/)
  has('mercer', 'pettibone', /outrage/)
  has('bergstrom', 'barlow', /respect/)
  has('bergstrom', 'vale', /theatrics/)
})

void test('feature kinds: five kinds, each with its reporter (rev 2, 12.3)', () => {
  assert.deepEqual([...FEATURE_KINDS], ['trend', 'spotlight', 'notes', 'bigpicture', 'rink'])
  assert.deepEqual(FEATURE_REPORTER, {
    trend: 'quill',
    spotlight: 'voss',
    notes: 'pettibone',
    bigpicture: 'bergstrom',
    rink: 'rink',
  })
})

void test('relationships: lines between known reporters; press levels re-exported', () => {
  assert.equal(RELATIONSHIPS.length, 13)
  for (const r of RELATIONSHIPS) {
    assert.ok(REPORTER_IDS.includes(r.from))
    assert.ok(REPORTER_IDS.includes(r.to))
    assert.ok(r.note.length > 0)
  }
  assert.deepEqual([...PRESS_LEVELS], ['full', 'easy', 'out'])
})

void test('contract: a goal timeline parses; a missing timeline reads as none (B1)', () => {
  const ok = parseNewsFactsResponse(clone(sample()))
  assert.deepEqual(ok.facts.games[0]!.goals, sample().facts.games[0]!.goals)
  assert.equal(ok.facts.games[0]!.clockMeaning, 'elapsed')
  assert.equal(ok.facts.games[1]!.goals, null)
  assert.equal(ok.facts.games[1]!.clockMeaning, null)
  // A sheet from a web app without the timeline still parses (deploy order).
  const old = clone(sample()) as unknown as { facts: { games: Record<string, unknown>[] } }
  delete old.facts.games[0]!['goals']
  delete old.facts.games[0]!['clockMeaning']
  const parsed = parseNewsFactsResponse(old)
  assert.equal(parsed.facts.games[0]!.goals, null)
  assert.equal(parsed.facts.games[0]!.clockMeaning, null)
})

void test('contract: rejects a bad goal period, side, clock, scorer or clockMeaning (B1)', () => {
  type G = { facts: { games: { goals: Record<string, unknown>[]; clockMeaning: unknown }[] } }
  const bad = (edit: (s: G) => void, re: RegExp) => {
    const s = clone(sample()) as unknown as G
    edit(s)
    assert.throws(() => parseNewsFactsResponse(s), re)
  }
  bad((s) => (s.facts.games[0]!.goals[0]!['period'] = 'SO'), /goals\[0\]\.period/)
  bad((s) => (s.facts.games[0]!.goals[0]!['period'] = 2), /goals\[0\]\.period/)
  bad((s) => (s.facts.games[0]!.goals[0]!['side'] = 'bgm'), /goals\[0\]\.side/)
  bad((s) => (s.facts.games[0]!.goals[0]!['clock'] = '5 min'), /goals\[0\]\.clock/)
  bad((s) => (s.facts.games[0]!.goals[0]!['scorer'] = 7), /goals\[0\]\.scorer/)
  bad((s) => (s.facts.games[0]!.goals[0]!['assists'] = [1]), /goals\[0\]\.assists/)
  bad((s) => (s.facts.games[0]!.clockMeaning = 'up'), /clockMeaning/)
  bad((s) => (s.facts.games[0]!.clockMeaning = null), /clockMeaning/)
})

function weekSample(): NewsFactsResponse {
  const s = sample()
  s.facts.kind = 'week'
  s.facts.key = '2026-10-12'
  s.facts.history = [
    {
      weekStart: '2026-09-21',
      wins: 2,
      losses: 1,
      otl: 0,
      goalsFor: 11,
      goalsAgainst: 7,
      shotsFor: 60,
      shotsAgainst: 41,
      ppGoals: 1,
      ppOpportunities: 4,
    },
    {
      weekStart: '2026-10-05',
      wins: 0,
      losses: 2,
      otl: 1,
      goalsFor: 4,
      goalsAgainst: 9,
      shotsFor: 33,
      shotsAgainst: 50,
      ppGoals: 0,
      ppOpportunities: 2,
    },
  ]
  s.facts.weekPlayers = [
    {
      playerId: 2,
      name: 'Silky',
      games: 2,
      goals: 3,
      assists: 1,
      points: 4,
      shots: 9,
      hits: 5,
      plusMinus: -2,
      titleGoals: 100,
      titleAssists: 40,
      titlePoints: 140,
      titleGames: 80,
    },
  ]
  return s
}

void test('contract: a week sheet with history and weekPlayers round-trips (rev 2, A4)', () => {
  const s = weekSample()
  assert.deepEqual(parseNewsFactsResponse(clone(s)), s)
})

void test('contract: missing history and weekPlayers read as empty (deploy order, A4)', () => {
  const old = clone(weekSample()) as unknown as { facts: Record<string, unknown> }
  delete old.facts['history']
  delete old.facts['weekPlayers']
  const parsed = parseNewsFactsResponse(old)
  assert.deepEqual(parsed.facts.history, [])
  assert.deepEqual(parsed.facts.weekPlayers, [])
})

void test('contract: rejects a bad history or weekPlayers row (A4)', () => {
  type W = { facts: { history: Record<string, unknown>[]; weekPlayers: Record<string, unknown>[] } }
  const bad = (edit: (s: W) => void, re: RegExp) => {
    const s = clone(weekSample()) as unknown as W
    edit(s)
    assert.throws(() => parseNewsFactsResponse(s), re)
  }
  bad((s) => (s.facts.history[0]!['weekStart'] = 'last week'), /history\[0\]\.weekStart/)
  bad((s) => (s.facts.history[1]!['wins'] = -1), /history\[1\]\.wins is negative/)
  bad((s) => delete s.facts.history[0]!['ppOpportunities'], /history\[0\]\.ppOpportunities/)
  bad((s) => (s.facts.history = {} as never), /facts\.history is not an array/)
  bad((s) => (s.facts.weekPlayers[0]!['titlePoints'] = 1.5), /weekPlayers\[0\]\.titlePoints/)
  bad((s) => (s.facts.weekPlayers[0]!['name'] = 7), /weekPlayers\[0\]\.name/)
  bad((s) => (s.facts.weekPlayers[0]!['games'] = -1), /weekPlayers\[0\]\.games is negative/)
  // plusMinus may be negative.
  const ok = clone(weekSample())
  ok.facts.weekPlayers[0]!.plusMinus = -7
  assert.equal(parseNewsFactsResponse(ok).facts.weekPlayers[0]!.plusMinus, -7)
})
