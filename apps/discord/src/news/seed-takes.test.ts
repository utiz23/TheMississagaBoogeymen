import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  main,
  parseSeedFile,
  resolvePlayer,
  runSeed,
  type SeedPlayer,
  type SeedStore,
  type TakeSeed,
} from './seed-takes.ts'

// Every take text in this file is invented.
const SECRET = 'INVENTED SECRET TAKE TEXT'
const ANGLE = 'INVENTED SECRET ANGLE'

const PLAYERS: SeedPlayer[] = [
  { id: 1, gamertag: 'SkaterA_xx', name: 'Skater A' },
  { id: 2, gamertag: 'SkaterB', name: null },
  { id: 3, gamertag: 'Twin', name: 'Dupe Name' },
  { id: 4, gamertag: 'dupe name', name: null },
]

const entry = (over: Record<string, unknown> = {}) => ({
  reporter: 'mercer',
  player: 'Skater A',
  take: SECRET,
  spread: 'a few',
  critics: ['voss', 'barlow'],
  defender: 'quill',
  dataAngle: ANGLE,
  ...over,
})

function fakeStore(existing: string[] = []): { store: SeedStore; saved: TakeSeed[] } {
  const saved: TakeSeed[] = []
  return {
    saved,
    store: {
      listPlayers: async () => PLAYERS,
      upsertTake: async (seed) => {
        saved.push(seed)
        return existing.includes(`${seed.reporter}:${String(seed.playerId)}`)
          ? 'updated'
          : 'inserted'
      },
    },
  }
}

void test('parse: an object with "takes" or a bare array; defaults applied', () => {
  const a = parseSeedFile({ takes: [{ reporter: 'mercer', player: 'Skater A', take: 'x' }] })
  assert.ok(a.ok)
  assert.deepEqual(a.takes[0], {
    reporter: 'mercer',
    player: 'Skater A',
    take: 'x',
    spread: 'some',
    critics: [],
    defender: null,
    dataAngle: null,
    active: true,
    intensity: null,
  })
  const b = parseSeedFile([entry({ intensity: -1, active: false })])
  assert.ok(b.ok)
  assert.equal(b.takes[0]!.intensity, -1)
  assert.equal(b.takes[0]!.active, false)
  assert.deepEqual(b.takes[0]!.critics, ['voss', 'barlow'])
})

void test('parse: every problem is listed by position and field, never with the text', () => {
  const r = parseSeedFile([
    entry({ reporter: 'nobody' }),
    entry({ take: '' }),
    entry({ spread: 'all' }),
    entry({ critics: ['voss', 'zed'] }),
    entry({ defender: 'voss' }),
    entry({ intensity: 3 }),
    entry({ player: '' }),
    'not an object',
  ])
  assert.ok(!r.ok)
  assert.equal(r.problems.length, 8)
  assert.ok(r.problems[0]!.startsWith('take 1: reporter'))
  assert.ok(r.problems[7]!.startsWith('take 8:'))
  for (const p of r.problems) {
    assert.ok(!p.includes(SECRET) && !p.includes(ANGLE))
  }
  assert.ok(!parseSeedFile({ nope: [] }).ok)
  assert.ok(!parseSeedFile([]).ok, 'an empty file is a mistake')
})

void test('resolve: gamertag or profile name, any case; unknown and ambiguous names fail', () => {
  assert.deepEqual(resolvePlayer('skater a', PLAYERS), { id: 1 })
  assert.deepEqual(resolvePlayer('  SKATERA_XX ', PLAYERS), { id: 1 })
  assert.deepEqual(resolvePlayer('SkaterB', PLAYERS), { id: 2 })
  assert.deepEqual(resolvePlayer('Nobody', PLAYERS), { error: 'no player matches' })
  assert.deepEqual(resolvePlayer('Dupe Name', PLAYERS), { error: 'more than one player matches' })
})

void test('run: all names resolve ⇒ upserts; the summary has no take text and no angle', async () => {
  const { store, saved } = fakeStore(['voss:2'])
  const lines: string[] = []
  const r = await runSeed(
    [entry(), entry({ player: 'SkaterB', reporter: 'voss', defender: null })].map((e) => e),
    store,
    (l) => lines.push(l),
  )
  assert.deepEqual(r, { ok: true, inserted: 1, updated: 1 })
  assert.deepEqual(
    saved.map((s) => [s.reporter, s.playerId]),
    [
      ['mercer', 1],
      ['voss', 2],
    ],
  )
  assert.equal(saved[0]!.take, SECRET)
  const out = lines.join('\n')
  assert.ok(!out.includes(SECRET) && !out.includes(ANGLE))
  assert.match(out, /inserted/)
  assert.match(out, /updated/)
})

void test('run: an update is reported as such (running twice is safe)', async () => {
  const { store } = fakeStore(['mercer:1'])
  const r = await runSeed([entry()], store, () => {})
  assert.deepEqual(r, { ok: true, inserted: 0, updated: 1 })
})

void test('run: ONE unresolved name fails the whole file and writes nothing', async () => {
  const { store, saved } = fakeStore()
  const lines: string[] = []
  const r = await runSeed(
    [entry(), entry({ player: 'Nobody Here' }), entry({ player: 'Dupe Name' })],
    store,
    (l) => lines.push(l),
  )
  assert.ok(!r.ok)
  assert.equal(r.problems.length, 2)
  assert.equal(saved.length, 0)
  assert.ok(r.problems.every((p) => !p.includes(SECRET)))
  assert.ok(r.problems[0]!.startsWith('take 2:'))
})

void test('main: needs a path; a bad file never echoes its content', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'seed-takes-'))
  try {
    const lines: string[] = []
    const log = (l: string) => lines.push(l)
    assert.equal(await main([], { DATABASE_URL: 'postgres://x' }, log), 2)
    assert.equal(await main([join(dir, 'missing.json')], { DATABASE_URL: 'postgres://x' }, log), 2)

    const bad = join(dir, 'bad.json')
    writeFileSync(bad, `{ "takes": [ ${SECRET} `)
    assert.equal(await main([bad], { DATABASE_URL: 'postgres://x' }, log), 2)

    const good = join(dir, 'good.json')
    writeFileSync(good, JSON.stringify({ takes: [entry()] }))
    assert.equal(await main([good], {}, log), 2, 'DATABASE_URL is needed')

    // --check validates the file shape only: no database, no names resolved.
    assert.equal(await main([good, '--check'], {}, log), 0)
    assert.ok(!lines.join('\n').includes(SECRET))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
