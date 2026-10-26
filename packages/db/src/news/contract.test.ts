import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aiGoalieLabel,
  parseNewsFactsResponse,
  runMinimum,
  type NewsFactsResponse,
} from './contract.js'
import {
  AI_GOALIE_NAMES,
  CLUB_LORE,
  LORE_NAMES,
  FEATURE_KINDS,
  FEATURE_REPORTER,
  PRESS_LEVELS,
  REPORTERS,
  REPORTER_IDS,
  MILD_SWEAR_WORDS,
  RELATIONSHIPS,
  SIGNATURE_WORDS,
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
              position: 'F',
              isGoalie: false,
              goals: 1,
              assists: 0,
              points: 1,
              shots: 4,
              hits: 3,
              pim: 2,
              saves: null,
              goalsAgainst: null,
              savePct: null,
              star: 3,
              norm: null,
              bests: [],
              form: null,
              firsts: [],
              approaching: [],
              streaks: [],
              seasonTotals: null,
            },
            {
              playerId: 9,
              name: 'Wall',
              position: 'G',
              isGoalie: true,
              goals: 0,
              assists: 0,
              points: 0,
              shots: 0,
              hits: 0,
              pim: 0,
              saves: 23,
              goalsAgainst: 6,
              savePct: 79.31,
              star: null,
              norm: null,
              bests: [],
              form: null,
              firsts: [],
              approaching: [],
              streaks: [],
              seasonTotals: null,
            },
          ],
          aiGoalieInNet: false,
          aiGoalie: null,
          endedEarly: false,
          labels: null,
          patterns: [],
          context: null,
          teamNotes: [],
          headToHead: null,
          newRecords: [],
          chemistry: [],
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
          aiGoalie: {
            name: 'Matteo Lehmann',
            saves: 12,
            shotsAgainst: 16,
            goalsAgainst: 4,
            savePct: 75,
            label: null,
          },
          endedEarly: false,
          labels: null,
          patterns: [],
          context: null,
          teamNotes: [],
          headToHead: null,
          newRecords: [],
          chemistry: [],
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
      people: [{ playerId: 2, name: 'Silky', pressLevel: 'full' }],
      history: [],
      weekPlayers: [],
      aiGoalieWeek: [],
      lore: ["The Boogeymen's farm team is the Oregon Outlaws."],
      norms: { '3s': null, '6s': null },
      records: [],
      threads: [],
      stances: [],
      scorecards: [],
      topFacts: [],
    },
    forbiddenNames: ['Hidden Guy'],
    takes: [],
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

void test('contract: a full sample round-trips', () => {
  const s = sample()
  assert.deepEqual(parseNewsFactsResponse(clone(s)), s)
})

void test("contract: a person has no position (the game line has it); an old sheet's position is dropped (C2.11)", () => {
  const old = clone(sample()) as unknown as { facts: { people: Record<string, unknown>[] } }
  old.facts.people[0]!['position'] = 'C'
  const parsed = parseNewsFactsResponse(old)
  assert.deepEqual(parsed.facts.people, [{ playerId: 2, name: 'Silky', pressLevel: 'full' }])
})

void test('contract: player shots and hits may be null (a game that ended early, C2.10)', () => {
  const s = clone(sample()) as unknown as {
    facts: { games: { players: Record<string, unknown>[] }[] }
  }
  s.facts.games[0]!.players[0]!['shots'] = null
  s.facts.games[0]!.players[0]!['hits'] = null
  const p = parseNewsFactsResponse(s).facts.games[0]!.players[0]!
  assert.equal(p.shots, null)
  assert.equal(p.hits, null)
})

void test('AI goalie names: the two in-game names (C2.12)', () => {
  assert.deepEqual([...AI_GOALIE_NAMES], ['Matteo Lehmann', 'Jonas Wagner'])
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
      titleGoals: 100,
      titleAssists: 40,
      titlePoints: 140,
      titleGames: 80,
    },
  ]
  s.facts.aiGoalieWeek = [
    {
      name: 'Matteo Lehmann',
      games: 1,
      saves: 12,
      shotsAgainst: 16,
      goalsAgainst: 4,
      savePct: 75,
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
})

