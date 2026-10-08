import test from 'node:test'
import assert from 'node:assert/strict'
import { parseArchiveCount, summarizeArchiveDetail } from '../archive-season-detail.js'

void test('parses display counts; rejects rates, blanks and junk', () => {
  assert.equal(parseArchiveCount('1,912'), 1912)
  assert.equal(parseArchiveCount('0'), 0)
  assert.equal(parseArchiveCount(7), 7)
  assert.equal(parseArchiveCount('70.3%'), null)
  assert.equal(parseArchiveCount('2.1'), null)
  assert.equal(parseArchiveCount(''), null)
  assert.equal(parseArchiveCount('-'), null)
  assert.equal(parseArchiveCount('1,91'), null)
  assert.equal(parseArchiveCount(undefined), null)
})

void test('sums 6s + 3s per title; a field missing in any mode row is null', () => {
  const [d, ...rest] = summarizeArchiveDetail([
    {
      gameTitleId: 24,
      roleGroup: 'skater',
      statsJson: { ppg: '17', dekes: '241', dekes_attempted: '600', hat_tricks: '3' },
    },
    {
      gameTitleId: 24,
      roleGroup: 'skater',
      statsJson: { ppg: '2', dekes: '1,000', dekes_attempted: '2,000' },
    },
  ])
  assert.equal(rest.length, 0)
  assert.ok(d?.skater)
  assert.equal(d.goalie, null)
  assert.equal(d.skater.powerPlayGoals, 19)
  assert.equal(d.skater.dekesMade, 1241)
  assert.equal(d.skater.dekes, 2600)
  assert.equal(d.skater.hatTricks, null)
  assert.equal(d.skater.fights, null)
})

void test('goalie and skater detail are kept apart per title', () => {
  const out = summarizeArchiveDetail([
    {
      gameTitleId: 22,
      roleGroup: 'goalie',
      statsJson: { ps: '3', penalty_shot_saves: '3', minutes_played: '7,208' },
    },
    { gameTitleId: 22, roleGroup: 'skater', statsJson: { ps: '9' } },
    { gameTitleId: 23, roleGroup: 'goalie', statsJson: null },
  ])
  const t22 = out.find((d) => d.gameTitleId === 22)
  assert.ok(t22?.goalie && t22.skater)
  assert.equal(t22.goalie.penaltyShots, 3)
  assert.equal(t22.goalie.minutesPlayed, 7208)
  assert.equal(t22.skater.penaltyShotAttempts, 9)
  const t23 = out.find((d) => d.gameTitleId === 23)
  assert.ok(t23?.goalie)
  assert.equal(t23.skater, null)
  assert.equal(t23.goalie.penaltyShots, null)
})
