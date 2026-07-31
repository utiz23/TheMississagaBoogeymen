/**
 * Unit tests for the loadout-view bio recovery helpers used by
 * `getMatchLineups`. Pure logic — no database required.
 *
 * These recover height / weight / handedness / level / reference-build from
 * the raw OCR payloads because the typed evidence extractor emits no ROI for
 * them (see the `RecoveredBio` doc comment). Every case below is drawn from
 * real match 250 payloads — the recovery publishes numbers to the game sheet,
 * so its noise handling needs to be pinned down.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  blank,
  parseHandedness,
  parseHeightText,
  parseWeightLbs,
  pluralityWinner,
  preferReferenceBuild,
} from '../loadout-bio-recovery.js'

// ─── blank ───────────────────────────────────────────────────────────────────

// The loadout promoter writes `String(winningValue ?? '')`, so an unpromoted
// text field lands as '' — three of match 250's ten anchors carry
// `player_level_raw = ''`. Treating that as "present" strands the real value.
void test('blank: empty and whitespace-only strings are absent', () => {
  assert.equal(blank(''), null)
  assert.equal(blank('   '), null)
  assert.equal(blank(null), null)
  assert.equal(blank('P2LVL41'), 'P2LVL41')
  assert.equal(blank('  P2LVL41  '), 'P2LVL41')
})

// ─── pluralityWinner ─────────────────────────────────────────────────────────

void test('pluralityWinner: majority value wins', () => {
  assert.equal(pluralityWinner(['Left', 'Left', 'Right']), 'Left')
})

// The regression this guards: nulls don't vote, so a lone noisy frame would
// otherwise win by default. MrHomiecide's level is blank on 36 captures and
// "P1LVL17" on exactly one — publishing P1·L17 off one frame is a fabrication.
void test('pluralityWinner: a single reading against all-blanks is rejected', () => {
  const values = [...Array<null>(36).fill(null), 'P1LVL17']
  assert.equal(pluralityWinner(values), null)
})

void test('pluralityWinner: two agreeing readings clear the support floor', () => {
  const values = [...Array<null>(36).fill(null), 'P1LVL17', 'P1LVL17']
  assert.equal(pluralityWinner(values), 'P1LVL17')
})

void test('pluralityWinner: real silkyjoker85 level pool — 14 good vs 1 garbled', () => {
  const values = [...Array<string>(14).fill('P2LVL41'), '22LVL41']
  assert.equal(pluralityWinner(values), 'P2LVL41')
})

void test('pluralityWinner: all-null pool yields null', () => {
  assert.equal(pluralityWinner([null, null, null]), null)
})

void test('pluralityWinner: numeric values vote by value, not identity', () => {
  assert.equal(pluralityWinner([160, 176, 176]), 176)
})

// ─── parseWeightLbs ──────────────────────────────────────────────────────────

void test('parseWeightLbs: reads the number out of EA formatting', () => {
  assert.equal(parseWeightLbs('175 lbs'), 175)
  assert.equal(parseWeightLbs('220LBS'), 220)
})

// "601 lbs" is a real match 250 payload — a 6'0" height row misread into the
// weight field. Out-of-range values must not reach the page.
void test('parseWeightLbs: rejects values outside the EASHL range', () => {
  assert.equal(parseWeightLbs('601 lbs'), null)
  assert.equal(parseWeightLbs('12 lbs'), null)
  assert.equal(parseWeightLbs(null), null)
  assert.equal(parseWeightLbs('lbs'), null)
})

// ─── parseHandedness ─────────────────────────────────────────────────────────

void test('parseHandedness: normalizes both OCR spellings', () => {
  assert.equal(parseHandedness('Left'), 'Left')
  assert.equal(parseHandedness('SHOOTS LEFT'), 'Left')
  assert.equal(parseHandedness('SH00TSLEFT'.replace('00', 'OO')), 'Left')
  assert.equal(parseHandedness('Right'), 'Right')
  assert.equal(parseHandedness('SHOOTS RIGHT'), 'Right')
})

void test('parseHandedness: unrecognized text is absent, not a guess', () => {
  assert.equal(parseHandedness('SH00TS'), null)
  assert.equal(parseHandedness(''), null)
  assert.equal(parseHandedness(null), null)
})

// ─── parseHeightText ─────────────────────────────────────────────────────────

void test('parseHeightText: canonicalizes feet/inches', () => {
  assert.equal(parseHeightText(`5'8"`), `5'8"`)
  assert.equal(parseHeightText(`6'0"`), `6'0"`)
  assert.equal(parseHeightText(`5'10"`), `5'10"`)
})

void test('parseHeightText: rows missing the foot mark are rejected', () => {
  assert.equal(parseHeightText('510'), null)
  assert.equal(parseHeightText('175 lbs'), null)
  assert.equal(parseHeightText(null), null)
})

// ─── preferReferenceBuild ────────────────────────────────────────────────────

// The consolidator persists "COLECAUFIELD-SNP" as a bare "Sniper", dropping
// the reference player the prototype's drawer shows.
void test('preferReferenceBuild: restores a reference the stored value lost', () => {
  assert.equal(preferReferenceBuild('Sniper', 'Cole Caufield - Sniper'), 'Cole Caufield - Sniper')
  assert.equal(
    preferReferenceBuild('Power Forward', 'Tage Thompson - Power Forward'),
    'Tage Thompson - Power Forward',
  )
})

// The consolidator voted over far more evidence than this read-time pass, so a
// recovered build that disagrees on the BUILD is never allowed to override it.
void test('preferReferenceBuild: never overrides a disagreeing build', () => {
  assert.equal(preferReferenceBuild('Playmaker', 'Cole Caufield - Sniper'), 'Playmaker')
  assert.equal(preferReferenceBuild('Sniper', 'Playmaker'), 'Sniper')
})

void test('preferReferenceBuild: keeps a stored reference over a bare recovery', () => {
  assert.equal(preferReferenceBuild('Cole Caufield - Sniper', 'Sniper'), 'Cole Caufield - Sniper')
})

void test('preferReferenceBuild: falls back across nulls in both directions', () => {
  assert.equal(preferReferenceBuild(null, 'Sniper'), 'Sniper')
  assert.equal(preferReferenceBuild('Sniper', null), 'Sniper')
  assert.equal(preferReferenceBuild(null, null), null)
})