void test('contract: no plus-minus or game score reaches the writer; each line has its position (C1.4, C1.5)', () => {
  type L = {
    facts: {
      games: { players: Record<string, unknown>[] }[]
      weekPlayers: Record<string, unknown>[]
    }
  }
  // A web app that still sends them: the parser drops both fields.
  const old = clone(weekSample()) as unknown as L
  old.facts.games[0]!.players[0]!['plusMinus'] = -2
  old.facts.games[0]!.players[0]!['gameScore'] = 6.5
  old.facts.weekPlayers[0]!['plusMinus'] = -2
  const parsed = parseNewsFactsResponse(old)
  const line = parsed.facts.games[0]!.players[0]! as unknown as Record<string, unknown>
  assert.equal('plusMinus' in line, false)
  assert.equal('gameScore' in line, false)
  assert.equal(
    'plusMinus' in (parsed.facts.weekPlayers[0]! as unknown as Record<string, unknown>),
    false,
  )
  assert.equal(parsed.facts.games[0]!.players[0]!.star, 3)
  assert.deepEqual(
    parsed.facts.games[0]!.players.map((p) => p.position),
    ['F', 'G'],
  )
  // Position is required and one of F, D, G.
  const bad = (edit: (s: L) => void) => {
    const s = clone(weekSample()) as unknown as L
    edit(s)
    assert.throws(() => parseNewsFactsResponse(s), /players\[0\]\.position/)
  }
  bad((s) => delete s.facts.games[0]!.players[0]!['position'])
  bad((s) => (s.facts.games[0]!.players[0]!['position'] = 'center'))
  bad((s) => (s.facts.games[0]!.players[0]!['position'] = 'LD'))
  const d = clone(weekSample()) as unknown as L
  d.facts.games[0]!.players[0]!['position'] = 'D'
  assert.equal(parseNewsFactsResponse(d).facts.games[0]!.players[0]!.position, 'D')
})

void test('contract: the AI goalie line and week totals parse; missing ones read as none (C1.1)', () => {
  const s = weekSample()
  const parsed = parseNewsFactsResponse(clone(s))
  assert.equal(parsed.facts.games[0]!.aiGoalie, null)
  assert.deepEqual(parsed.facts.games[1]!.aiGoalie, {
    name: 'Matteo Lehmann',
    saves: 12,
    shotsAgainst: 16,
    goalsAgainst: 4,
    savePct: 75,
    label: null,
  })
  assert.deepEqual(parsed.facts.aiGoalieWeek, s.facts.aiGoalieWeek)
  // An AI goalie is never a person.
  assert.equal(
    parsed.facts.people.some((p) => p.name === 'Matteo Lehmann'),
    false,
  )
  // A sheet from a web app without them (deploy order).
  const old = clone(s) as unknown as {
    facts: { games: Record<string, unknown>[] } & Record<string, unknown>
  }
  delete old.facts.games[1]!['aiGoalie']
  delete old.facts['aiGoalieWeek']
  const o = parseNewsFactsResponse(old)
  assert.equal(o.facts.games[1]!.aiGoalie, null)
  assert.deepEqual(o.facts.aiGoalieWeek, [])
})

void test('contract: rejects a bad AI goalie line or week row (C1.1)', () => {
  type A = {
    facts: {
      games: { aiGoalie: Record<string, unknown> }[]
      aiGoalieWeek: Record<string, unknown>[]
    }
  }
  const bad = (edit: (s: A) => void, re: RegExp) => {
    const s = clone(weekSample()) as unknown as A
    edit(s)
    assert.throws(() => parseNewsFactsResponse(s), re)
  }
  bad((s) => (s.facts.games[1]!.aiGoalie['name'] = 3), /games\[1\]\.aiGoalie\.name/)
  bad((s) => (s.facts.games[1]!.aiGoalie['saves'] = -1), /aiGoalie\.saves is negative/)
  bad((s) => (s.facts.games[1]!.aiGoalie['savePct'] = '75'), /aiGoalie\.savePct/)
  bad((s) => delete s.facts.games[1]!.aiGoalie['shotsAgainst'], /aiGoalie\.shotsAgainst/)
  bad((s) => (s.facts.aiGoalieWeek[0]!['games'] = 0.5), /aiGoalieWeek\[0\]\.games/)
  bad((s) => (s.facts.aiGoalieWeek = {} as never), /aiGoalieWeek is not an array/)
})

