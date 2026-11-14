import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PressQuote } from '@eanhl/db/queries'
import { scrumHistory } from '../press/question.ts'
import { pressForSheet } from './press-material.ts'
import { oct12Facts } from './test-fixtures.ts'

const quote = (answerId: number, answer: string, usability: 'usable' | 'joke'): PressQuote => ({
  answerId,
  playerId: 1,
  name: 'Skater A',
  question: 'Why?',
  answer,
  usability,
  reporter: 'barlow',
})

void test('rule C: a crude answer is never offered as a quote, whatever its label says (usable or joke)', () => {
  const facts = oct12Facts('night')
  const out = pressForSheet(
    {
      quotes: [
        quote(1, 'We got outworked in the third.', 'usable'),
        quote(2, 'Honestly we played like shit tonight.', 'usable'),
        quote(3, 'Ha, wade can kiss my ass.', 'joke'),
        quote(4, 'That was a damn good pass, no joke.', 'joke'),
      ],
      gmNotes: [],
    },
    facts,
  )
  // A mild word may stand; a swear word or a crude line never does.
  assert.deepEqual(
    out.quotes.map((q) => q.answerId),
    [1, 4],
  )
})

void test('rule C: a crude earlier answer goes to the writers as no answer', () => {
  const history = scrumHistory(
    [
      { question: 'Q1', answer: 'A clean answer.', usability: 'usable', reporter: 'barlow' },
      { question: 'Q2', answer: 'fuck this question', usability: 'joke', reporter: 'barlow' },
    ] as never,
    'barlow',
  )
  assert.equal(history[0]!.answer, 'A clean answer.')
  assert.equal(history[1]!.answer, null)
})
