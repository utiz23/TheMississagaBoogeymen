import test from 'node:test'
import assert from 'node:assert/strict'
import {
  liveSource,
  careerSource,
  ARCHIVE_CLUB_MEMBER_SOURCE,
  ARCHIVE_PLAYER_CARD_SOURCE,
} from './stats-sources.ts'

void test('liveSource: All mode is ea-season with the exact roster wording', () => {
  assert.deepEqual(liveSource(null), {
    kind: 'ea-season',
    label: 'EA season totals',
    description: 'Official EA club-member totals. Includes games not captured locally.',
  })
})

void test('liveSource: a specific mode is local-tracked with the exact roster wording', () => {
  assert.deepEqual(liveSource('6s'), {
    kind: 'local-tracked',
    label: 'Local tracked 6s',
    description:
      'Only 6s matches captured here, so totals can be far smaller than EA season totals. Choose All for those.',
  })
})

void test('careerSource: career kind, caller-supplied label, exact roster description', () => {
  assert.deepEqual(careerSource('Career totals across 6 titles · all clubs'), {
    kind: 'career',
    label: 'Career totals across 6 titles · all clubs',
    description:
      'EA season totals plus reviewed player-card history, which can include other clubs. Title and mode filters do not apply.',
  })
})

void test('ARCHIVE_CLUB_MEMBER_SOURCE: club-scoped wording, never identified as player-card', () => {
  assert.equal(ARCHIVE_CLUB_MEMBER_SOURCE.kind, 'archive-club-member')
  assert.match(ARCHIVE_CLUB_MEMBER_SOURCE.description ?? '', /CLUBS → MEMBERS/)
  assert.doesNotMatch(ARCHIVE_CLUB_MEMBER_SOURCE.description ?? '', /other clubs/)
})

void test('ARCHIVE_PLAYER_CARD_SOURCE: distinct kind, states it may include other clubs', () => {
  assert.equal(ARCHIVE_PLAYER_CARD_SOURCE.kind, 'archive-player-card')
  assert.notEqual(ARCHIVE_PLAYER_CARD_SOURCE.kind, ARCHIVE_CLUB_MEMBER_SOURCE.kind)
  assert.match(ARCHIVE_PLAYER_CARD_SOURCE.description ?? '', /other clubs/)
})