void test('contract: an ended-early game has no team numbers; endedEarly defaults to false (C1.3)', () => {
  type G = { facts: { games: Record<string, unknown>[] } }
  const s = clone(sample()) as unknown as G
  s.facts.games[1]!['endedEarly'] = true
  s.facts.games[1]!['team'] = null
  const parsed = parseNewsFactsResponse(s)
  assert.equal(parsed.facts.games[1]!.endedEarly, true)
  assert.equal(parsed.facts.games[1]!.team, null)
  assert.equal(parsed.facts.games[0]!.endedEarly, false)
  const old = clone(sample()) as unknown as G
  delete old.facts.games[0]!['endedEarly']
  assert.equal(parseNewsFactsResponse(old).facts.games[0]!.endedEarly, false)
  const bad = clone(sample()) as unknown as G
  bad.facts.games[0]!['endedEarly'] = 'yes'
  assert.throws(() => parseNewsFactsResponse(bad), /games\[0\]\.endedEarly/)
  // Team numbers only when the game did not end early.
  const both = clone(sample()) as unknown as G
  both.facts.games[0]!['endedEarly'] = true
  assert.throws(() => parseNewsFactsResponse(both), /games\[0\]\.team must be null/)
  const missing = clone(sample()) as unknown as G
  missing.facts.games[0]!['team'] = null
  assert.throws(() => parseNewsFactsResponse(missing), /games\[0\]\.team is not an object/)
})

void test('club lore: one entry, the farm team; its name is a lore name (spec 12.13, C1.7)', () => {
  assert.deepEqual([...CLUB_LORE], ["The Boogeymen's farm team is the Oregon Outlaws."])
  assert.deepEqual([...LORE_NAMES], ['Oregon Outlaws'])
  for (const name of LORE_NAMES) assert.ok(CLUB_LORE.some((l) => l.includes(name)))
})

void test('contract: lore parses; missing reads as empty; non-strings are rejected (C1.7)', () => {
  const s = sample()
  assert.deepEqual(parseNewsFactsResponse(clone(s)).facts.lore, s.facts.lore)
  const old = clone(s) as unknown as { facts: Record<string, unknown> }
  delete old.facts['lore']
  assert.deepEqual(parseNewsFactsResponse(old).facts.lore, [])
  const bad = clone(s) as unknown as { facts: Record<string, unknown> }
  bad.facts['lore'] = [3]
  assert.throws(() => parseNewsFactsResponse(bad), /facts\.lore\[0\]/)
})

// ── Part C1.2: team norms (spec 12.10) ──────────────────────────────────────

const NORM = (ours: number, theirs: number, leadPct: number) => ({ ours, theirs, leadPct })

function normSample(): NewsFactsResponse {
  const s = sample()
  s.facts.norms = {
    '3s': null,
    '6s': {
      sampleGames: 42,
      hits: NORM(14.2, 16.8, 35.7),
      shots: NORM(24.5, 19.1, 73.8),
      timeOnAttack: NORM(402.3, 311.9, 78.6),
      passPct: NORM(74.1, 70.3, 61.9),
      ppPct: null,
    },
  }
  s.facts.games[0]!.labels = {
    hitsFor: 'unusually high',
    hitsAgainst: 'typical',
    shotsFor: 'unusually low',
    shotsAgainst: 'typical',
    timeOnAttack: 'unusually low',
    passPct: null,
  }
  s.facts.games[0]!.patterns = ['the Boogeymen out-hit the opponent for the first time in 6 games']
  return s
}

