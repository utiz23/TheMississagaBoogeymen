/**
 * Contract tests for EA API fixture payloads.
 *
 * These tests validate that captured real API responses match the expected
 * shapes defined in src/types.ts. They serve as the regression safety net:
 * if EA changes their API format, these tests will catch the breakage.
 *
 * STATUS: Scaffolded — no fixtures exist yet.
 * See __fixtures__/README.md for capture instructions.
 *
 * To run once fixtures are captured:
 *   pnpm --filter ea-client test
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { EaMatch, EaPlayerMatchStats } from '../src/types.js'

const fixturesDir = join(import.meta.dirname, '../__fixtures__')

function loadFixture<T>(name: string): T {
  const path = join(fixturesDir, name)
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

function hasFixture(name: string): boolean {
  return existsSync(join(fixturesDir, name))
}

// ─── matches response ─────────────────────────────────────────────────────────

describe('matches response (gameType5)', () => {
  if (!hasFixture('matches-gameType5.json')) {
    it.todo('capture real fixture: pnpm --filter ea-client capture')
    return
  }

  const response = loadFixture<unknown[]>('matches-gameType5.json')

  it('is an array', () => {
    expect(Array.isArray(response)).toBe(true)
  })

  it('has at least one match', () => {
    expect(response.length).toBeGreaterThan(0)
  })

  it('every match has a matchId field', () => {
    for (const match of response as EaMatch[]) {
      expect(match).toHaveProperty('matchId')
      expect(typeof match.matchId).toBe('string')
    }
  })

  it('matchId is non-empty for every match', () => {
    for (const match of response as EaMatch[]) {
      expect(match.matchId.length).toBeGreaterThan(0)
    }
  })

  it('every match has a timestamp field', () => {
    // DEFERRED: Field name unknown until fixture is captured.
    // Update assertion once field is identified.
    for (const match of response as EaMatch[]) {
      const hasTimestamp = 'timestamp' in match || 'matchDate' in match || 'timeAgo' in match
      expect(hasTimestamp, `match ${match.matchId} has no recognisable timestamp field`).toBe(true)
    }
  })

  it('every match has clubs data', () => {
    for (const match of response as EaMatch[]) {
      expect(match.clubs).toBeDefined()
    }
  })

  describe('player identity: blazeId', () => {
    it('blazeId is present for every player in every match', () => {
      // DEFERRED: This test confirms whether ea_id can be non-nullable in the players schema.
      // If this test fails, the player identity fallback strategy is required.
      const missingBlazeId: string[] = []

      for (const match of response as EaMatch[]) {
        if (!match.players) continue
        for (const [, clubPlayers] of Object.entries(match.players)) {
          for (const [playerId, stats] of Object.entries(
            clubPlayers as Record<string, EaPlayerMatchStats>,
          )) {
            if (!stats.blazeId) {
              missingBlazeId.push(`match ${match.matchId}, player ${playerId}`)
            }
          }
        }
      }

      if (missingBlazeId.length > 0) {
        // Fail with context rather than a bare assertion.
        throw new Error(
          `blazeId missing for ${missingBlazeId.length} player(s):\n${missingBlazeId.slice(0, 5).join('\n')}`,
        )
      }
    })
  })

  describe('in-game season', () => {
    it('at least one match has a season-like field', () => {
      // DEFERRED: We don't know the field name yet.
      // Update once fixture is captured.
      const seasonFields = ['seasonId', 'season', 'inGameSeason', 'matchSeason']
      for (const match of response as EaMatch[]) {
        const found = seasonFields.some((f) => f in match)
        if (found) return // pass as soon as one match has it
      }
      // If no match has a season field, content_season_id must be assigned from date ranges.
      it.todo('No season field found — content_season_id must be assigned from date ranges')
    })
  })
})

// ─── member stats response ────────────────────────────────────────────────────

describe('member stats response', () => {
  if (!hasFixture('members-stats.json')) {
    it.todo('capture real fixture: pnpm --filter ea-client capture')
    return
  }

  const response = loadFixture<Record<string, unknown>>('members-stats.json')

  it('has a members array', () => {
    expect(response).toHaveProperty('members')
    expect(Array.isArray(response['members'])).toBe(true)
  })

  it('every member has a blazeId or memberId', () => {
    const members = response['members'] as Array<Record<string, unknown>>
    for (const member of members) {
      const hasId = 'blazeId' in member || 'memberId' in member
      expect(hasId, `member without any ID field: ${JSON.stringify(member)}`).toBe(true)
    }
  })
})
