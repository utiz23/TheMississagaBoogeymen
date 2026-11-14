import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTER_IDS } from '@eanhl/db/news'
import { fallbackLine, fallbackPool, type FallbackKind } from './fallbacks.ts'
import { safeWhy } from './question.ts'

const KINDS: FallbackKind[] = ['question', 'closing', 'ack', 'followup']

void test('every reporter has a pool of 4 for each kind: no numbers, and no name but the player', () => {
  for (const id of REPORTER_IDS) {
    for (const kind of KINDS) {
      const pool = fallbackPool(kind, id, 'Skater A')
      assert.equal(pool.length, 4, `${id} ${kind}`)
      assert.equal(new Set(pool).size, 4, `${id} ${kind} has a repeat`)
      for (const line of pool) {
        assert.doesNotMatch(line, /\d/, line)
        // No other person's name: the only capitalised names are the player's.
        const withoutPlayer = line.replaceAll('Skater A', '')
        assert.doesNotMatch(
          withoutPlayer,
          /\b(Wade|Talia|Dex|June|Rico|Mara|Gord|Lyle|Father)\b/,
          line,
        )
      }
      if (kind === 'question') {
        for (const line of pool) {
          assert.ok(line.includes('Skater A'), line)
          assert.match(line, /\?$|\.$|!$/)
        }
      }
    }
  }
})

void test('the question pools are questions, in different voices (no two reporters share a line)', () => {
  const all = REPORTER_IDS.flatMap((id) => fallbackPool('question', id, 'X'))
  assert.equal(new Set(all).size, all.length)
})

void test('fallbackLine: never the same line twice in one scrum while the pool lasts; then it repeats', () => {
  const owner = {}
  const seen: string[] = []
  for (let i = 0; i < 4; i++) {
    seen.push(
      fallbackLine(owner, { scrumId: 1, kind: 'ack', reporter: 'mercer', name: 'A', seed: 7 }),
    )
  }
  assert.equal(new Set(seen).size, 4)
  assert.deepEqual([...seen].sort(), [...fallbackPool('ack', 'mercer')].sort())
  // The pool is used up: the seeded line repeats rather than failing.
  const fifth = fallbackLine(owner, {
    scrumId: 1,
    kind: 'ack',
    reporter: 'mercer',
    name: 'A',
    seed: 7,
  })
  assert.ok(fallbackPool('ack', 'mercer').includes(fifth))
  // Another scrum, or another owner, starts fresh.
  assert.equal(
    fallbackLine(owner, { scrumId: 2, kind: 'ack', reporter: 'mercer', name: 'A', seed: 7 }),
    seen[0],
  )
  assert.equal(
    fallbackLine({}, { scrumId: 1, kind: 'ack', reporter: 'mercer', name: 'A', seed: 7 }),
    seen[0],
  )
})

void test('fallbackLine: lines already in the thread (alsoUsed) are skipped; the seed picks the start', () => {
  const owner = {}
  const pool = fallbackPool('question', 'quill', 'Raz')
  const first = fallbackLine(owner, {
    scrumId: 1,
    kind: 'question',
    reporter: 'quill',
    name: 'Raz',
    seed: 0,
    alsoUsed: [pool[0]!],
  })
  assert.equal(first, pool[1])
  const other = fallbackLine(
    {},
    { scrumId: 1, kind: 'question', reporter: 'quill', name: 'Raz', seed: 2 },
  )
  assert.equal(other, pool[2])
})

void test("safeWhy: the reason is cut and the player's words are taken out", () => {
  const answer = 'pucks in deep forecheck and then we got tired late'
  const why = `failed after 4 writes: The closing quotes "pucks in deep forecheck and then we got" wrongly`
  const out = safeWhy(why, [answer])
  assert.ok(!out.includes('forecheck'))
  assert.ok(out.includes('failed after 4 writes'))
  assert.equal(Array.from(safeWhy('x'.repeat(1000), [])).length, 300)
})