void test('contract: norms, labels and patterns round-trip; missing ones read as none (C1.2)', () => {
  const s = normSample()
  assert.deepEqual(parseNewsFactsResponse(clone(s)), s)
  const old = clone(s) as unknown as {
    facts: { games: Record<string, unknown>[] } & Record<string, unknown>
  }
  delete old.facts['norms']
  delete old.facts.games[0]!['labels']
  delete old.facts.games[0]!['patterns']
  const o = parseNewsFactsResponse(old)
  assert.deepEqual(o.facts.norms, { '3s': null, '6s': null })
  // A null reads as no norms in either mode.
  const n = clone(s) as unknown as { facts: Record<string, unknown> }
  n.facts['norms'] = null
  assert.deepEqual(parseNewsFactsResponse(n).facts.norms, { '3s': null, '6s': null })
  assert.equal(o.facts.games[0]!.labels, null)
  assert.deepEqual(o.facts.games[0]!.patterns, [])
})

void test('contract: rejects bad norms, labels or patterns (C1.2)', () => {
  type N = {
    facts: {
      norms: Record<string, Record<string, Record<string, unknown> | number | null>>
      games: { labels: Record<string, unknown>; patterns: unknown }[]
    }
  }
  const bad = (edit: (s: N) => void, re: RegExp) => {
    const s = clone(normSample()) as unknown as N
    edit(s)
    assert.throws(() => parseNewsFactsResponse(s), re)
  }
  bad(
    (s) => (s.facts.norms['6s']!['hits'] = { ours: '14', theirs: 1, leadPct: 1 }),
    /norms\.6s\.hits\.ours/,
  )
  bad(
    (s) => delete (s.facts.norms['6s']!['shots'] as Record<string, unknown>)['leadPct'],
    /norms\.6s\.shots\.leadPct/,
  )
  bad((s) => (s.facts.norms['6s']!['sampleGames'] = 9.5), /norms\.6s\.sampleGames/)
  bad((s) => delete s.facts.norms['6s']!['ppPct'], /norms\.6s\.ppPct/)
  bad((s) => delete s.facts.norms['3s'], /norms\.3s is missing/)
  bad((s) => (s.facts.games[0]!.labels['hitsFor'] = 'normal'), /labels\.hitsFor/)
  bad((s) => delete s.facts.games[0]!.labels['passPct'], /labels\.passPct/)
  bad((s) => (s.facts.games[0]!.patterns = 'out-hit'), /patterns is not an array/)
})

// ── Part C2.2: team context, team notes, head-to-head (spec 12.15-12.16) ────

function contextSample(): NewsFactsResponse {
  const s = sample()
  s.facts.games[0]!.context = {
    result: 'blip',
    streakBefore: { kind: 'W', count: 7 },
    streakAfter: { kind: 'L', count: 1 },
    last10: { wins: 8, losses: 1, otl: 1 },
    margin: 'blowout',
    surprise: 'big upset',
    night: ['2nd loss of the night'],
  }
  s.facts.games[0]!.teamNotes = ['100th game of the title']
  s.facts.games[0]!.headToHead = {
    wins: 2,
    losses: 1,
    otl: 0,
    lastMeeting: { result: 'WIN', scoreFor: 4, scoreAgainst: 2, night: '2026-10-01' },
  }
  return s
}

void test('contract: context, team notes and head-to-head round-trip; missing ones read as none (C2.2)', () => {
  const s = contextSample()
  assert.deepEqual(parseNewsFactsResponse(clone(s)), s)
  const old = clone(s) as unknown as { facts: { games: Record<string, unknown>[] } }
  delete old.facts.games[0]!['context']
  delete old.facts.games[0]!['teamNotes']
  delete old.facts.games[0]!['headToHead']
  const g = parseNewsFactsResponse(old).facts.games[0]!
  assert.equal(g.context, null)
  assert.deepEqual(g.teamNotes, [])
  assert.equal(g.headToHead, null)
})

void test('contract: context labels have a fixed vocabulary (C2.2)', () => {
  type G = { facts: { games: Record<string, Record<string, unknown>>[] } }
  const bad = (edit: (s: G) => void, re: RegExp) => {
    const s = clone(contextSample()) as unknown as G
    edit(s)
    assert.throws(() => parseNewsFactsResponse(s), re)
  }
  bad((s) => (s.facts.games[0]!['context']!['result'] = 'meltdown'), /context\.result/)
  bad((s) => (s.facts.games[0]!['context']!['margin'] = 'huge'), /context\.margin/)
  bad((s) => (s.facts.games[0]!['context']!['surprise'] = 'shock'), /context\.surprise/)
  bad((s) => delete s.facts.games[0]!['context']!['last10'], /context\.last10/)
  bad(
    (s) =>
      ((s.facts.games[0]!['headToHead']!['lastMeeting'] as Record<string, unknown>)['night'] =
        'May 1'),
    /headToHead\.lastMeeting\.night/,
  )
})

