/**
 * Tests for deriveTeamFaceoffPct — the team FO% used by matches.faceoff_pct,
 * which feeds the 0.20 faceoff term of the Deserve-to-Win model.
 *
 * EA never returns `aggregate.faceofftotal`, so the rate is reconstructed from
 * the per-player faceoff counters on both sides. Cases below mirror the shapes
 * actually present in the archive.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveTeamFaceoffPct } from './transform.js'

const p = (faceoffWins: number, faceoffLosses: number) => ({ faceoffWins, faceoffLosses })

void test('mirrored sides — the common case (167/199 matches)', () => {
  // BGM centre 13-8; opponent centre is the mirror image 8-13.
  const ours = [p(13, 8), p(0, 0), p(0, 0)]
  const theirs = [p(8, 13), p(0, 0)]
  assert.equal(deriveTeamFaceoffPct(ours, theirs), '61.90')
})

void test('recovers the split when our side is missing its centre (match 12)', () => {
  // Our rows: D/LW/RW only, no centre — summing our side alone gives 0-3.
  // The opponent centre recorded 29-20, so BGM actually went 20/49.
  const ours = [p(0, 0), p(0, 0), p(0, 3)]
  const theirs = [p(29, 20), p(0, 0), p(0, 0), p(0, 0)]
  assert.equal(deriveTeamFaceoffPct(ours, theirs), '40.82')
})

void test('falls back to our own rows when the opponent recorded nothing (match 237)', () => {
  const ours = [p(17, 8)]
  const theirs = [p(0, 0), p(0, 0)]
  assert.equal(deriveTeamFaceoffPct(ours, theirs), '68.00')
})

void test('takes the larger view per side when the two disagree', () => {
  // ourW=12/ourL=10 vs oppL=12/oppW=4 → wins max(12,12)=12, losses max(10,4)=10.
  assert.equal(deriveTeamFaceoffPct([p(12, 10)], [p(4, 12)]), '54.55')
})

void test('null only when neither side recorded a faceoff', () => {
  assert.equal(deriveTeamFaceoffPct([p(0, 0)], [p(0, 0)]), null)
  assert.equal(deriveTeamFaceoffPct([], []), null)
})

void test('short games are kept, not floored away', () => {
  // A 1-faceoff DNF is a legitimate short game, not a missing-row artefact.
  assert.equal(deriveTeamFaceoffPct([p(1, 0)], [p(0, 1)]), '100.00')
})

void test('tolerates absent counters on goalie-shaped rows', () => {
  assert.equal(deriveTeamFaceoffPct([{}, p(6, 4)], [{ faceoffWins: null }, p(4, 6)]), '60.00')
})
