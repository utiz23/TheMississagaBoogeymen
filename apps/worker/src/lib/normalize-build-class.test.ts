import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBuildClass } from './normalize-build-class.js'

interface Case {
  raw: string | null | undefined
  expected: string | null
}

const cases: Case[] = [
  // Bare canonical forms pass through.
  { raw: 'Playmaker', expected: 'Playmaker' },
  { raw: 'Sniper', expected: 'Sniper' },
  { raw: 'Grinder', expected: 'Grinder' },
  { raw: 'Two-Way Forward', expected: 'Two-Way Forward' },
  { raw: 'Power Forward', expected: 'Power Forward' },
  { raw: 'Puck Moving Defenseman', expected: 'Puck Moving Defenseman' },
  { raw: 'Defensive Defenseman', expected: 'Defensive Defenseman' },
  { raw: 'Offensive Defenseman', expected: 'Offensive Defenseman' },

  // All-caps, no spaces.
  { raw: 'PLAYMAKER', expected: 'Playmaker' },
  { raw: 'PUCKMOVINGDEFENSEMAN', expected: 'Puck Moving Defenseman' },
  { raw: 'DEFENSIVEDEFENSEMAN', expected: 'Defensive Defenseman' },
  { raw: 'TWO-WAYFORWARD', expected: 'Two-Way Forward' },

  // CamelCase, no spaces.
  { raw: 'TwoWayForward', expected: 'Two-Way Forward' },
  { raw: 'PuckMovingDefenseman', expected: 'Puck Moving Defenseman' },

  // Reference player + spaced separator.
  { raw: 'Cole Caufield - Sniper', expected: 'Cole Caufield - Sniper' },
  { raw: 'Tage Thompson - Power Forward', expected: 'Tage Thompson - Power Forward' },

  // Reference player + suffix code, no spaces around hyphen.
  { raw: 'Cole Caufield-SNP', expected: 'Cole Caufield - Sniper' },
  { raw: 'TAGETHOMPSON-PWF', expected: 'Tage Thompson - Power Forward' },
  { raw: 'Mikko Rantanen-PWF', expected: 'Mikko Rantanen - Power Forward' },

  // Capitalization quirks on the reference name.
  { raw: 'cole caufield - sniper', expected: 'Cole Caufield - Sniper' },
  { raw: 'TAGE THOMPSON-PWF', expected: 'Tage Thompson - Power Forward' },

  // Garbage strings return null (caller falls back to raw).
  { raw: '', expected: null },
  { raw: null, expected: null },
  { raw: undefined, expected: null },
  { raw: '???', expected: null },
  { raw: 'CompletelyUnknownBuild', expected: null },

  // Single-name reference player (e.g. just one token) — keep as-is.
  { raw: 'Crosby-PMK', expected: 'Crosby - Playmaker' },
]

for (const c of cases) {
  void test(`normalizeBuildClass(${JSON.stringify(c.raw)}) → ${JSON.stringify(c.expected)}`, () => {
    assert.equal(normalizeBuildClass(c.raw), c.expected)
  })
}