function playerFactsSample(): NewsFactsResponse {
  const s = sample()
  const p = s.facts.games[0]!.players[0]!
  p.norm = {
    games: 14,
    perGame: { goals: 0.4, assists: 0.6, points: 1, shots: 3.2, hits: 2.1 },
    last10: { goals: 0.5, assists: 0.7, points: 1.2 },
    labels: {
      goals: 'big for him',
      assists: 'typical',
      points: 'typical',
      shots: 'quiet for him',
      hits: 'typical',
    },
  }
  p.bests = ['season high goals', 'career high hits']
  p.form = 'heating up'
  p.firsts = ['first hat trick of the season']
  p.approaching = [{ stat: 'goals', value: 50, remaining: 2 }]
  return s
}

void test('contract: player norms, bests, form, firsts and approaching round-trip; missing ones read as none (C2.3)', () => {
  const s = playerFactsSample()
  assert.deepEqual(parseNewsFactsResponse(clone(s)), s)
  const old = clone(s) as unknown as { facts: { games: { players: Record<string, unknown>[] }[] } }
  for (const k of ['norm', 'bests', 'form', 'firsts', 'approaching']) {
    delete old.facts.games[0]!.players[0]![k]
  }
  const p = parseNewsFactsResponse(old).facts.games[0]!.players[0]!
  assert.deepEqual(
    { norm: p.norm, bests: p.bests, form: p.form, firsts: p.firsts, approaching: p.approaching },
    { norm: null, bests: [], form: null, firsts: [], approaching: [] },
  )
})

void test('contract: player labels, bests, form and firsts have a fixed vocabulary (C2.3)', () => {
  type P = { facts: { games: { players: Record<string, Record<string, unknown> & object>[] }[] } }
  const bad = (edit: (p: Record<string, unknown>) => void, re: RegExp) => {
    const s = clone(playerFactsSample()) as unknown as P
    edit(s.facts.games[0]!.players[0]!)
    assert.throws(() => parseNewsFactsResponse(s), re)
  }
  bad(
    (p) => ((p['norm'] as { labels: Record<string, unknown> }).labels['goals'] = 'huge'),
    /norm\.labels\.goals/,
  )
  bad(
    (p) => delete (p['norm'] as { perGame: Record<string, unknown> }).perGame['hits'],
    /norm\.perGame\.hits/,
  )
  bad((p) => (p['bests'] = ['all-time high goals']), /bests\[0\]/)
  bad((p) => (p['form'] = 'on fire'), /form/)
  bad((p) => (p['firsts'] = ['first goal ever']), /firsts\[0\]/)
  bad(
    (p) => (p['approaching'] = [{ stat: 'hits', value: 50, remaining: 2 }]),
    /approaching\[0\]\.stat/,
  )
})

void test('contract: streaks, debut and return round-trip; missing ones read as none or stay absent (C2.5)', () => {
  const s = sample()
  const p = s.facts.games[0]!.players[0]!
  p.streaks = [
    { kind: 'points', games: 5, status: 'extended' },
    { kind: 'noGoal', games: 9, status: 'ended' },
  ]
  p.debut = 'title'
  p.returnAfterDays = 41
  assert.deepEqual(parseNewsFactsResponse(clone(s)), s)
  const none = parseNewsFactsResponse(sample()).facts.games[0]!.players[0]!
  assert.equal('debut' in none, false)
  assert.equal('returnAfterDays' in none, false)
  const old = clone(sample()) as unknown as {
    facts: { games: { players: Record<string, unknown>[] }[] }
  }
  delete old.facts.games[0]!.players[0]!['streaks']
  assert.deepEqual(parseNewsFactsResponse(old).facts.games[0]!.players[0]!.streaks, [])
  const bad = clone(s) as unknown as { facts: { games: { players: Record<string, unknown>[] }[] } }
  bad.facts.games[0]!.players[0]!['debut'] = 'league'
  assert.throws(() => parseNewsFactsResponse(bad), /debut/)
  bad.facts.games[0]!.players[0]!['debut'] = 'club'
  bad.facts.games[0]!.players[0]!['streaks'] = [{ kind: 'assists', games: 3, status: 'extended' }]
  assert.throws(() => parseNewsFactsResponse(bad), /streaks\[0\]\.kind/)
})

