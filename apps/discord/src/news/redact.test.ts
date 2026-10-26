import test from 'node:test'
import assert from 'node:assert/strict'
import { redactTakes } from './redact.ts'

const take = { id: 3, take: 'He pads his points against the weakest clubs in the league.' }

void test('redactTakes: any run of 4+ words of an offered take becomes "take N"', () => {
  assert.equal(
    redactTakes('It said "He pads his points against the weakest clubs in the league."', [take]),
    'It said "take 3."',
  )
  assert.equal(redactTakes('So: he PADS his points, against the weakest.', [take]), 'So: take 3.')
  // Three words are ordinary language; other texts are untouched.
  assert.equal(redactTakes('He pads his stats.', [take]), 'He pads his stats.')
  assert.equal(redactTakes('Nothing here.', []), 'Nothing here.')
})
