/**
 * Run (after `pnpm --filter @eanhl/db build`):
 *   node --test apps/web/src/components/roster/build-locker-model.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { PlayerBuild, PlayerBuilds } from '@eanhl/db/queries'
import { BUILD_ATTRIBUTE_GROUPS, toBuildLockerView } from './build-locker-model.ts'

const ALL_KEYS = BUILD_ATTRIBUTE_GROUPS.flatMap((g) => g.attrs.map((a) => a.key))

const build = (partial: Partial<PlayerBuild> = {}): PlayerBuild => ({
  archetype: 'Power Forward',
  heightText: null,
  weightLbs: null,
  handedness: null,
  xFactors: [],
  attributes: Object.fromEntries(ALL_KEYS.map((k) => [k, k === 'deking' ? null : 80])),
  gp: 1,
  wins: 1,
  losses: 0,
  otl: 0,
  firstPlayed: new Date('2026-05-09T20:00:00Z'),
  lastPlayed: new Date('2026-05-09T20:00:00Z'),
  ...partial,
})

const data = (builds: PlayerBuild[], older: PlayerBuild | null = null): PlayerBuilds => ({
  gameTitleId: 1,
  gameTitleName: 'NHL 26',
  builds,
  older,
  persona: null,
})

void test('the 5 groups hold the 23 attributes of the game sheet', () => {
  assert.deepEqual(
    BUILD_ATTRIBUTE_GROUPS.map((g) => [g.name, g.attrs.length]),
    [
      ['Technique', 5],
      ['Power', 5],
      ['Playstyle', 5],
      ['Tenacity', 4],
      ['Tactics', 4],
    ],
  )
  assert.equal(new Set(ALL_KEYS).size, 23)
})

void test('single build (Stick Menace): Current tile, no delta, empty note', () => {
  const v = toBuildLockerView(
    data([
      build({
        weightLbs: 220,
        gp: 2,
        wins: 2,
        xFactors: [
          { name: 'Big_Rig', tier: 'Elite' },
          { name: 'One_T', tier: 'Elite' },
          { name: 'Ankle_Breaker', tier: 'Elite' },
        ],
      }),
    ]),
  )
  assert.equal(v.titleName, 'NHL 26')
  assert.equal(v.count, 1)
  const tile = v.tiles[0]
  assert.ok(tile)
  assert.deepEqual(
    [tile.tag, tile.current, tile.arcName, tile.body, tile.gp, tile.record],
    ['Current', true, 'Power Forward', '220 lb', 2, '2–0–0'],
  )
  assert.deepEqual(
    tile.xf.map((x) => [x.abbr, x.title, x.tier, x.src]),
    [
      [
        'BR',
        'Big Rig — Elite',
        'Elite',
        '/assets/x-factors/Big_Rig/NHL_26_Big_Rig_X-Factor_Image__Red__File.png',
      ],
      [
        'OT',
        'One T — Elite',
        'Elite',
        '/assets/x-factors/One_T/NHL_26_One_T_X-Factor_Image__Red__File.png',
      ],
      [
        'AB',
        'Ankle Breaker — Elite',
        'Elite',
        '/assets/x-factors/Ankle_Breaker/NHL_26_Ankle_Breaker_X-Factor_Image__Red__File.png',
      ],
    ],
  )
  assert.equal(v.totalGp, 2)
  const d = v.details[0]
  assert.ok(d)
  assert.equal(d.meta, 'Current · 220 lb · 2 GP · 2–0–0')
  assert.equal(d.note, '')
  assert.deepEqual([d.up, d.down], [0, 0])
  assert.ok(d.groups.every((g) => g.dTxt === '' && g.attrs.every((a) => a.dTxt === '')))
})

void test('deltas against the next-older build: signs, text and bar segments', () => {
  const newer = build({ attributes: { ...build().attributes, faceoffs: 26, passing: 91 } })
  const olderShown = build({
    archetype: 'Puck Moving Defenseman',
    lastPlayed: new Date('2026-05-12T20:00:00Z'),
    attributes: { ...build().attributes, faceoffs: 92, passing: 88 },
  })
  const v = toBuildLockerView(data([newer, olderShown]))
  const tactics = v.details[0]?.groups.find((g) => g.name === 'Tactics')
  const faceoffs = tactics?.attrs.find((a) => a.label === 'Faceoffs')
  assert.deepEqual(faceoffs, {
    label: 'Faceoffs',
    v: '26',
    dTxt: '-66',
    dSign: -1,
    baseW: 26,
    segL: 26,
    segW: 66,
  })
  const passing = v.details[0]?.groups
    .find((g) => g.name === 'Playstyle')
    ?.attrs.find((a) => a.label === 'Passing')
  assert.deepEqual(passing, {
    label: 'Passing',
    v: '91',
    dTxt: '+3',
    dSign: 1,
    baseW: 88,
    segL: 88,
    segW: 3,
  })
  assert.equal(v.details[0]?.note, 'Δ vs May 12 build')
  assert.deepEqual([v.details[0]?.up, v.details[0]?.down], [1, 1])
  assert.equal(v.tiles[1]?.tag, 'May 12')
  const olderDetail = v.details[1]
  assert.ok(olderDetail)
  assert.equal(olderDetail.meta, 'Last used May 12 · 1 GP · 1–0–0')
  assert.equal(olderDetail.note, '')
})

void test('the older build supplies the delta for the last shown tile', () => {
  const v = toBuildLockerView(
    data([build()], build({ attributes: { ...build().attributes, speed: 70 } })),
  )
  const speed = v.details[0]?.groups[0]?.attrs.find((a) => a.label === 'Speed')
  assert.equal(speed?.dTxt, '+10')
  assert.equal(v.details[0]?.note, 'Δ vs May 9 build')
})

void test('null attribute (deking): dash, no bar, out of the group average, no delta', () => {
  const v = toBuildLockerView(data([build()], build({ attributes: { ...build().attributes } })))
  const tactics = v.details[0]?.groups.find((g) => g.name === 'Tactics')
  const deking = tactics?.attrs.find((a) => a.label === 'Deking')
  assert.deepEqual(deking, {
    label: 'Deking',
    v: '—',
    dTxt: '',
    dSign: 0,
    baseW: 0,
    segL: 0,
    segW: 0,
  })
  assert.equal(tactics?.avg, '80')
})

void test('a group with no known values shows a dash average', () => {
  const v = toBuildLockerView(data([build({ attributes: {} })]))
  assert.ok(v.details[0]?.groups.every((g) => g.avg === '—'))
})

void test('blanks render as dashes: height, weight, hand, unknown tier', () => {
  const v = toBuildLockerView(data([build({ xFactors: [{ name: 'Quick_Release', tier: null }] })]))
  const tile = v.tiles[0]
  assert.ok(tile)
  assert.equal(tile.body, '—')
  assert.deepEqual(tile.xf[0], {
    abbr: 'QR',
    title: 'Quick Release — tier unknown',
    tier: null,
    src: null,
  })
})

void test('height, weight and hand formats', () => {
  const tile = toBuildLockerView(
    data([build({ heightText: `6'0"`, weightLbs: 160, handedness: 'SHOOTS RIGHT' })]),
  ).tiles[0]
  assert.ok(tile)
  assert.equal(tile.body, `6'0" · 160 lb · R`)
  assert.equal(toBuildLockerView(data([build({ handedness: 'Left' })])).tiles[0]?.body, 'L')
  assert.equal(toBuildLockerView(data([build({ heightText: `5'9"` })])).tiles[0]?.body, `5'9"`)
})

void test('header: archetype mix (most used first), total GP and persona', () => {
  const v = toBuildLockerView({
    ...data([
      build({ archetype: 'Sniper', gp: 3 }),
      build({ archetype: 'Power Forward', gp: 6 }),
      build({ archetype: 'Power Forward', gp: 9 }),
    ]),
    persona: 'M. RANTANEN',
  })
  assert.deepEqual(
    v.mix.map((m) => [m.arcName, m.n]),
    [
      ['Power Forward', 2],
      ['Sniper', 1],
    ],
  )
  assert.equal(v.totalGp, 18)
  assert.equal(v.persona, 'M. RANTANEN')
})

void test('record with DNF already folded into losses, OTL last', () => {
  const tile = toBuildLockerView(data([build({ gp: 9, wins: 5, losses: 3, otl: 1 })])).tiles[0]
  assert.equal(tile?.record, '5–3–1')
})

void test('X-factor abbreviations follow the design (initials, at most 2)', () => {
  const tile = toBuildLockerView(
    data([
      build({
        xFactors: [
          { name: 'Quick_Release', tier: 'Elite' },
          { name: 'PressurePlus', tier: 'All Star' },
          { name: 'Tape_to_Tape', tier: 'Specialist' },
        ],
      }),
    ]),
  ).tiles[0]
  assert.deepEqual(
    tile?.xf.map((x) => x.abbr),
    ['QR', 'P', 'TT'],
  )
})

void test('archetype names: reference-player prefix dropped; initials for the fallback pill', () => {
  const v = toBuildLockerView(
    data([
      build({ archetype: 'Two-Way Defenseman' }),
      build({ archetype: 'Connor Mcdavid - Playmaker' }),
      build({ archetype: null }),
    ]),
  )
  assert.deepEqual(
    v.tiles.map((t) => [t.archetypeRaw, t.arcName, t.arcInitials]),
    [
      ['Two-Way Defenseman', 'Two-Way Defenseman', 'TWD'],
      ['Connor Mcdavid - Playmaker', 'Playmaker', 'P'],
      [null, 'Unknown build', '?'],
    ],
  )
})