void test('contract: records, new records and season totals round-trip; missing ones read as none (C2.4)', () => {
  const s = sample()
  s.facts.records = [
    { stat: 'goals', holder: null, holderPressLevel: null, value: 61, title: 'NHL 24' },
    { stat: 'points', holder: 'Silky', holderPressLevel: 'easy', value: 140, title: 'NHL 25' },
  ]
  s.facts.games[0]!.newRecords = [{ stat: 'points', name: 'Silky', value: 101 }]
  s.facts.games[0]!.players[0]!.seasonTotals = { goals: 40, assists: 61, points: 101, games: 70 }
  assert.deepEqual(parseNewsFactsResponse(clone(s)), s)
  const old = clone(s) as unknown as {
    facts: Record<string, unknown> & {
      games: (Record<string, unknown> & { players: Record<string, unknown>[] })[]
    }
  }
  delete old.facts['records']
  delete old.facts.games[0]!['newRecords']
  delete old.facts.games[0]!.players[0]!['seasonTotals']
  const p = parseNewsFactsResponse(old)
  assert.deepEqual(p.facts.records, [])
  assert.deepEqual(p.facts.games[0]!.newRecords, [])
  assert.equal(p.facts.games[0]!.players[0]!.seasonTotals, null)
  const bad = clone(s) as unknown as { facts: { records: Record<string, unknown>[] } }
  bad.facts.records[0]!['stat'] = 'hits'
  assert.throws(() => parseNewsFactsResponse(bad), /records\[0\]\.stat/)
})

void test('contract: chemistry round-trips; missing reads as none; a pair is two names (C2.6)', () => {
  const s = sample()
  s.facts.games[0]!.chemistry = [
    { pair: ['Silky', 'Wall'], games: 16, wins: 12, losses: 3, otl: 1 },
  ]
  assert.deepEqual(parseNewsFactsResponse(clone(s)), s)
  const old = clone(s) as unknown as { facts: { games: Record<string, unknown>[] } }
  delete old.facts.games[0]!['chemistry']
  assert.deepEqual(parseNewsFactsResponse(old).facts.games[0]!.chemistry, [])
  const bad = clone(s) as unknown as {
    facts: { games: { chemistry: Record<string, unknown>[] }[] }
  }
  bad.facts.games[0]!.chemistry[0]!['pair'] = ['Silky']
  assert.throws(() => parseNewsFactsResponse(bad), /chemistry\[0\]\.pair is not two names/)
})

void test('contract: threads and stances round-trip; missing ones read as none; fixed kinds and reporters (C2.8)', () => {
  const s = sample()
  s.facts.threads = [
    {
      key: 'player-slump:2@2026-10-01',
      kind: 'player-slump',
      subject: 'Silky',
      since: '2026-10-01',
      status: 'open',
      summary: 'Silky: no goal in 9 games',
    },
  ]
  s.facts.stances = [
    {
      threadKey: 'player-slump:2@2026-10-01',
      reporter: 'quill',
      stance: 'It ends soon.',
      night: '2026-10-05',
    },
  ]
  assert.deepEqual(parseNewsFactsResponse(clone(s)), s)
  const old = clone(s) as unknown as { facts: Record<string, unknown> }
  delete old.facts['threads']
  delete old.facts['stances']
  const p = parseNewsFactsResponse(old)
  assert.deepEqual([p.facts.threads, p.facts.stances], [[], []])
  const bad = clone(s) as unknown as {
    facts: { threads: Record<string, unknown>[]; stances: Record<string, unknown>[] }
  }
  bad.facts.threads[0]!['kind'] = 'beef'
  assert.throws(() => parseNewsFactsResponse(bad), /threads\[0\]\.kind/)
  bad.facts.threads[0]!['kind'] = 'rival'
  bad.facts.stances[0]!['reporter'] = 'nobody'
  assert.throws(() => parseNewsFactsResponse(bad), /stances\[0\]\.reporter/)
})

