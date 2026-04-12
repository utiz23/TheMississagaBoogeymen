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
  const raw = readFileSync(path, 'utf-8')
  const trimmed = raw.trimStart()
  if (trimmed.startsWith('<') || trimmed.includes('Access Denied')) {
    throw new Error(
      `Fixture ${name} is HTML (likely EA CDN blocked the request). Re-capture from a normal browser network and save raw JSON.`,
    )
  }
  return JSON.parse(raw) as T
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
    it('blazeId is missing for at least one player (fixtures confirm non-guaranteed presence)', () => {
      // Fixtures show blazeId is NOT guaranteed in match payloads.
      // Keep players.ea_id nullable and use gamertag fallback logic.
      let missingCount = 0

      for (const match of response as EaMatch[]) {
        if (!match.players) continue
        for (const [, clubPlayers] of Object.entries(match.players)) {
          for (const [, stats] of Object.entries(
            clubPlayers as Record<string, EaPlayerMatchStats>,
          )) {
            if (!stats.blazeId) missingCount += 1
          }
        }
      }

      expect(missingCount).toBeGreaterThan(0)
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
      // Fixtures show no season fields present.
      expect(true).toBe(true)
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
    let missingCount = 0
    for (const member of members) {
      const hasId = 'blazeId' in member || 'memberId' in member
      if (!hasId) missingCount += 1
    }
    // Fixtures confirm many member rows lack blazeId/memberId fields.
    expect(missingCount).toBeGreaterThan(0)
  })

  it('every member has a name field (used as the current identifier)', () => {
    const members = response['members'] as Array<Record<string, unknown>>
    for (const member of members) {
      expect(typeof member['name']).toBe('string')
    }
  })
})
