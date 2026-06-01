/**
 * Tests for the persona-name resolver.
 *
 * Integration tests against the live DB — require DATABASE_URL pointing at a
 * Postgres instance that has `player_persona_aliases` populated with at least
 * the match-250 seed entries (see /tmp/persona-alias-seed.sql in the bundle).
 * Skips with a warning if DATABASE_URL is unset.
 */

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { sql as postgresSql } from '@eanhl/db'
import { resolvePersona } from './normalize-persona.js'

after(async () => {
  if (process.env['DATABASE_URL']) {
    await postgresSql.end({ timeout: 5 })
  }
})

function skipIfNoDb(t: { skip: (msg: string) => void }): boolean {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return true
  }
  return false
}

test('exact alias hit returns canonical + via=exact_alias', async (t) => {
  if (skipIfNoDb(t)) return
  const result = await resolvePersona('E.Wanhg')
  assert.ok(result)
  assert.equal(result.canonical, 'E. WANHG')
  assert.equal(result.via, 'exact_alias')
})

test('normalized match ignores case', async (t) => {
  if (skipIfNoDb(t)) return
  const result = await resolvePersona('e.WANHG')
  assert.ok(result)
  assert.equal(result.canonical, 'E. WANHG')
  assert.equal(result.via, 'exact_alias')
})

test('ornament-prefixed alias is normalized before lookup', async (t) => {
  if (skipIfNoDb(t)) return
  // "-. WILDE" → normalizer strips "-. " → "WILDE" → looks up "wilde" →
  // canonical "WILDE" (which is the seed canonical for the wilde alias).
  const result = await resolvePersona('-. WILDE')
  assert.ok(result)
  assert.equal(result.canonical, 'WILDE')
  assert.equal(result.via, 'exact_alias')
})

test('fuzzy Levenshtein-1 fallback catches near-miss', async (t) => {
  if (skipIfNoDb(t)) return
  // "Whoosaj" is 1 char off from seed alias "whoosah" (h↔j). Should hit fuzzy.
  const result = await resolvePersona('Whoosaj')
  assert.ok(result)
  assert.equal(result.canonical, 'WHOOSAH')
  assert.equal(result.via, 'fuzzy_alias')
})

test('no alias hit returns ornament-stripped raw', async (t) => {
  if (skipIfNoDb(t)) return
  // "R. ANDOM" isn't in the alias table. Resolver returns it as-is (cleaned).
  const result = await resolvePersona('R. ANDOM')
  assert.ok(result)
  assert.equal(result.canonical, 'R. ANDOM')
  assert.equal(result.via, 'raw')
})

test('ornament-stripped raw is returned when no alias hit', async (t) => {
  if (skipIfNoDb(t)) return
  // "-. NOTSEED" gets ornament-stripped to "NOTSEED" but has no alias entry.
  const result = await resolvePersona('-. NOTSEED')
  assert.ok(result)
  assert.equal(result.canonical, 'NOTSEED')
  assert.equal(result.via, 'raw')
})

test('null and empty input return null', async (t) => {
  if (skipIfNoDb(t)) return
  assert.equal(await resolvePersona(null), null)
  assert.equal(await resolvePersona(undefined), null)
  assert.equal(await resolvePersona(''), null)
  // All-ornament input strips to empty too.
  assert.equal(await resolvePersona('-.'), null)
})