void test('contract: scorecards round-trip; judged must be hits + misses; missing reads as none (C2.9)', () => {
  const s = sample()
  s.facts.scorecards = [{ reporter: 'quill', hits: 4, misses: 3, judged: 7 }]
  assert.deepEqual(parseNewsFactsResponse(clone(s)), s)
  const old = clone(s) as unknown as { facts: Record<string, unknown> }
  delete old.facts['scorecards']
  assert.deepEqual(parseNewsFactsResponse(old).facts.scorecards, [])
  const bad = clone(s) as unknown as { facts: { scorecards: Record<string, unknown>[] } }
  bad.facts.scorecards[0]!['judged'] = 8
  assert.throws(() => parseNewsFactsResponse(bad), /scorecards\[0\]\.judged is not hits \+ misses/)
})

void test('contract: ranked facts round-trip; missing reads as none (C2.7)', () => {
  const s = sample()
  s.facts.topFacts = [
    {
      id: 'g2501:p2:big:goals',
      text: 'Silky: 1 goal — big for him (season avg 0.2)',
      weight: 32,
      subject: 'Silky',
    },
    { id: 'g2501:blowout', text: 'Blowout: 6-2 loss to Shake N Bake', weight: 52, subject: null },
  ]
  assert.deepEqual(parseNewsFactsResponse(clone(s)), s)
  const old = clone(s) as unknown as { facts: Record<string, unknown> }
  delete old.facts['topFacts']
  assert.deepEqual(parseNewsFactsResponse(old).facts.topFacts, [])
  const bad = clone(s) as unknown as { facts: { topFacts: Record<string, unknown>[] } }
  bad.facts.topFacts[0]!['weight'] = 'high'
  assert.throws(() => parseNewsFactsResponse(bad), /topFacts\[0\]\.weight/)
})

void test('runMinimum: the floor, or the smallest N with rate^N <= 0.1 (C2 tuning)', () => {
  assert.equal(runMinimum(3, null), 3)
  assert.equal(runMinimum(3, 0), 3)
  assert.equal(runMinimum(3, 0.3), 3)
  assert.equal(runMinimum(3, 0.5), 4)
  assert.equal(runMinimum(3, 0.85), 15)
  assert.equal(runMinimum(8, 0.6), 8)
  assert.equal(runMinimum(8, 0.85), 15)
  assert.equal(runMinimum(3, 1), Number.POSITIVE_INFINITY)
})

void test('aiGoalieLabel: meltdown under 75% on 10+ shots, steal from 92% on 15+; the label parses (C2 fix M1)', () => {
  assert.equal(aiGoalieLabel(74.9, 10), 'meltdown')
  assert.equal(aiGoalieLabel(70, 9), null)
  assert.equal(aiGoalieLabel(75, 20), null)
  assert.equal(aiGoalieLabel(92, 15), 'steal')
  assert.equal(aiGoalieLabel(95, 14), null)
  assert.equal(aiGoalieLabel(null, 30), null)
  const s = sample()
  s.facts.games[1]!.aiGoalie!.label = 'meltdown'
  assert.deepEqual(parseNewsFactsResponse(clone(s)), s)
  const old = clone(s) as unknown as {
    facts: { games: { aiGoalie: Record<string, unknown> | null }[] }
  }
  delete old.facts.games[1]!.aiGoalie!['label']
  assert.equal(parseNewsFactsResponse(old).facts.games[1]!.aiGoalie!.label, null)
  old.facts.games[1]!.aiGoalie!['label'] = 'brick wall'
  assert.throws(() => parseNewsFactsResponse(old), /aiGoalie\.label/)
})

