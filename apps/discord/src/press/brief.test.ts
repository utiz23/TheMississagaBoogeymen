import test from 'node:test'
import assert from 'node:assert/strict'
import { briefProblems, repeatsBrief } from './brief.ts'

/** The text the operator typed on 2026-11-14 (game 3448); the GM meant a private brief. */
const LIVE =
  'Ask him about his disaterous game on defense, and ask why he would go for a push faceoff in the offensive zone when he is lined up on the blue line. Put the heat on him.'

void test('repeatsBrief: 5 words in a row, case and punctuation ignored', () => {
  assert.ok(!repeatsBrief('Why chase for a push faceoff?', LIVE)) // only 4 in a row
  assert.ok(repeatsBrief('Why would he go for a push faceoff?', LIVE)) // 5 in a row
  assert.ok(repeatsBrief('Go for a push faceoff in the offence?', LIVE))
  assert.ok(repeatsBrief('GO, FOR a push-faceoff in the zone?', LIVE))
  assert.ok(
    !repeatsBrief('What were you thinking, going for a push faceoff from the blue line?', LIVE),
  )
})

void test('repeatsBrief: a brief of fewer than 5 words is a repeat only as the whole question', () => {
  assert.ok(repeatsBrief('The corner battles.', 'the corner battles'))
  assert.ok(!repeatsBrief('What was going on in the corner battles tonight?', 'the corner battles'))
  assert.ok(!repeatsBrief('Anything?', ''))
})

void test('briefProblems: the live brief echoed, in whole or in part', () => {
  assert.equal(briefProblems(LIVE, LIVE, 'yoma').length > 0, true)
  const text = briefProblems(LIVE, LIVE, 'yoma').join(' ')
  assert.match(text, /repeats the desk's private brief/)
  assert.match(text, /instruction/)
  assert.match(text, /third person/)
  // The problem text never quotes the brief.
  assert.ok(!text.includes('disaterous'))
})

void test('briefProblems: reporter-instruction phrasing', () => {
  for (const bad of [
    'Ask him why he went for that faceoff?',
    'Skater A, ask why the faceoff happened in the zone?',
    'Ask about the defence tonight.',
    'Tough night. Ask her about it?',
    'Put the heat on yourself, what happened?',
    'Time to put some pressure on you: why that faceoff?',
    'I will press him on the blue line.',
    'Tell him it was bad: why?',
  ]) {
    assert.ok(
      briefProblems(bad, 'something else entirely different here', 'Skater A').some((p) =>
        /instruction/.test(p),
      ),
      bad,
    )
  }
})

void test('briefProblems: the player in the third person', () => {
  const brief = 'something else entirely different here'
  for (const bad of [
    'What was he thinking on that faceoff?',
    'Why did Skater A go for that faceoff?',
    "Skater A's night on the blue line was rough. Why?",
    "Was it his read or the coach's?",
  ]) {
    assert.ok(
      briefProblems(bad, brief, 'Skater A').some((p) => /third person/.test(p)),
      bad,
    )
  }
})

void test('briefProblems: a good second-person question passes, with the name as a vocative', () => {
  const brief = LIVE
  for (const good of [
    'Skater A, that was a rough night on the back end. What were you thinking, going for a push faceoff from the blue line?',
    'Rough one on defense tonight, Skater A. Why chase that faceoff from the blue line?',
    'You were on the blue line, so why go for the push faceoff, Skater A?',
    'Skater A: where did the back end break down tonight?',
  ]) {
    assert.deepEqual(briefProblems(good, brief, 'Skater A'), [], good)
  }
})
