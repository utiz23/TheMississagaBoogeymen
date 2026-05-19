/**
 * Tests for transformMatch — specifically the bgm_was_home derivation from
 * the EA payload's clubs[clubId].teamSide field (EA convention: "0" = home,
 * "1" = away).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { transformMatch } from './transform.js'

function buildPayload(opts: {
  ourTeamSide?: string
  ourPlayerTeamSide?: string
  omitClubTeamSide?: boolean
}): unknown {
  const ourPlayer = {
    playername: 'silkyjoker85',
    position: 'rightWing',
    skgoals: '0',
    skassists: '0',
    skplusmin: '0',
    skshots: '0',
    skhits: '0',
    skpim: '0',
    sktakeaways: '0',
    skgiveaways: '0',
    skfow: '0',
    skfol: '0',
    skpassattempts: '0',
    skpasspct: '0',
    skshotattempts: '0',
    skbs: '0',
    skppg: '0',
    skshg: '0',
    skinterceptions: '0',
    skpenaltiesdrawn: '0',
    skpossession: '0',
    skdeflections: '0',
    sksaucerpasses: '0',
    isGuest: '0',
    player_dnf: '0',
    ...(opts.ourPlayerTeamSide !== undefined ? { teamSide: opts.ourPlayerTeamSide } : {}),
  }
  const oppPlayer = { ...ourPlayer, playername: 'opp_player', teamSide: '0' }

  const ourClub: Record<string, unknown> = {
    score: '2',
    shots: '20',
    details: { name: 'BGM' },
  }
  if (!opts.omitClubTeamSide && opts.ourTeamSide !== undefined) {
    ourClub.teamSide = opts.ourTeamSide
  }

  return {
    matchId: '99999999999999',
    timestamp: '1715520000',
    clubs: {
      '19224': ourClub,
      '88888': { score: '1', shots: '10', details: { name: 'Opp' } },
    },
    aggregate: {
      '19224': { skfow: '0', faceofftotal: '0', pim: '0' },
      '88888': { skfow: '0', faceofftotal: '0', pim: '0' },
    },
    players: {
      '19224': { '1001': ourPlayer },
      '88888': { '2002': oppPlayer },
    },
  }
}

void test('bgmWasHome=true when our club teamSide is "0"', () => {
  const result = transformMatch(buildPayload({ ourTeamSide: '0' }), 1, '19224', 'gameType5')
  assert.equal(result.match.bgmWasHome, true)
})

void test('bgmWasHome=false when our club teamSide is "1"', () => {
  const result = transformMatch(buildPayload({ ourTeamSide: '1' }), 1, '19224', 'gameType5')
  assert.equal(result.match.bgmWasHome, false)
})

void test('bgmWasHome falls back to player teamSide when club-level missing', () => {
  const result = transformMatch(
    buildPayload({ omitClubTeamSide: true, ourPlayerTeamSide: '1' }),
    1,
    '19224',
    'gameType5',
  )
  assert.equal(result.match.bgmWasHome, false)
})

void test('bgmWasHome=null when both club and player teamSide are missing', () => {
  const result = transformMatch(buildPayload({ omitClubTeamSide: true }), 1, '19224', 'gameType5')
  assert.equal(result.match.bgmWasHome, null)
})

void test('bgmWasHome=null on non-numeric club teamSide', () => {
  const result = transformMatch(buildPayload({ ourTeamSide: '--' }), 1, '19224', 'gameType5')
  assert.equal(result.match.bgmWasHome, null)
})