void test('voices (C3a.1): doubled word lists, used one or two at a time; formats for articles only', () => {
  for (const id of REPORTER_IDS) {
    const r = REPORTERS[id]
    assert.deepEqual(SIGNATURE_WORDS[id], r.signatureWords, id)
    assert.ok(r.typicalWords.length >= 10, id)
    // The counted signature words are a subset of the typical words the voice lists.
    for (const w of r.signatureWords) assert.ok(r.typicalWords.includes(w), `${id}: ${w}`)
    for (const w of r.typicalWords) assert.ok(r.voice.includes(w), `${id}: ${w}`)
    assert.match(r.voice, /Use one or two of them at most per piece, and vary them/, id)
    assert.match(r.voice, /This format is for articles only\. A post makes one point/, id)
    // The blocked format labels never appear in a voice the writer could copy.
    assert.ok(!/the tactical point|less comfortable|the detail:/i.test(r.voice), id)
  }
  // C3a fix S3: generic and label words are not counted as signature words.
  assert.deepEqual(SIGNATURE_WORDS.barlow, ['messy', 'repeatable', 'structure', 'survive'])
  assert.deepEqual(SIGNATURE_WORDS.voss, ['settled', 'weight', 'belief', 'voice'])
  assert.deepEqual(SIGNATURE_WORDS.halberd, ['volume', 'balance', 'gap'])
  assert.deepEqual(SIGNATURE_WORDS.quill, ['signal', 'sustainable', 'variance', 'underlying'])
  assert.deepEqual(SIGNATURE_WORDS.rink, ['ghosts', 'storm', 'teeth', 'iron', 'blood'])
  assert.deepEqual(SIGNATURE_WORDS.bergstrom, ['compete', 'this time of year', 'in my experience'])
  assert.deepEqual(SIGNATURE_WORDS.pettibone, [
    'frankly',
    'overrated',
    'the truth is',
    'soft',
    'embarrassing',
  ])
  for (const id of REPORTER_IDS) {
    for (const generic of [
      'clean',
      'detail',
      'quiet',
      'room',
      'the room',
      'margin',
      'pressure',
      'support',
      'trend',
      'conversion',
      'night',
      'honest',
    ]) {
      assert.ok(!SIGNATURE_WORDS[id].includes(generic), `${id}: ${generic}`)
    }
  }
})

void test('voices (C3a.1): Barlow worries only after a loss, a one-goal or OT game, a lost shot count', () => {
  assert.match(
    REPORTERS.barlow.voice,
    /only after a loss, a one-goal or overtime game, or a game in which the club lost the shot count/,
  )
  assert.match(REPORTERS.barlow.voice, /after any other win he skips this part/)
})

void test('voices (C3a.1): tone, mode opinions, language levels', () => {
  for (const id of ['mercer', 'pettibone'] as const) {
    assert.match(REPORTERS[id].voice, /keeps his caveats/, id)
  }
  for (const id of ['barlow', 'voss', 'halberd', 'vale', 'rink', 'bergstrom'] as const) {
    assert.match(REPORTERS[id].voice, /reads like a win.*never called luck/, id)
  }
  assert.match(REPORTERS.bergstrom.modeOpinion ?? '', /6s is real hockey and 3s is shinny/)
  assert.match(REPORTERS.vale.modeOpinion ?? '', /loves the chaos of 3s/)
  assert.match(REPORTERS.pettibone.modeOpinion ?? '', /mocks 3s/)
  assert.match(REPORTERS.quill.modeOpinion ?? '', /does not care whether a game is 3s or 6s/)
  for (const id of ['barlow', 'voss', 'mercer', 'halberd', 'rink'] as const) {
    assert.equal(REPORTERS[id].modeOpinion, null, id)
  }
  for (const id of REPORTER_IDS) {
    const r = REPORTERS[id]
    if (r.modeOpinion !== null) assert.ok(r.voice.includes(r.modeOpinion), id)
    const mild = ['mercer', 'pettibone', 'vale'].includes(id)
    assert.equal(r.language, mild ? 'mild' : 'clean', id)
    assert.match(r.voice, mild ? /mild swearing \(hell, damn, crap\)/ : /Language: clean/, id)
  }
  assert.deepEqual([...MILD_SWEAR_WORDS], ['hell', 'damn', 'crap'])
  assert.match(REPORTERS.vale.voice, /not only overtime/)
})
