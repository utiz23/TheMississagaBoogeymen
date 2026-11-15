/**
 * The Press Box save-time text check (task press-box-l3). No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/press-text-check.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CRUDE_EXTRA,
  SLUR_WORDS,
  SPREAD_SLUR,
  STRONG_WORDS,
  checkPressText,
  crudeHit,
  slurHit,
} from '../press-text-check.js'

const root = new URL('../../../../../', import.meta.url)
const desk = (path: string): string => readFileSync(new URL(path, root), 'utf8')

/** The regex literal that follows `const NAME =` in a source file. */
function literal(source: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*(\\/.+\\/[a-z]*)\\s*$`, 'm').exec(source)
  assert.ok(m, `${name} not found in the desk source`)
  return m[1]!
}

void test('parity: the lists here are word for word the desk lists (change both together)', () => {
  const crude = desk('apps/discord/src/news/crude.ts')
  const fact = desk('apps/discord/src/news/fact-check.ts')
  assert.equal(String(SLUR_WORDS), literal(crude, 'const SLUR_WORDS'))
  assert.equal(String(SPREAD_SLUR), literal(crude, 'const SPREAD_SLUR'))
  assert.equal(String(CRUDE_EXTRA), literal(crude, 'const CRUDE_EXTRA'))
  assert.equal(String(STRONG_WORDS), literal(fact, 'export const STRONG_WORDS'))
})

void test('crude words, strong words and slurs are caught; mild words and plain hockey are not', () => {
  assert.equal(crudeHit('he plays like a total dumbass'), true)
  assert.equal(crudeHit('that was bullshit'), true)
  assert.equal(crudeHit('sh1t line tonight'), true)
  assert.equal(slurHit('n i g g e r'), true)
  assert.equal(crudeHit('he is a real damn good passer'), false)
  assert.equal(crudeHit('Skates hard on the forecheck and wants the puck in the slot'), false)
})

void test('checkPressText: collapses whitespace, enforces the limit, refuses crude and (when asked) digits', () => {
  assert.deepEqual(checkPressText('  a   plain\n take ', { max: 50 }), {
    ok: true,
    text: 'a plain take',
  })
  assert.deepEqual(checkPressText('   ', { max: 50 }), { ok: false, problem: 'empty' })
  assert.deepEqual(checkPressText('   ', { max: 50, allowEmpty: true }), { ok: true, text: '' })
  assert.deepEqual(checkPressText('x'.repeat(51), { max: 50 }), { ok: false, problem: 'too_long' })
  assert.deepEqual(checkPressText('x'.repeat(50), { max: 50 }), { ok: true, text: 'x'.repeat(50) })
  assert.deepEqual(checkPressText('what a bitch of a shift', { max: 80 }), {
    ok: false,
    problem: 'crude',
  })
  assert.deepEqual(checkPressText('23 hits', { max: 50, noDigits: true }), {
    ok: false,
    problem: 'digits',
  })
  assert.deepEqual(checkPressText('23 hits', { max: 50 }), { ok: true, text: '23 hits' })
  // Characters, not UTF-16 units.
  assert.deepEqual(checkPressText('é'.repeat(50), { max: 50 }), { ok: true, text: 'é'.repeat(50) })
})
