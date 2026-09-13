/**
 * Shared artifact contract — E3J3 additions.
 *
 * The behaviour-preserving E3J2 extraction itself is pinned by
 * `backup-producer.test.mjs` and `backup-acceptance.test.mjs`, which already
 * exercise every symbol this module carried at that point. This file covers
 * only what E3J3 added: `publishedTripleNames()` (the plaintext-excluding
 * accessor) and `ARTIFACT_PREFIX_PATTERN` (the centralized producer/acceptor
 * prefix rule) — T2's contract portion.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ARTIFACT_PREFIX_PATTERN,
  ARTIFACT_SUFFIXES,
  buildArtifactNames,
  publishedTripleNames,
} from './backup-artifact-contract.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'artifact-contract' })

test('publishedTripleNames returns exactly the three published roles, derived from ARTIFACT_SUFFIXES', () => {
  const base = 'eanhl-prod-20260904T180007Z'
  const triple = publishedTripleNames(base)
  assert.deepEqual(Object.keys(triple).sort(), ['checksum', 'ciphertext', 'manifest'])
  assert.equal(triple.ciphertext, `${base}${ARTIFACT_SUFFIXES.ciphertext}`)
  assert.equal(triple.checksum, `${base}${ARTIFACT_SUFFIXES.checksum}`)
  assert.equal(triple.manifest, `${base}${ARTIFACT_SUFFIXES.manifest}`)
})

test('publishedTripleNames structurally excludes the plaintext name', () => {
  const triple = publishedTripleNames('eanhl-prod-20260904T180007Z')
  assert.equal('plaintext' in triple, false)
  assert.equal(
    Object.values(triple).some((name) => name.endsWith('.dump')),
    false,
  )
  // buildArtifactNames(), by contrast, still carries it — that is its job.
  const built = buildArtifactNames('eanhl-prod', '20260904T180007Z')
  assert.ok('plaintext' in built)
  assert.equal(built.plaintext, 'eanhl-prod-20260904T180007Z.dump')
})

test('publishedTripleNames returns a frozen object', () => {
  const triple = publishedTripleNames('eanhl-prod-20260904T180007Z')
  assert.throws(() => {
    triple.ciphertext = 'tampered'
  }, TypeError)
})

test('publishedTripleNames round-trips with buildArtifactNames for the same identity', () => {
  const built = buildArtifactNames('eanhl-prod', '20260904T180007Z')
  const triple = publishedTripleNames(built.base)
  assert.equal(triple.ciphertext, built.ciphertext)
  assert.equal(triple.checksum, built.checksum)
  assert.equal(triple.manifest, built.manifest)
})

test('ARTIFACT_PREFIX_PATTERN accepts plain lowercase-and-hyphen identifiers and rejects everything else', () => {
  for (const ok of ['eanhl-prod', 'a', 'a1-b2', 'eanhl']) {
    assert.equal(ARTIFACT_PREFIX_PATTERN.test(ok), true, ok)
  }
  for (const bad of ['../escape', 'EANHL_PROD', 'eanhl prod', '-eanhl', '', 'eanhl_prod']) {
    assert.equal(ARTIFACT_PREFIX_PATTERN.test(bad), false, bad)
  }
})
